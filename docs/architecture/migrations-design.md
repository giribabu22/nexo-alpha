# Migrations: design

Status: **accepted** (roadmap P2). The decisions on the open questions are in §2; implementation
is P3, in the order of §12. Each step is complete only when its §13 tests pass.

## 1. The problem, measured

Nexo stores records as JSON documents (memory, JSON file or SQLite store). A model change
doesn't touch stored records. `model.hydrate()` fills in `.default()` values for fields added
later, and nothing else. Measured on 0.8.0 with SQLite, by reading and updating records written
under the old model with the new one:

| Change | What happens today |
|---|---|
| Rename `name` → `fullName` | Old records keep `name` and have no `fullName`. `get` and `list` return `name`, which the model no longer has, and `Infer<>` says `fullName: string` is always there. Filtering on `fullName` misses them. After an update a record has **both** fields, while new records may not include `name` at all. |
| `age`: string → number | Old records still hold `"7"`. They are returned as-is, even though the type says `number`, and sort as strings next to numbers. |
| New required field `email` | Old records have no `email`, are returned without it, and can still be updated without it. |
| New field with `.default()` | Works: filled in on read. This is the only supported change. |

None of this raises an error. The data just quietly stops matching the model and its types.
Migrations make that drift a deliberate, recorded step.

## 2. Guarantees and decisions

### The five guarantees

Every part of the design serves one of these. Each has tests in §13; a guarantee without a
passing test isn't claimed in the docs.

| # | Guarantee | How |
|---|---|---|
| G1 | **No silent failures.** A required migration that fails stops startup. | `serve()` doesn't start the app or listen; `nexo migrate` exits 1 (§8). |
| G2 | **No false atomicity claims.** All-or-nothing is promised only where every write is in one transaction or an equivalent proven mechanism. | Per-store capability in §5. Stores that can't do it are refused, not degraded. |
| G3 | **No early external side effects.** Nothing outside the store (uploaded bytes) changes before the store commits. | Files are only *released* in the batch; bytes are removed later by cleanup (§6). |
| G4 | **No concurrent races.** Several instances never apply the same migration. | A lease lock in the store, plus the batch's per-document checks (§7). |
| G5 | **No untested recovery promises.** | Backup, verification and restore are covered by tests that restore and compare (§9, §13). |

### Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Generated or hand-written? | **Hand-written.** Generated drafts come later (§11), only as files to review. |
| D2 | What is a migration? | A module with an `id`, an `up`, and optionally a `down`, changing plain documents through a small API (§4). No migration DSL beyond a few helpers. |
| D3 | Order | By `id`, which starts with a UTC timestamp. A pending id sorting before an applied one stops the run (§7). |
| D4 | Record | A `nexo_migrations` collection in the same store. |
| D5 | Atomicity | **Atomic mode only** in the first version: each migration commits as one batch with its record, on stores that prove it (§5). Batch mode, for migrations too big for one transaction, is a separate later capability (§10). There is no document-count limit; instead a configurable `maxChanges` safety limit (default 100,000) refuses a migration that exceeds it, telling the author to raise it or wait for batch mode. |
| D6 | Several processes | Lease lock (§7). |
| D7 | Rollback | Verified backup before migrating, then forward fixes, then optional `down()` (§9). |
| D8 | Running | `serve()` runs pending migrations **by default** (`auto: true`) after validating them, with `auto: false` to only check. In production, **destructive** migrations need explicit approval (§8). `nexo migrate` runs them separately. |
| D9 | Before running | `nexo migrate plan`: a dry run showing what would change, what's destructive, and what backups are needed (§8). |
| D10 | Uploaded files | Framework-managed: a deleted record's files are released in the same batch and removed later by the existing cleanup, only if still unreferenced (§6). |
| D11 | Nexo's own collections | Migrated by the same engine, in their own `nexo:` namespace that app migrations can't edit, remove or reorder (§7). |
| D12 | Where the code lives | Existing packages: runner in `@nexo-alpha/core`, `writeBatch` and backups in `storage.ts`, `serve()` option in `@nexo-alpha/hapi`, `nexo migrate` in `@nexo-alpha/cli`. No new package. |

## 3. A migration

```ts
// migrations/20261029T0730-rename-user-name.ts
import { migration } from "@nexo-alpha/core";

export default migration({
  id: "20261029T0730-rename-user-name",
  description: "users: name → fullName",
  async up(m) {
    await m.renameField("users", "name", "fullName");
  },
  async down(m) {
    await m.renameField("users", "fullName", "name");
  }
});
```

```ts
// server.ts
import migrations from "./migrations/index.js";   // export default [m1, m2, …]
await serve({ resources: [User], migrations });    // same as { list: migrations, auto: true }
```

`nexo migrate create rename-user-name` writes the file with a timestamped id and adds it to
`migrations/index.ts`.

## 4. The migration API

`up(m)` and `down(m)` get a context `m`. Changes are collected in memory and applied together when
the function returns (§5), so a migration can't half-write.

| Call | Does |
|---|---|
| `m.update(collection, fn)` | Calls `fn(doc)` for every document. Return a changed document to replace it, the same object to leave it, or `m.remove` to delete it. `fn` may be async (e.g. to read another collection through `m.get`/`m.list`). |
| `m.insert(collection, doc)` | Adds a document (an `id` is generated if missing). |
| `m.get(collection, id)`, `m.list(collection)` | Read, seeing this migration's earlier changes. |
| `m.renameField(c, from, to)` | `update` that moves a field; documents that already have `to` are left alone. |
| `m.removeField(c, field)` | `update` that deletes a field. |
| `m.setField(c, field, valueOrFn)` | `update` that fills a field where it is missing, e.g. a new required one. |
| `m.index(c, field)` | Asks the store to index a field (SQLite). Runs after the batch commits; idempotent. |

The helpers each change a document only if it still needs the change, so re-running a migration
on migrated data does nothing.

**Deliberately left out:** raw SQL, schema changes (Nexo's SQLite store has one documents table
whose layout migrations never change), writes to the `files` collection or blob store (the runner
manages those, §6), and model objects. A migration must keep working after the model changes
again, so it works on plain documents.

**Destructive changes are detected, not declared.** Because a migration is computed before it is
applied, the runner knows exactly what it would do. An operation is destructive if it deletes a
document, removes a field that held a value, or replaces a value with a different one of another
type. That drives the plan (§8), the production approval (§8) and whether a backup is required (§9).

## 5. Atomicity, store by store

A migration runs in two steps:

1. **Compute** (async): run `up(m)` against documents read from the store. Every change becomes an
   operation `{ collection, id, expected, next }`: the document as read, and the new version or a delete.
2. **Apply** (one synchronous call): a new optional store method `writeBatch(operations)` writes
   every operation **only if each document still equals its `expected`**, all or nothing, and
   says whether it did. The migration's record, and the release of affected files (§6), are part
   of the same batch, so "applied", "recorded" and "files released" can't disagree.

Why not a transaction around `up()`? `node:sqlite` is synchronous behind the store's async
methods, so a transaction held open across `await` would also capture other requests' writes on
the same connection. Applying in one synchronous call keeps the transaction to exactly the
migration's writes.

| Store | `writeBatch` | Atomic? |
|---|---|---|
| SQLite | `BEGIN IMMEDIATE`; compare each row's JSON with `expected`; write; `COMMIT`, or `ROLLBACK` on any mismatch or error. Synchronous, so nothing else on the connection gets inside. `IMMEDIATE` takes the write lock against other processes. | **Yes**, one transaction. Checked: SQLite 3.53.4 in Node 24 rolls a write back after a thrown error inside `BEGIN IMMEDIATE`. |
| JSON file | Apply to a **copy** of the data, write the copy to a temp file and rename it over the store file, and only then swap the copy in as the in-memory data. | **Yes, on disk**: the rename means the file holds all of it or none. The store is single-process, so migrations must run in the app's process (`serve()`) or with the app stopped; `nexo migrate` warns about this. (Today's normal writes update memory before disk; `writeBatch` must not, so a failed write can't leave readers seeing changes that were never saved.) |
| Memory | Apply synchronously to the map. | **Yes**: nothing interleaves inside one synchronous call. Nothing to back up or recover. |
| Custom store without `writeBatch` | **Refused** with an error naming the store. | No. No fallback in the first version: a non-atomic mode would contradict G2. It returns as batch mode (§10), which says plainly that partial progress can persist. |

**Conflicts.** If the running app changed a document between compute and apply, the batch
refuses as a whole. The runner recomputes from fresh reads and tries again, up to 5 times, then
fails without changing anything.

**Multi-tenant data.** `scopeByProject()` keeps each project's documents in
`<projectId>::<collection>`, and stores can't list collections. A migration marked `perProject: true` runs `up` once per project in the
project registry, inside `runInProject()`. All projects' operations go into **one** batch.

## 6. Uploaded files

Each uploaded file has exactly one owner, recorded on its metadata as `attachedTo:
"<collection>/<id>"` (see `file-attachments.ts`). Files are never shared between records, so
"still referenced" has one meaning: some record still owns the file.

When a migration's batch deletes a document, or changes it so that it no longer contains the id of
a file it owns, the runner adds a release of that file to **the same batch**: `attachedTo` is
removed and `detachedAt` set, exactly what `resource()` does today when a record drops a file.
The runner doesn't need the models for this. It reads the files owned by documents in the affected
collections and compares their ids with the new document's values.

The bytes are removed later by the existing cleanup (`createFiles({ cleanup })`): it deletes a
blob only if its file is still unowned `removeDetachedAfterMs` (default 1 hour) after release.
So the store commits first, then bytes go (G3). If the batch rolls back, nothing was released. If a
record takes the file back in time, it isn't removed. Cleanup already retries safely, because it
claims a file with `replaceIf` before deleting its blob.

Limits, stated plainly:

- **Restoring a backup doesn't restore bytes.** A store backup brings back the file *metadata*. If
  cleanup has already removed a released file's bytes, the restored record points at a missing
  file. The plan lists every file a migration would release. A team that may restore after more
  than the cleanup delay should raise `removeDetachedAfterMs` or back up the blob directory.
- A custom blob store that can't delete safely should run with `cleanup: false` and remove files
  by its own process.

## 7. Running: order, namespaces, locks, history

```text
open store
→ validate     ids well-formed and unique, every migration has up(), no app id in the nexo: namespace
→ take lock    insert("nexo_migrations", "lock", { owner, expiresAt }), wait and retry if taken
→ read the applied records
→ check order  stop if a pending id sorts before the last applied id of its namespace
→ check edits  warn if an applied migration's checksum (of its source) changed
→ plan         compute every pending migration (§8). In production, stop here if any is destructive and not approved
→ back up      if required (§9). Stop if the backup can't be completed and verified
→ apply        for each pending, in order: writeBatch(changes + file releases + record), then index requests
→ release lock
```

- **Namespaces.** Nexo's own migrations (for `auth-users`, `files`, `nexo_projects`, `nexo_jobs`,
  `workflow_runs`, `agent_memory`, `audit_log`) have ids starting `nexo:` and ship inside the
  package that owns the collection. They are versioned with that package, run before app
  migrations, and are ordered among themselves. An app migration with a `nexo:` id is refused, and
  app code can't pass, remove or reorder Nexo's migrations: the runner adds them from the packages
  in use. The record notes which package version applied each one.
- **Lock.** `insert` is atomic on every built-in store. The lease expires (default 10 minutes) and
  is renewed while a long migration runs, so a crashed process can't block deploys forever. A
  process that finds the lock taken waits, then re-reads the applied records and usually finds
  nothing left. Even without the lock, two runners couldn't both apply the same migration: the
  record insert in each batch is checked like any other operation, so the second batch refuses.
- **Order.** If branch A's `…0730-…` is applied and branch B's `…0700-…` arrives later, the run stops
  and names both. `nexo migrate up --allow-out-of-order` runs it once a person has checked them.
- **Record.** `{ id, description, checksum, appliedAt, durationMs, documentsChanged, filesReleased,
  destructive, backup, by }`.
- **Failure.** If `up` throws, a batch keeps conflicting, a limit is exceeded or a backup fails,
  nothing is written for that migration and the run stops with the cause. Earlier migrations in
  the same run stay applied, since each is its own batch.

## 8. Where it plugs in

**`serve({ migrations })`**, after the store opens and before `app.start()`:

```ts
await serve({
  resources: [Task],
  migrations: {
    list: migrations,
    auto: true,                        // default. false: only check, refuse to start if any are pending
    allowDestructive: ["20261029T0730-drop-legacy-notes"],   // production approval, by id
    backup: { enabled: true, retain: 5, directory: "backups" },
    maxChanges: 100_000
  }
});
```

- Pending migrations are validated, planned, backed up if needed, and applied. If any step fails,
  `serve()` rejects and nothing listens (G1).
- **Production** means `NODE_ENV=production` or `migrations.production: true`. There, a destructive
  migration runs only if its id is in `allowDestructive` (or `nexo migrate up --allow-destructive
  <id>` ran it first). Otherwise startup stops with the plan of what it would destroy. Outside
  production, destructive migrations run, after a backup.
- `migrations: [m1, m2]` is short for `{ list: [m1, m2] }` with the defaults.

**`runMigrations(store, options)`** in core: the same runner, for apps wired by hand and scripts.

**`nexo migrate`** in the CLI:

| Command | Does |
|---|---|
| `plan` | Dry run. For each pending migration: collections and documents affected, destructive operations with examples, files released, whether a backup is required and where it would go, and anything that would stop the run (order, approval, limits). Changes nothing. |
| `up` | Applies pending migrations (same steps as `serve()`), with `--allow-destructive <id>` and `--allow-out-of-order`. |
| `status` | Applied and pending migrations. |
| `down <id>` | Runs a migration's `down()` as an atomic batch, newest first. Refuses migrations without `down()`. |
| `create <name>` | Writes a migration file with a timestamped id. |
| `check` | Reads each collection that has a model and reports documents that don't match it. It finds the drift in §1. |
| `backups`, `restore <backup>` | Lists verified backups; restores one (§9). |

## 9. Backups and rollback

A backup is taken before applying migrations when any of them is destructive, and always on the
first run against a store (when `backup.enabled`, the default). Steps:

1. **Take it.** SQLite uses `VACUUM INTO '<directory>/<time>-before-<id>.db'`, a consistent copy of a
   live database (checked in Node 24). The JSON file store copies its file. The memory store has
   nothing to back up: destructive migrations on it run without one, and the plan says so.
2. **Verify it** before migrating: open the copy, run SQLite's `PRAGMA integrity_check`, compare
   per-collection document counts with the source, and record a checksum of the file. A backup that
   fails any check is deleted and **the migration is aborted** (decision 2).
3. **Retain** the newest `retain` (default 5) verified backups, deleting oldest first. A backup is
   deleted only after a newer one has been verified, so the last usable backup is never removed.
   `backup: { enabled: false }` turns this off, e.g. when the platform snapshots disks.
4. **Store separately where possible.** The default directory sits next to the database
   (`data/backups/`), which protects against bad migrations but not against losing the disk.
   `directory` can point at another volume. The docs will say so plainly.

**Restore.** `nexo migrate restore <backup>` checks the backup's checksum, refuses while the app
holds the store (the lock tells it), moves the current database aside, and puts the backup in its
place. Restoring takes the store back to before the migration, migration record included.

**What backups are not.** Five pre-migration copies are not disaster recovery. They don't cover
uploaded bytes (§6), external databases or other systems, and they aren't encrypted by Nexo. The
docs will cover access control, encryption at rest (left to the platform), retention, and
**regular restore testing**, and will not promise rollback across systems.

**Other ways back:** a forward-fix migration (the normal path in production), or `down()` where a
migration has one.

**Code and data deployed at different times.** Writes are checked strictly (unknown fields are
refused), so an old version of the code still running would refuse to update records that already
have `fullName`. For zero-downtime deploys the docs will describe expand and contract: release 1
adds `fullName` and a migration copies the data, release 2 switches the code over, release 3
removes `name`. Single-instance apps under `serve()` don't need this: migrations finish before the
new code takes requests.

## 10. Later: batch mode

For migrations too big for one transaction. Each migration processes bounded batches, records its
progress after each one, and resumes from there after a failure. Every batch is atomic, but the
migration as a whole is not: partial progress can persist, and the migration must say
`mode: "batch"` to acknowledge it. Out of scope for the first version. Custom stores without
`writeBatch` return here.

## 11. Later: generated drafts

After each successful run, the runner stores a snapshot of the app's models (`describeModel()`
already exists) in the record. `nexo migrate draft` compares today's models with the last snapshot
and writes a migration file for a person to finish: a required field gets `m.setField(…)` with a
`TODO`, a removed field gets `m.removeField(…)` marked as data loss, a field removed and one added in
the same model gets both options (rename, or drop and add) with a `TODO: choose`, and a type change
gets `m.update(…)` with a `TODO: convert`.

## 12. Implementation order (P3)

Each step is its own change with its own tests, merged only when its §13 tests pass.

Progress: steps 1 and 2 are done. Step 1: `migrations.ts`, `migration-lock.ts`, `nexo migrate status`. Step 2: `writeBatch`/`entries` in `storage.ts`, `migration-plan.ts`, `migration-runner.ts`, `serve({ migrations })` and the other `nexo migrate` commands. Their §13 rows pass on all three stores.

1. **Tracking and locking:** `migration()`, validation, the `nexo_migrations` record, ordering and
   checksums, the lease lock, `status`. Applying uses the store's existing single-document writes
   only for the record and lock, which are atomic on their own.
2. **Transactional execution and recovery:** the migration context, compute and plan,
   `writeBatch` on the three stores, conflict retries, `maxChanges`, destructive detection and the
   production approval, `plan`/`up`/`down`, and the `serve()` option.
3. **Backups:** take, verify, retain, restore; `backups`/`restore`.
4. **File cleanup:** releasing files in the batch, and the files shown in the plan.
5. **Nexo's own collections:** the `nexo:` namespace and the mechanism for packages to ship
   migrations. (Nexo doesn't need any yet; the first real one proves the mechanism.)

`check`, `create` and `perProject` migrations go with step 2.

## 13. Acceptance tests

Run against SQLite, the JSON file store and the memory store unless a row says otherwise.

| Step | Test | Guarantee |
|---|---|---|
| 1 | Ids out of order, duplicated, malformed, or in the `nexo:` namespace from the app: refused before anything runs. | G1 |
| 1 | Two runners on the same SQLite file at once: each migration applied once; the other waits, then finds nothing pending. Also with the lock disabled: the second batch refuses. | G4 |
| 1 | A crashed runner's lock expires and the next run proceeds. | G4 |
| 1 | An applied migration's file edited afterwards: a warning names it. | — |
| 2 | Renaming a field, changing a type and filling a new required field migrate existing records, and `check` then reports no drift (the §1 cases). | — |
| 2 | `up` throws halfway: no document changed, no record written, `serve()` rejects and nothing listens. | G1, G2 |
| 2 | SQLite: an error inside `writeBatch` after some rows are written leaves every row as it was. JSON file: a failed file write leaves the file and the in-memory data as they were. | G2 |
| 2 | A custom store without `writeBatch`: refused with an error naming it. | G2 |
| 2 | A document changed between compute and apply: the batch retries and the result includes that change. | G4 |
| 2 | `plan` lists the changes, marks destructive ones, and changes nothing (store compared byte for byte). | — |
| 2 | Production with an unapproved destructive migration: startup stops and shows the plan; approved by id, it runs. | G1 |
| 2 | `maxChanges` exceeded: refused before anything is written. | G2 |
| 2 | `down` reverses its `up`; a migration without `down` is refused. | — |
| 2 | `perProject` with three projects: all three migrated in one batch. | G2 |
| 3 | A backup is taken, verified, and **restoring it gives back the same documents** as before the migration (SQLite, JSON file). | G5 |
| 3 | A backup that fails verification, or a full disk: the migration doesn't run. | G1, G5 |
| 3 | Retention keeps 5 and never deletes the newest verified backup, even when a new backup fails. | G5 |
| 4 | Deleting a record with a file releases the file in the same batch; the blob still exists until cleanup runs after the delay, and then it's gone. | G3 |
| 4 | A migration that fails after computing file releases: no file is released and every blob still exists. | G3 |
| 4 | A file a record takes back before cleanup isn't removed. | G3 |
| 5 | A `nexo:` migration shipped by a package runs before app migrations, is recorded with its package version, and can't be removed or reordered by the app. | — |

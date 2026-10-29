# Migrations: design

Status: **proposal, for review before any code** (roadmap P2). Implementation is P3.

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

## 2. Decisions

| # | Question | Proposal |
|---|---|---|
| D1 | Generated or hand-written? | **Hand-written first** (this design). Generating a draft from model changes comes later (§9) and only ever produces a file to review, never runs by itself: a rename and a drop-then-add look the same in a diff. |
| D2 | What is a migration? | A TypeScript module with an `id`, an `up`, and optionally a `down`. It changes documents through a small API (§4), not raw store calls. |
| D3 | Order | Sorted by `id`. Ids start with a UTC timestamp (`20261029T0730-rename-user-name`). A pending migration that sorts *before* an applied one stops the run (§6). |
| D4 | Record of what ran | A `nexo_migrations` collection in the same store: one document per applied migration. |
| D5 | All or nothing | Each migration commits as **one atomic batch** on all three built-in stores, together with its record (§5). It is never left half-applied. |
| D6 | Several processes | A lease lock in the store. Only one process migrates at a time; the others wait, then find nothing pending (§6). |
| D7 | Rollback | Forward fixes by default. A **backup before migrating** on SQLite and JSON file stores, and optional `down()` for reversible changes (§7). |
| D8 | When it runs | `serve({ migrations })` runs pending migrations after opening the store and before the app starts or accepts requests. `nexo migrate` runs them from a deploy pipeline. A production setting refuses to start with pending migrations instead of running them (§8). |
| D9 | Where the code lives | Extends existing packages: the runner in `@nexo-alpha/core`, the store batch method in `storage.ts`, the `serve()` option in `@nexo-alpha/hapi`, and `nexo migrate` in `@nexo-alpha/cli`. No new package. |

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
await serve({ resources: [User], migrations });
```

`nexo migrate create rename-user-name` writes the file with a timestamped id, and adds it to
`migrations/index.ts`.

## 4. The migration API

`up(m)` and `down(m)` get a context `m`. Every change is collected in memory and applied when
the function returns (§5), so a migration can't half-write.

| Call | Does |
|---|---|
| `m.update(collection, fn)` | Calls `fn(doc)` for every document. Return a changed document to replace it, the same object to leave it, or `m.remove` to delete it. `fn` may be async (e.g. to read another collection through `m.get`/`m.list`). |
| `m.insert(collection, doc)` | Adds a document (an `id` is generated if missing). |
| `m.get(collection, id)`, `m.list(collection)` | Read, seeing this migration's earlier changes. |
| `m.renameField(c, from, to)` | `update` that moves a field; documents that already have `to` are left alone. |
| `m.removeField(c, field)` | `update` that deletes a field. |
| `m.setField(c, field, valueOrFn)` | `update` that fills a field, e.g. a new required one, where it is missing. |
| `m.index(c, field)` | Asks the store to index a field (SQLite). Runs after the batch commits. |

The helpers are thin wrappers over `update`, and each one changes a document only if it still
needs the change. So a migration re-run on data that is already migrated does nothing, which keeps
retries (§6) and the non-atomic fallback (§5) safe.

**Deliberately left out:** raw SQL, schema changes (Nexo's SQLite store has one documents table
whose layout migrations never change), and model objects inside migrations. A migration must keep
working after the model changes again, so it works on plain documents and doesn't import today's model.

## 5. Atomicity per store

The store interface has no transactions, and the SQLite store's `node:sqlite` connection is
synchronous behind async methods. A transaction held open across `await` would also capture other
requests' writes on the same connection. So a migration runs in two steps:

1. **Compute** (async): run `up(m)` against documents read from the store. Every change becomes an
   operation `{ collection, id, expected, next }`, where `expected` is the document as it was read
   and `next` is the new version (or a delete).
2. **Apply** (synchronous, one call): a new optional store method,
   `writeBatch(operations)`. It writes every operation **only if each document still equals its
   `expected`**, all or nothing, and returns whether it did. The migration's record in
   `nexo_migrations` is the last operation of the same batch, so "applied" and "recorded" can't
   disagree.

| Store | `writeBatch` | Checked on 0.8.0 |
|---|---|---|
| SQLite | `BEGIN IMMEDIATE`, compare each row's JSON with `expected`, write, `COMMIT`, or `ROLLBACK` on any mismatch. One synchronous call, so no other request's writes can get inside it. `IMMEDIATE` holds the write lock against other processes. | SQLite 3.53.4 in Node 24: a thrown error after a write inside `BEGIN IMMEDIATE` and a `ROLLBACK` leaves the row unchanged. |
| JSON file | Apply to the in-memory map, then **one** whole-file write. The store already writes a temp file and renames it, so the file holds either everything or nothing. | The existing write path does temp + rename. |
| Memory | Apply synchronously to the map. Nothing can interleave inside one synchronous call. | — |
| Custom stores without `writeBatch` | The runner refuses unless the migration list is given `allowNonAtomic: true`. Then it applies operations one by one with `replaceIf` and writes the record last. A crash in between leaves some documents changed and no record; a re-run finishes it, which is safe because changes are idempotent (§4). | — |

**If the batch reports a conflict** (the running app changed a document between compute and
apply), the runner recomputes from fresh reads and tries again, up to 5 times, and then fails
without changing anything.

**Size.** Step 1 holds the changed documents in memory. That's the same as `list()` on the memory and
JSON stores, and fine for SQLite up to hundreds of thousands of small documents. A migration that
touches more needs batching across several atomic steps, which gives up all-or-nothing. Not in
the first version (§10, Q3).

**Multi-tenant data.** `scopeByProject()` keeps each project's documents in
`<projectId>::<collection>`, and stores can't list collections. A migration that marks itself
`perProject: true` runs `up` once for each project in the project registry, inside
`runInProject()`. All projects' operations go into **one** batch.

## 6. Running: order, locks, history

```text
open store
→ take the lock            insert("nexo_migrations", "lock", { owner, expiresAt }); wait and retry if taken
→ read applied records
→ check order              stop if a pending id sorts before the last applied id
→ check edits              warn if an applied migration's checksum (of its source) changed
→ for each pending, by id: compute → writeBatch (+ record) → index requests
→ release the lock
```

- **Lock.** `insert` is atomic on every built-in store. The lease expires (default 10 minutes) and is
  renewed while a long migration runs, so a crashed process can't block deploys forever. A
  process that finds the lock taken waits, re-reads the applied records afterwards, and usually
  finds nothing left to do.
- **Order.** If branch A's `…0730-…` is applied and branch B's `…0700-…` arrives later, the runner
  stops and names both. `nexo migrate up --allow-out-of-order` runs it anyway once a person has
  checked that the two don't touch the same data.
- **Record.** `{ id, description, checksum, appliedAt, durationMs, documentsChanged, by }`.
  `nexo migrate status` prints the list and what's pending.
- **Failure.** If `up` throws, or the batch keeps conflicting, nothing is written for that
  migration and the run stops. Earlier migrations in the same run stay applied, because each is
  its own batch. `serve()` doesn't start the app.

## 7. Rollback strategy

Rolling back data is harder than rolling back code: a `down` can't recreate what an `up` deleted.
In order of reliability:

1. **Backup before migrating** (default on when there are pending migrations): SQLite uses
   `VACUUM INTO 'data/backups/<timestamp>-before-<id>.db'`, a consistent copy of a live database
   (checked: works in Node 24's SQLite). The JSON file store copies the file. The memory store has
   nothing to back up. Restoring means stopping the app and replacing the file.
   `nexo migrate restore <backup>` does it and checks that the app is stopped.
2. **Forward fix:** write a new migration that undoes the change. This is the normal path in
   production, because it is recorded and tested like any other change.
3. **`down()`**, when a migration has one: `nexo migrate down <id>` runs it as an atomic batch and
   deletes the record in the same batch. Only for the last applied migrations, in reverse order.
   A migration without `down` is reported as irreversible.

**Code and data deployed at different times.** Records are checked strictly on write (unknown
fields are refused). So while an old version of the code still runs, it would refuse to update
records that already have `fullName`. For zero-downtime deploys the docs will describe expand
and contract: release 1 adds `fullName` (optional) and a migration copies the data, release 2
switches the code over, and release 3 removes `name`. Single-instance apps under `serve()` don't
need this: migrations run before the new code takes requests.

## 8. Where it plugs in

- **`serve({ migrations })`**: after the store opens, before `app.start()`. Runs pending migrations,
  with a backup first. `migrations: { list, mode: "check" }` doesn't run anything: it refuses to
  start if any are pending, for teams that migrate in the deploy pipeline.
- **`runMigrations(store, list, options)`** in core: the same runner, for apps wired by hand and for
  scripts.
- **`nexo migrate`** in the CLI: `status`, `up`, `down <id>`, `create <name>`, `restore <backup>`, and
  `check`. `check` reads every collection that has a model and reports documents that don't match
  it: unknown fields, missing required fields, wrong types. It's the tool that finds the drift in
  §1, and the basis for §9.

## 9. Later: generated drafts

After each successful run, the runner stores a snapshot of the app's models (`describeModel()`
already exists) in the record. `nexo migrate draft` compares today's models with the last snapshot
and writes a migration file:

- Added optional or defaulted field: a comment, since no migration is needed.
- Added required field: `m.setField(…)` with a `TODO: value for existing records`.
- Removed field: `m.removeField(…)`, marked as data loss.
- A field removed and one added in the same model: both options, rename or drop-and-add, with a
  `TODO: choose`.
- Type change: `m.update(…)` with a `TODO: convert`.

It's a draft for a person to finish and review. The runner treats it like any hand-written file.

## 10. Open questions for review

1. **Default in `serve()`:** run pending migrations automatically (simplest; proposed), or require
   `mode: "run"` explicitly? Automatic matches `serve()`'s purpose. Explicit is more cautious in production.
2. **Backups:** keep how many? Proposed: the last 5 per store, deleted oldest first, with
   `backup: false` to turn them off (e.g. when the platform already snapshots disks).
3. **Large collections:** is all-or-nothing per migration acceptable as the only mode at first, with
   an error above a size limit (proposed: 100,000 changed documents) pointing to batching as future work?
4. **Files:** `m.update` that removes a `field.file()` value, or `m.remove` on a record with files,
   doesn't release those files today. Should the runner release them (it can, given the
   models), or should the docs tell authors to do it?
5. **Auth, files, projects, workflows:** their collections (`auth-users`, `files`, `nexo_projects`,
   `nexo_jobs`, `workflow_runs`, `agent_memory`, `audit_log`) belong to Nexo. Should Nexo ship its own migrations for them when they change,
   recorded in the same `nexo_migrations` collection with a `nexo:` id prefix? Proposed: yes.

## 11. Acceptance criteria for P3

Each one is an integration test that runs against all three built-in stores unless noted.

- Renaming a field, changing a type, and filling a new required field each migrate existing
  records, and `nexo migrate check` reports no drift afterwards (the §1 cases).
- `up` throws halfway through: no document changed, no record written.
- Two runners start on the same SQLite file at once: each migration is applied exactly once, and
  the other runner waits, then finds nothing pending.
- A document changes between compute and apply: the batch is retried, and the result includes that change.
- A pending id that sorts before an applied one: the run stops and names both.
- An applied migration's file edited afterwards: a warning names it.
- `perProject` migration with three projects: all three migrated in one batch.
- A backup is taken before migrating (SQLite and JSON file), and restoring it brings the data back exactly.
- `down` reverses its `up`. A migration without `down` is refused by `nexo migrate down`.
- `serve()` with a failing migration doesn't accept requests and exits with the error.
- A custom store without `writeBatch` is refused unless `allowNonAtomic: true`.

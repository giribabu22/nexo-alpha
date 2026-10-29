/**
 * Migrations, step 1 (docs/architecture/migrations-design.md §12–13): defining
 * and validating migrations, the applied records, order and edit checks, and
 * the lock that keeps several processes from applying the same migration.
 * `apply` here only stores the record; applying changes is step 2.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createFileDocumentStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  migration,
  migrationStatus,
  MIGRATIONS_COLLECTION,
  NexoMigrationError
} from "../dist/index.js";
import { createMigrationRecord, runPendingMigrations } from "../dist/migrations.js";
import { acquireMigrationLock, MIGRATION_LOCK_ID } from "../dist/migration-lock.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);

const noop = () => undefined;
const m1 = migration({ id: "20261029T0700-create-users", up: noop });
const m2 = migration({ id: "20261029T0730-rename-user-name", description: "users: name → fullName", up: noop, down: noop });
const m3 = migration({ id: "20261030T0900-backfill-emails", up: noop });

/** Step 1's apply: store the record atomically (step 2 adds the changes to the same write). */
const recordOnly = (store) => async (item, { by, startedAt }) =>
  store.insert(MIGRATIONS_COLLECTION, item.id, createMigrationRecord(item, by, startedAt));

const BACKENDS = [
  { name: "Memory", open: async () => createInMemoryDocumentStore() },
  { name: "File", open: async (dir) => createFileDocumentStore(join(dir, "app.json")) },
  { name: "Sqlite", open: async (dir) => createSqliteDocumentStore(join(dir, "app.db")), skip: !HAS_SQLITE && "node:sqlite not available" }
];

async function withStore(backend, fn) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrations-"));
  const store = await backend.open(dir);
  try {
    await fn(store, dir);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("migration(): checks the id and functions, and fingerprints the code", () => {
  assert.equal(m2.description, "users: name → fullName");
  assert.match(m2.checksum, /^[0-9a-f]{16}$/);
  assert.notEqual(migration({ id: m1.id, up: () => 1 }).checksum, m1.checksum, "different code, different checksum");
  assert.equal(migration({ id: m1.id, up: noop }).checksum, m1.checksum, "same code, same checksum");
  assert.ok(Object.isFrozen(m1));
  assert.equal(migration({ id: "nexo:20261029T0700-auth-users-email", package: "@nexo-alpha/core@0.9.0", up: noop }).id, "nexo:20261029T0700-auth-users-email");

  for (const id of ["rename-user-name", "2026-10-29-rename", "20261029T0730_rename", "20261029T0730-Rename", "20261029T07-x", "__lock", 42]) {
    assert.throws(() => migration({ id, up: noop }), NexoMigrationError, String(id));
  }
  assert.throws(() => migration({ id: m1.id }), /has no up\(\) function/);
  assert.throws(() => migration({ id: m1.id, up: noop, down: "no" }), /down must be a function/);
});

for (const backend of BACKENDS) {
  const name = (title) => `migrations (${backend.name}): ${title}`;

  test(name("invalid lists are refused before anything is written"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const run = (list) => runPendingMigrations(store, list, recordOnly(store));
      await assert.rejects(run([m1, m1]), /"20261029T0700-create-users" is used twice/);
      await assert.rejects(run([m1, { id: "20261029T0800-hand-made", up: noop }]), /#2 wasn't made with migration/);
      await assert.rejects(run([migration({ id: "nexo:20261029T0700-auth", package: "@nexo-alpha/core@0.9.0", up: noop })]), /belong to Nexo's own migrations/);
      await assert.rejects(run("not a list"), /must be an array/);
      assert.deepEqual(await store.list(MIGRATIONS_COLLECTION), [], "no lock, no records");
    })
  );

  test(name("pending migrations run in id order, once; status reports them"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const order = [];
      const apply = async (item, info) => {
        order.push(item.id);
        return recordOnly(store)(item, info);
      };
      assert.deepEqual((await migrationStatus(store, [m3, m1, m2])).pending.map((m) => m.id), [m1.id, m2.id, m3.id]);

      assert.deepEqual(await runPendingMigrations(store, [m3, m1], apply), { applied: [m1.id, m3.id], skipped: [] });
      // m2 sorts between two applied ones: out of order, see the next test. Applying the same list again does nothing.
      assert.deepEqual(await runPendingMigrations(store, [m1, m3], apply), { applied: [], skipped: [] });
      assert.deepEqual(order, [m1.id, m3.id]);

      const status = await migrationStatus(store, [m1, m3]);
      assert.deepEqual(status.applied.map((r) => r.id), [m1.id, m3.id]);
      assert.deepEqual(status.pending, []);
      const record = status.applied[0];
      assert.equal(record.checksum, m1.checksum);
      assert.ok(Date.parse(record.appliedAt) > 0 && record.durationMs >= 0 && record.by.length > 0);
      const lock = await store.get(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID);
      assert.ok(lock.releasedAt, "the lock is released after a run");
    })
  );

  test(name("a pending migration sorting before an applied one stops the run, naming both"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      await runPendingMigrations(store, [m1, m3], recordOnly(store));
      const status = await migrationStatus(store, [m1, m2, m3]);
      assert.deepEqual(status.outOfOrder, [{ id: m2.id, after: m3.id }]);

      await assert.rejects(
        runPendingMigrations(store, [m1, m2, m3], recordOnly(store)),
        (error) => error instanceof NexoMigrationError && error.message.includes(`"${m2.id}" sorts before applied "${m3.id}"`)
      );
      assert.equal(await store.get(MIGRATIONS_COLLECTION, m2.id), undefined, "nothing applied");
      assert.deepEqual(await runPendingMigrations(store, [m1, m2, m3], recordOnly(store), { allowOutOfOrder: true }), {
        applied: [m2.id],
        skipped: []
      });
    })
  );

  test(name("edited and unknown applied migrations are reported, not re-run"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      await runPendingMigrations(store, [m1, m2], recordOnly(store));
      const edited = migration({ id: m2.id, up: () => "changed", down: noop });
      const warnings = [];
      const result = await runPendingMigrations(store, [m1, edited], recordOnly(store), { onWarning: (w) => warnings.push(w) });
      assert.deepEqual(result, { applied: [], skipped: [] });
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /"20261029T0730-rename-user-name" changed after it was applied/);

      const status = await migrationStatus(store, [m2]);
      assert.deepEqual(status.unknown, [m1.id]);
      const more = [];
      await runPendingMigrations(store, [m2], recordOnly(store), { onWarning: (w) => more.push(w) });
      assert.match(more[0], /"20261029T0700-create-users" is recorded as applied but isn't in the list/);
    })
  );

  test(name("a failing migration stops the run: later ones don't run, the lock is released"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const apply = async (item, info) => {
        if (item.id === m2.id) throw new Error("up() failed");
        return recordOnly(store)(item, info);
      };
      await assert.rejects(runPendingMigrations(store, [m1, m2, m3], apply), /up\(\) failed/);
      const status = await migrationStatus(store, [m1, m2, m3]);
      assert.deepEqual(status.applied.map((r) => r.id), [m1.id]);
      assert.deepEqual(status.pending.map((m) => m.id), [m2.id, m3.id]);
      // The lock was released: the next run starts at once.
      const lock = await acquireMigrationLock(store, { waitMs: 0 });
      await lock.release();
    })
  );

  test(name("lock: a live lock makes others wait, then fail naming the holder; an expired one is taken over"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const holder = await acquireMigrationLock(store, { owner: "host-a:1:aaaa" });
      await assert.rejects(
        acquireMigrationLock(store, { waitMs: 60, pollMs: 10 }),
        (error) => error instanceof NexoMigrationError && /locked by host-a:1:aaaa until/.test(error.message)
      );
      // A waiter gets it as soon as the holder releases.
      const waiting = acquireMigrationLock(store, { owner: "host-b:2:bbbb", waitMs: 5000, pollMs: 10 });
      setTimeout(() => void holder.release(), 50);
      const next = await waiting;
      assert.equal(next.owner, "host-b:2:bbbb");
      await next.release();

      // A crashed holder: its lease ran out and nobody released it.
      await store.put(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID, {
        owner: "crashed:9:dead",
        acquiredAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:10:00.000Z"
      });
      const after = await acquireMigrationLock(store, { waitMs: 0 });
      after.assertHeld();
      assert.equal((await store.get(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID)).owner, after.owner);
      await after.release();
    })
  );

  test(name("lock: a holder that lost its lease stops before writing"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      let clock = Date.parse("2026-10-29T08:00:00.000Z");
      const lock = await acquireMigrationLock(store, { leaseMs: 60_000, now: () => clock });
      lock.assertHeld();
      clock += 61_000; // no renewal got through in time
      assert.throws(() => lock.assertHeld(), /was lost \(its lease ran out\)/);
      await lock.release();

      // Taken over by another process: the holder notices on its next renewal.
      const taken = await acquireMigrationLock(store, { leaseMs: 30, waitMs: 0 });
      const current = await store.get(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID);
      await store.put(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID, { ...current, owner: "someone-else" });
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.throws(() => taken.assertHeld(), /was lost/);
      await taken.release(); // doesn't release someone else's lock
      assert.equal((await store.get(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID)).owner, "someone-else");
    })
  );
}

test("migrations: a store without atomic insert can't be locked", async () => {
  const { insert: _insert, ...store } = createInMemoryDocumentStore();
  await assert.rejects(runPendingMigrations(store, [m1], async () => true), /need a store with an atomic insert/);
});

test("migrations (Sqlite): without the lock, two runners still record each migration exactly once", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrations-"));
  const a = await createSqliteDocumentStore(join(dir, "app.db"));
  const b = await createSqliteDocumentStore(join(dir, "app.db"));
  try {
    // Both runners see all three as pending, then race to record them.
    const slow = (store) => async (item, info) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return recordOnly(store)(item, info);
    };
    const [ra, rb] = await Promise.all([
      runPendingMigrations(a, [m1, m2, m3], slow(a), { lock: false }),
      runPendingMigrations(b, [m1, m2, m3], slow(b), { lock: false })
    ]);
    for (const id of [m1.id, m2.id, m3.id]) {
      assert.equal([...ra.applied, ...rb.applied].filter((x) => x === id).length, 1, `${id} applied once`);
      assert.equal([...ra.applied, ...ra.skipped].includes(id) && [...rb.applied, ...rb.skipped].includes(id), true);
    }
    assert.equal((await migrationStatus(a, [m1, m2, m3])).applied.length, 3);
  } finally {
    await a.close();
    await b.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("migrations (Sqlite): two processes migrating one database apply each migration once; the second waits", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrations-"));
  const dist = (file) => pathToFileURL(join(import.meta.dirname, "..", "dist", file)).href;
  const worker = join(dir, "worker.mjs");
  await writeFile(
    worker,
    `import { appendFileSync } from "node:fs";
import { createSqliteDocumentStore, migration, MIGRATIONS_COLLECTION } from ${JSON.stringify(dist("index.js"))};
import { createMigrationRecord, runPendingMigrations } from ${JSON.stringify(dist("migrations.js"))};
const [database, log] = process.argv.slice(2);
const list = ["20261029T0700-a", "20261029T0730-b", "20261030T0900-c"].map((id) => migration({ id, up: () => undefined }));
const store = await createSqliteDocumentStore(database);
const result = await runPendingMigrations(store, list, async (item, { by, startedAt }) => {
  appendFileSync(log, item.id + "\\n");               // the migration's work, seen from outside
  await new Promise((resolve) => setTimeout(resolve, 100));
  return store.insert(MIGRATIONS_COLLECTION, item.id, createMigrationRecord(item, by, startedAt));
}, { lock: { pollMs: 20, waitMs: 30000 } });
await store.close();
console.log(JSON.stringify(result));
`
  );
  const database = join(dir, "app.db");
  const log = join(dir, "work.log");
  await writeFile(log, "");
  const runWorker = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker, database, log], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exited ${code}: ${err}`))));
    });
  try {
    const results = await Promise.all([runWorker(), runWorker()]);
    const work = (await readFile(log, "utf8")).trim().split("\n");
    assert.deepEqual(work, ["20261029T0700-a", "20261029T0730-b", "20261030T0900-c"], "each migration's work ran once, in order");
    assert.deepEqual(results.map((r) => r.applied.length).sort(), [0, 3], "one process applied all three");
    assert.deepEqual(results.map((r) => r.skipped), [[], []], "the other waited for the lock, then found nothing pending");
  } finally {
    // On Windows the workers' database handles can linger for a moment after they exit (EBUSY).
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

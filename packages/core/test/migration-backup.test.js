/**
 * Migrations, step 3 (docs/architecture/migrations-design.md §9, §13):
 * backups are taken and checked before migrating, a failed backup stops the
 * migration, the newest 5 are kept, and restoring gives back the data as it was.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFileDocumentStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  field,
  listBackups,
  migration,
  migrationStatus,
  model,
  planMigrations,
  resource,
  restoreBackup,
  runMigrations,
  takeBackup,
  MIGRATIONS_COLLECTION,
  NexoMigrationError
} from "../dist/index.js";
import { acquireMigrationLock, MIGRATION_LOCK_ID } from "../dist/migration-lock.js";
import { checkSqliteBackup } from "../dist/storage.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);
const quiet = { onWarning: () => undefined };

const BACKENDS = [
  { name: "File", file: "app.json", open: (file) => createFileDocumentStore(file) },
  { name: "Sqlite", file: "app.db", open: (file) => createSqliteDocumentStore(file), skip: !HAS_SQLITE && "node:sqlite not available" }
];

const User = model("users", { name: field.string(), age: field.string().optional() });
const rename = migration({ id: "20261029T0700-rename-user-name", up: (m) => m.renameField("users", "name", "fullName") });
const dropAge = migration({ id: "20261029T0710-drop-age", up: (m) => m.removeField("users", "age") });

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-backup-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seeded(backend, dir) {
  const file = join(dir, backend.file);
  const store = await backend.open(file);
  const users = resource(User, { store });
  await users.create({ name: "Ann", age: "41" });
  await users.create({ name: "Bo", age: "7" });
  return { store, file };
}

const usersOf = async (store) => store.entries("users");

for (const backend of BACKENDS) {
  const name = (title) => `backups (${backend.name}): ${title}`;

  test(name("a destructive run takes a checked backup first, and restoring it gives back the data as it was"), { skip: backend.skip }, () =>
    withDir(async (dir) => {
      const { store, file } = await seeded(backend, dir);
      const before = await usersOf(store);

      const result = await runMigrations(store, [rename, dropAge], quiet);
      assert.ok(result.backup, "a backup was taken");
      assert.equal(result.backup.path, join(dir, "backups", result.backup.file));
      assert.match(result.backup.file, /^\d{8}T\d{9}Z-before-20261029t0700-rename-user-name\.(db|json)$/);
      assert.deepEqual(result.backup.counts.users, 2);
      assert.equal(result.backup.reason, "before 20261029T0700-rename-user-name");
      assert.equal((await store.get(MIGRATIONS_COLLECTION, dropAge.id)).backup, result.backup.path, "records name their backup");
      assert.notDeepEqual(await usersOf(store), before);
      await store.close();

      const restored = await restoreBackup(result.backup.path);
      assert.equal(restored.restored, file);
      assert.match(restored.movedAside, /\.before-restore-\d{8}T\d{9}Z$/);

      const reopened = await backend.open(file);
      try {
        assert.deepEqual(await usersOf(reopened), before, "the same documents as before the migration");
        assert.equal((await migrationStatus(reopened, [rename, dropAge])).applied.length, 0, "and no migration recorded");
        // The backup was taken while the run held the lock; the restored copy's lock is released.
        const lock = await acquireMigrationLock(reopened, { waitMs: 0 });
        await lock.release();
        // The migrations can run again on the restored data.
        assert.equal((await runMigrations(reopened, [rename, dropAge], quiet)).applied.length, 2);
      } finally {
        await reopened.close();
      }
      // The replaced file was kept, with the migrated data.
      const aside = await backend.open(restored.movedAside);
      assert.equal((await usersOf(aside))[0][1].fullName, "Ann");
      await aside.close();
    })
  );

  test(name("a backup that can't be written stops the migration; nothing is applied"), { skip: backend.skip }, () =>
    withDir(async (dir) => {
      const { store } = await seeded(backend, dir);
      const before = await usersOf(store);
      const notAFolder = join(dir, "not-a-folder");
      await writeFile(notAFolder, "a file where the backups folder should be");
      await assert.rejects(
        runMigrations(store, [rename, dropAge], { ...quiet, backup: { directory: notAFolder } }),
        (error) => error instanceof NexoMigrationError && /The backup before migrating failed, so nothing was applied/.test(error.message)
      );
      assert.deepEqual(await usersOf(store), before);
      assert.equal((await migrationStatus(store, [rename, dropAge])).applied.length, 0);
      await store.close();
    })
  );

  test(name("only the first run and destructive runs take a backup; backup: false takes none"), { skip: backend.skip }, () =>
    withDir(async (dir) => {
      const { store } = await seeded(backend, dir);
      assert.ok((await runMigrations(store, [rename], quiet)).backup, "first run against the store");
      const addTag = migration({ id: "20261029T0705-add-tag", up: (m) => m.setField("users", "tag", "member") });
      assert.equal((await planMigrations(store, [rename, addTag], quiet)).backupNeeded, false);
      assert.equal((await runMigrations(store, [rename, addTag], { ...quiet, allowOutOfOrder: true })).backup, undefined, "not destructive");
      assert.equal((await planMigrations(store, [rename, addTag, dropAge], quiet)).backupNeeded, true);
      assert.equal((await runMigrations(store, [rename, addTag, dropAge], { ...quiet, backup: false })).backup, undefined);
      assert.equal((await listBackups(join(dir, "backups"))).length, 1);
      await store.close();
    })
  );

  test(name("the newest 5 are kept, and a failed backup deletes none"), { skip: backend.skip }, () =>
    withDir(async (dir) => {
      const { store, file } = await seeded(backend, dir);
      const at = (i) => Date.parse("2026-10-29T08:00:00.000Z") + i * 60_000;
      for (let i = 0; i < 7; i++) await takeBackup(store, { reason: `run ${i}`, now: at(i) });
      let kept = await listBackups(join(dir, "backups"), file);
      assert.deepEqual(kept.map((b) => b.reason), ["run 2", "run 3", "run 4", "run 5", "run 6"]);
      assert.equal((await readdir(join(dir, "backups"))).length, 10, "5 backups and their manifests, nothing else");

      // The next backup's file already exists, so it fails: every kept backup stays.
      const clash = join(dir, "backups", `20261029T080700000Z-run-7.${backend.file.split(".")[1]}`);
      await writeFile(clash, "in the way");
      await assert.rejects(takeBackup(store, { reason: "run 7", now: at(7) }), /already exists|EEXIST/);
      kept = await listBackups(join(dir, "backups"), file);
      assert.deepEqual(kept.map((b) => b.reason), ["run 2", "run 3", "run 4", "run 5", "run 6"]);
      assert.equal(await readFile(clash, "utf8"), "in the way", "never overwritten");
      await store.close();
    })
  );

  test(name("restore refuses a changed backup, and a store that is being migrated"), { skip: backend.skip }, () =>
    withDir(async (dir) => {
      const { store } = await seeded(backend, dir);
      const backup = await takeBackup(store, { reason: "manual" });
      const lock = await acquireMigrationLock(store, { owner: "host-a:1:aaaa" });
      await assert.rejects(restoreBackup(backup.path), /host-a:1:aaaa is migrating this store/);
      await lock.release();
      await store.close();

      await writeFile(backup.path, (await readFile(backup.path)).subarray(0, 100));
      await assert.rejects(restoreBackup(backup.path), /doesn't match its checksum/);
      await assert.rejects(restoreBackup(join(dir, "nope.db")), /has no manifest/);
    })
  );
}

test("backups (Sqlite): a damaged copy fails its check", { skip: !HAS_SQLITE && "node:sqlite not available" }, () =>
  withDir(async (dir) => {
    const { store } = await seeded(BACKENDS[1], dir);
    const backup = await takeBackup(store, { reason: "good" });
    await checkSqliteBackup(backup.path, { users: 2 });
    await assert.rejects(checkSqliteBackup(backup.path, { users: 3 }), /failed its check: it holds \{"users":2\}/);
    const bytes = await readFile(backup.path);
    bytes.fill(0xff, 4096, 8192); // overwrite a page
    await writeFile(join(dir, "damaged.db"), bytes);
    await assert.rejects(checkSqliteBackup(join(dir, "damaged.db"), { users: 2 }), /failed its check/);
    await store.close();
  })
);

test("backups: a store in memory has nothing to back up; a custom store without backup() can't run destructive migrations", async () => {
  const memory = createInMemoryDocumentStore();
  await resource(User, { store: memory }).create({ name: "Ann", age: "41" });
  const result = await runMigrations(memory, [rename, dropAge], quiet);
  assert.equal(result.backup, undefined);
  assert.equal(result.applied.length, 2);

  const { backup: _b, ...custom } = createInMemoryDocumentStore();
  await resource(User, { store: custom }).create({ name: "Ann", age: "41" });
  await assert.rejects(runMigrations(custom, [dropAge], quiet), /can't back itself up \(no backup\(\)\)\. Pass backup: false/);
  assert.equal((await runMigrations(custom, [dropAge], { ...quiet, backup: false })).applied.length, 1);
});

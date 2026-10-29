/**
 * Migrations, step 2 (docs/architecture/migrations-design.md §13): computing,
 * planning, applying and reverting, each migration all-or-nothing, on every
 * built-in store.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFileDocumentStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  field,
  migration,
  migrationStatus,
  model,
  planMigrations,
  resource,
  revertMigration,
  runMigrations,
  MIGRATIONS_COLLECTION,
  NexoMigrationError
} from "../dist/index.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);
const quiet = { onWarning: () => undefined };

const BACKENDS = [
  { name: "Memory", open: async () => createInMemoryDocumentStore() },
  { name: "File", open: async (dir) => createFileDocumentStore(join(dir, "app.json")), file: "app.json" },
  { name: "Sqlite", open: async (dir) => createSqliteDocumentStore(join(dir, "app.db")), skip: !HAS_SQLITE && "node:sqlite not available" }
];

async function withStore(backend, fn) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrate-"));
  const store = await backend.open(dir);
  try {
    await fn(store, dir);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

// Version 1 of the model, as deployed: records written with it are what migrations meet.
const UserV1 = model("users", { name: field.string(), age: field.string().optional() });
// Version 2: name renamed, age a number, email required.
const UserV2 = model("users", { fullName: field.string(), age: field.number().optional(), email: field.email() });

const toV2 = [
  migration({
    id: "20261029T0700-rename-user-name",
    up: (m) => m.renameField("users", "name", "fullName"),
    down: (m) => m.renameField("users", "fullName", "name")
  }),
  migration({
    id: "20261029T0710-user-age-number",
    up: (m) => m.update("users", (u) => (typeof u.age === "string" ? { ...u, age: Number(u.age) } : u))
  }),
  migration({
    id: "20261029T0720-user-email",
    up: (m) => m.setField("users", "email", (u) => `${String(u.fullName).toLowerCase().replace(/\s+/g, ".")}@example.com`)
  })
];

async function seedV1(store) {
  const users = resource(UserV1, { store });
  return [await users.create({ name: "Ann Lee", age: "41" }), await users.create({ name: "Bo" })];
}

const contents = async (store, collections = ["users", "notes", "emails", MIGRATIONS_COLLECTION]) =>
  Object.fromEntries(await Promise.all(collections.map(async (c) => [c, await store.entries(c)])));

for (const backend of BACKENDS) {
  const name = (title) => `migrations run (${backend.name}): ${title}`;

  test(name("rename, type change and a new required field: old records match the new model afterwards"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const [ann, bo] = await seedV1(store);
      const result = await runMigrations(store, toV2, quiet);
      assert.deepEqual(result.applied.map((a) => [a.id, a.documentsChanged, a.destructive]), [
        ["20261029T0700-rename-user-name", 2, false],
        ["20261029T0710-user-age-number", 1, true], // "41" → 41 changes a type
        ["20261029T0720-user-email", 2, false]
      ]);
      // The drift of design §1 is gone: every stored record is valid for the new model.
      for (const [, document] of await store.entries("users")) {
        assert.deepEqual(UserV2.validate(UserV2.hydrate(document)).errors ?? [], [], JSON.stringify(document));
      }
      const users = resource(UserV2, { store });
      const { name: _name, ...annRest } = ann;
      assert.deepEqual(await users.get(ann.id), { ...annRest, fullName: "Ann Lee", age: 41, email: "ann.lee@example.com" });
      assert.equal((await users.list({ where: { fullName: "Bo" } })).total, 1, "filtering on the new field finds old records");
      assert.equal((await users.get(bo.id)).age, undefined);

      const record = await store.get(MIGRATIONS_COLLECTION, "20261029T0710-user-age-number");
      assert.equal(record.documentsChanged, 1);
      assert.equal(record.destructive, true);
      assert.deepEqual((await runMigrations(store, toV2, quiet)).applied, [], "nothing left to do");
    })
  );

  test(name("up() throws halfway: no document changed, no record written"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      await seedV1(store);
      const before = await contents(store);
      const failing = migration({
        id: "20261029T0700-fails-halfway",
        async up(m) {
          await m.renameField("users", "name", "fullName");
          await m.insert("notes", { id: "n1", text: "hello" });
          throw new Error("something went wrong in up()");
        }
      });
      await assert.rejects(runMigrations(store, [failing], quiet), /something went wrong in up\(\)/);
      const after = await contents(store);
      assert.deepEqual(after.users, before.users);
      assert.deepEqual(after.notes, []);
      assert.deepEqual(after[MIGRATIONS_COLLECTION].filter(([id]) => id !== "__lock"), []);
    })
  );

  test(name("an app write between computing and applying: the batch retries and keeps that write"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const [ann] = await seedV1(store);
      let batches = 0;
      const racing = {
        ...store,
        async writeBatch(writes) {
          batches += 1;
          if (batches === 1) await store.put("users", ann.id, { ...ann, name: "Ann Changed Meanwhile" });
          return store.writeBatch(writes);
        }
      };
      await runMigrations(racing, [toV2[0]], quiet);
      assert.equal(batches, 2, "the first batch refused, the second applied");
      assert.equal((await store.get("users", ann.id)).fullName, "Ann Changed Meanwhile");
      assert.equal((await store.get("users", ann.id)).name, undefined);
    })
  );

  test(name("plan: shows changes and destructive ones, simulating earlier migrations, and writes nothing"), { skip: backend.skip }, () =>
    withStore(backend, async (store, dir) => {
      await seedV1(store);
      await store.put("notes", "n1", { id: "n1", text: "old" });
      const before = await contents(store);
      const fileBefore = backend.file ? await readFile(join(dir, backend.file), "utf8") : undefined;

      const dropNotes = migration({ id: "20261029T0730-drop-notes", up: (m) => m.update("notes", () => m.remove) });
      const dropAge = migration({ id: "20261029T0740-drop-age", up: (m) => m.removeField("users", "age") });
      const plan = await planMigrations(store, [...toV2, dropNotes, dropAge], quiet);

      assert.deepEqual(plan.plans.map((p) => [p.id, p.writes.length]), [
        ["20261029T0700-rename-user-name", 2],
        ["20261029T0710-user-age-number", 1],
        ["20261029T0720-user-email", 2], // computed on top of the rename: it reads fullName
        ["20261029T0730-drop-notes", 1],
        ["20261029T0740-drop-age", 1]
      ]);
      assert.deepEqual(plan.plans[0].destructive, [], "a rename keeps every value");
      assert.deepEqual(plan.plans[0].collections, { users: { inserted: 0, updated: 2, deleted: 0 } });
      assert.deepEqual(plan.plans[1].destructive.map((d) => [d.kind, d.field, d.from, d.to]), [["change-type", "age", "string", "number"]]);
      assert.deepEqual(plan.plans[3].destructive, [{ kind: "delete", collection: "notes", id: "n1" }]);
      assert.equal(plan.plans[4].destructive[0].kind, "remove-field");
      assert.deepEqual(plan.refusals, [], "outside production nothing is refused");

      assert.deepEqual(await contents(store), before, "planning wrote nothing");
      if (fileBefore !== undefined) assert.equal(await readFile(join(dir, backend.file), "utf8"), fileBefore);
    })
  );

  test(name("production: an unapproved destructive migration stops the run before anything is applied"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      await seedV1(store);
      const dropAge = migration({ id: "20261029T0740-drop-age", up: (m) => m.removeField("users", "age") });
      const list = [toV2[0], dropAge];
      await assert.rejects(
        runMigrations(store, list, { ...quiet, production: true }),
        (error) =>
          error instanceof NexoMigrationError &&
          /Nothing was applied\. Migration "20261029T0740-drop-age" is destructive: it removes 1 value \(users\/.+\.age\)/.test(error.message) &&
          /allowDestructive: \["20261029T0740-drop-age"\]/.test(error.message)
      );
      assert.equal((await migrationStatus(store, list)).applied.length, 0, "not even the safe rename ran");
      assert.match((await planMigrations(store, list, { production: true })).refusals[0], /is destructive/);

      const result = await runMigrations(store, list, { ...quiet, production: true, allowDestructive: ["20261029T0740-drop-age"] });
      assert.deepEqual(result.applied.map((a) => a.id), ["20261029T0700-rename-user-name", "20261029T0740-drop-age"]);
    })
  );

  test(name("maxChanges: a migration over the limit is refused before anything is written"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      await seedV1(store);
      const before = await contents(store);
      await assert.rejects(runMigrations(store, toV2, { ...quiet, maxChanges: 1 }), /changes 2 documents, over maxChanges \(1\)/);
      assert.deepEqual((await contents(store)).users, before.users);
      assert.equal((await migrationStatus(store, toV2)).applied.length, 0);
    })
  );

  test(name("down reverses up and removes the record, in one batch"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      await seedV1(store);
      const before = (await contents(store)).users;
      const [rename] = toV2;
      await runMigrations(store, [rename], quiet);
      assert.notDeepEqual((await contents(store)).users, before);

      const reverted = await revertMigration(store, [rename], rename.id, quiet);
      assert.deepEqual(reverted, { id: rename.id, documentsChanged: 2, destructive: false });
      assert.deepEqual((await contents(store)).users, before, "back to the original records");
      assert.deepEqual((await migrationStatus(store, [rename])).pending.map((m) => m.id), [rename.id], "its record is gone");
      await assert.rejects(revertMigration(store, [rename], rename.id, quiet), /isn't applied/);
    })
  );

  test(name("down: only the newest applied migration, and only one that has down()"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      await seedV1(store);
      const [rename, ageToNumber] = toV2;
      await runMigrations(store, [rename, ageToNumber], quiet);
      await assert.rejects(revertMigration(store, toV2, rename.id, quiet), /Only the most recently applied migration can be reverted, and that's "20261029T0710-user-age-number"/);
      await assert.rejects(revertMigration(store, toV2, ageToNumber.id, quiet), /has no down\(\)/);
      assert.equal((await migrationStatus(store, toV2)).applied.length, 2, "nothing was reverted");
    })
  );

  test(name("perProject: every project's collection, in one batch"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      for (const project of ["acme", "globex", "initech"]) {
        await store.put("nexo_projects", project, { id: project, name: project });
        await store.put(`${project}::notes`, "n1", { id: "n1", title: " padded " });
      }
      await store.put("notes", "n1", { id: "n1", title: " outside any project " });
      let batches = 0;
      const counting = { ...store, writeBatch: (writes) => ((batches += 1), store.writeBatch(writes)) };
      const trim = migration({
        id: "20261029T0700-trim-titles",
        perProject: true,
        up: (m) => m.update("notes", (n) => ({ ...n, title: String(n.title).trim() }))
      });
      const [applied] = (await runMigrations(counting, [trim], quiet)).applied;
      assert.equal(applied.documentsChanged, 3);
      assert.equal(batches, 1);
      for (const project of ["acme", "globex", "initech"]) assert.equal((await store.get(`${project}::notes`, "n1")).title, "padded");
      assert.equal((await store.get("notes", "n1")).title, " outside any project ", "only project collections");
    })
  );

  test(name("documents without an id inside keep it that way; ids, Nexo's collections and duplicates are protected"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      await store.put("emails", "ann@example.com", { userId: "u1" });
      await runMigrations(store, [migration({ id: "20261029T0700-email-owner", up: (m) => m.renameField("emails", "userId", "ownerId") })], quiet);
      assert.deepEqual(await store.entries("emails"), [["ann@example.com", { ownerId: "u1" }]]);

      const refuse = async (up, pattern) => {
        await assert.rejects(runMigrations(store, [migration({ id: "20261029T0800-bad", up })], quiet), pattern);
        assert.equal(await store.get(MIGRATIONS_COLLECTION, "20261029T0800-bad"), undefined);
      };
      await refuse((m) => m.update("emails", (e) => ({ ...e, id: "other" })), /changed the id of "emails\/ann@example.com"/);
      await refuse((m) => m.insert("files", { id: "f1" }), /writes "files", which Nexo manages itself/);
      await refuse((m) => m.insert(MIGRATIONS_COLLECTION, { id: "x" }), /which Nexo manages itself/);
      await refuse((m) => m.insert("emails", { id: "ann@example.com" }), /"emails\/ann@example.com" already exists/);
      await refuse((m) => m.update("emails", () => "deleted"), /must return a document or m.remove/);
    })
  );

  test(name("index requests run after the migration commits"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const calls = [];
      const spying = { ...store, index: async (collection, f) => void calls.push([collection, f, (await store.get(MIGRATIONS_COLLECTION, "20261029T0700-index-email")) !== undefined]) };
      await runMigrations(spying, [migration({ id: "20261029T0700-index-email", up: (m) => m.index("users", "email") })], quiet);
      assert.deepEqual(calls, [["users", "email", true]]);
    })
  );
}

test("migrations run: a store without writeBatch() is refused, naming what's missing", async () => {
  const { writeBatch: _w, ...store } = createInMemoryDocumentStore();
  await assert.rejects(runMigrations(store, toV2), /This store has no writeBatch\(\), so it can't apply a migration all at once/);
  await assert.rejects(planMigrations(store, toV2), /no writeBatch\(\)/);
});

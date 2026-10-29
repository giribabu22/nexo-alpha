/**
 * Migrations, step 5 (docs/architecture/migrations-design.md §7, §13): Nexo's
 * own migrations ship on modules, in the "nexo:" namespace. They run before
 * the app's, are recorded with their package, and the app can't pass, edit,
 * revert or reorder them.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryDocumentStore,
  migration,
  migrationStatus,
  moduleMigrations,
  revertMigration,
  runMigrations,
  MIGRATIONS_COLLECTION
} from "../dist/index.js";

const quiet = { onWarning: () => undefined, backup: false };

// What a package would ship: a migration for the collection its module owns.
const lowercaseEmails = migration({
  id: "nexo:20261029T0600-auth-users-lowercase-email",
  package: "@nexo-alpha/core@0.9.0",
  up: (m) => m.update("auth-users", (u) => ({ ...u, email: String(u.email).toLowerCase() }))
});
const authModule = { name: "auth", migrations: [lowercaseEmails] };

// The app's own migration: it relies on emails already being lowercase.
const order = [];
const appMigration = migration({
  id: "20261029T0500-copy-emails",
  up: async (m) => {
    const users = await m.list("auth-users");
    order.push(["app sees", users.map((u) => u.email)]);
    for (const user of users) await m.insert("contacts", { id: user.id, email: user.email });
  },
  down: (m) => m.update("contacts", () => m.remove)
});

test("Nexo's migrations from modules run before the app's (even when the app's id sorts first), recorded with their package", async () => {
  const store = createInMemoryDocumentStore();
  await store.put("auth-users", "u1", { id: "u1", email: "Ann@Example.COM" });
  order.length = 0;
  const result = await runMigrations(store, [appMigration], { ...quiet, modules: [authModule, { name: "notes" }] });
  assert.deepEqual(result.applied.map((a) => a.id), [lowercaseEmails.id, appMigration.id]);
  // up() runs while planning and again when applying; every run saw Nexo's migration already done.
  assert.ok(order.length >= 2);
  assert.ok(order.every(([, emails]) => JSON.stringify(emails) === JSON.stringify(["ann@example.com"])), JSON.stringify(order));
  assert.equal((await store.get("contacts", "u1")).email, "ann@example.com");

  const record = await store.get(MIGRATIONS_COLLECTION, lowercaseEmails.id);
  assert.equal(record.package, "@nexo-alpha/core@0.9.0");
  assert.equal((await store.get(MIGRATIONS_COLLECTION, appMigration.id)).package, undefined);

  const status = await migrationStatus(store, [appMigration], { modules: [authModule] });
  assert.deepEqual(status.pending, []);
  assert.deepEqual(status.unknown, []);
});

test("the app can't pass, edit or revert Nexo's migrations", async () => {
  const store = createInMemoryDocumentStore();
  await assert.rejects(runMigrations(store, [lowercaseEmails], quiet), /ids starting "nexo:" belong to Nexo's own migrations/);
  await assert.rejects(runMigrations(store, [appMigration, lowercaseEmails], { ...quiet, modules: [authModule] }), /belong to Nexo's own/);

  await runMigrations(store, [appMigration], { ...quiet, modules: [authModule] });
  await assert.rejects(revertMigration(store, [appMigration], lowercaseEmails.id, quiet), /one of Nexo's own migrations; it can't be reverted/);
  // The app's newest migration can still be reverted: Nexo's records don't count as the app's newest.
  assert.equal((await revertMigration(store, [appMigration], appMigration.id, quiet)).id, appMigration.id);

  // Leaving the module out doesn't remove the migration: it is reported, not forgotten.
  const warnings = [];
  await runMigrations(store, [appMigration], { onWarning: (w) => warnings.push(w), backup: false });
  assert.ok(warnings.some((w) => w.includes(`"${lowercaseEmails.id}" is recorded as applied but isn't in the list`)), warnings.join("\n"));
});

test("namespaces are ordered separately: a new Nexo migration isn't out of order after newer app ones", async () => {
  const store = createInMemoryDocumentStore();
  await runMigrations(store, [migration({ id: "20261030T0900-later-app-change", up: () => undefined })], quiet);
  const result = await runMigrations(store, [migration({ id: "20261030T0900-later-app-change", up: () => undefined })], { ...quiet, modules: [authModule] });
  assert.deepEqual(result.applied.map((a) => a.id), [lowercaseEmails.id]);
});

test("module migrations are checked: nexo: ids with a package, one id per migration", () => {
  assert.throws(() => migration({ id: "nexo:20261029T0600-no-package", up: () => undefined }), /give it package: "<name>@<version>"/);
  assert.throws(
    () => moduleMigrations([{ name: "plugin", migrations: [migration({ id: "20261029T0600-not-namespaced", up: () => undefined })] }]),
    /Module "plugin" ships migration "20261029T0600-not-namespaced"; a module's migrations need ids starting "nexo:"/
  );
  const changed = migration({ ...lowercaseEmails, up: () => "different" });
  assert.throws(
    () => moduleMigrations([authModule, { name: "auth-copy", migrations: [changed] }]),
    /Modules "auth" and "auth-copy" ship different migrations with the id/
  );
  assert.deepEqual(moduleMigrations([authModule, { name: "auth-again", migrations: [lowercaseEmails] }]).map((m) => m.id), [lowercaseEmails.id]);
  assert.throws(() => moduleMigrations([{ name: "odd", migrations: [{ id: "nexo:x", up() {} }] }]), /wasn't made with migration/);
});

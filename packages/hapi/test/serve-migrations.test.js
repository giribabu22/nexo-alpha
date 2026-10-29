/** serve({ migrations }): pending migrations are applied before anything listens; a failure means nothing listens. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createFileDocumentStore, field, migration, migrationStatus, model, resource, MIGRATIONS_COLLECTION } from "@nexo-alpha/core";
import { serve } from "../dist/index.js";

const UserV1 = model("users", { name: field.string() });
const User = model("users", { fullName: field.string() });
const rename = migration({ id: "20261029T0700-rename-user-name", up: (m) => m.renameField("users", "name", "fullName") });
const dropNames = migration({ id: "20261029T0800-drop-full-name", up: (m) => m.removeField("users", "fullName") });

const base = { port: 0, logging: false, handleSignals: false, resources: [User] };

async function withV1Data(fn) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-serve-migrations-"));
  const path = join(dir, "app.json");
  const store = createFileDocumentStore(path);
  await resource(UserV1, { store }).create({ name: "Ann" });
  await store.close();
  try {
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A port nobody is listening on, so a failed serve() can be checked to have left it free. */
async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "localhost", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function portIsFree(port) {
  const probe = createServer();
  const free = await new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(port, "localhost", () => resolve(true));
  });
  if (free) await new Promise((resolve) => probe.close(resolve));
  return free;
}

test("serve({ migrations }): applies pending migrations, then serves the migrated records", () =>
  withV1Data(async (path) => {
    const served = await serve({ ...base, store: path, migrations: [rename] });
    try {
      assert.deepEqual(served.migrations.applied, [{ id: rename.id, documentsChanged: 1, destructive: false }]);
      // The first run against a store takes a backup, in "backups" next to it.
      assert.equal(served.migrations.backup.path, join(dirname(path), "backups", served.migrations.backup.file));
      assert.deepEqual(served.migrations.backup.counts.users, 1);
      const body = await (await fetch(`${served.url}/api/users?fullName=Ann`)).json();
      assert.equal(body.total, 1);
      assert.equal(body.items[0].name, undefined);
    } finally {
      await served.stop();
    }
    // The next start finds nothing to do.
    const again = await serve({ ...base, store: path, migrations: { list: [rename] } });
    assert.deepEqual(again.migrations.applied, []);
    await again.stop();
  }));

test("serve({ migrations }): a failing migration stops the start; nothing listens and nothing was written", () =>
  withV1Data(async (path) => {
    const port = await freePort();
    const failing = migration({
      id: "20261029T0710-fails",
      async up(m) {
        await m.renameField("users", "name", "fullName");
        throw new Error("bad migration");
      }
    });
    await assert.rejects(serve({ ...base, port, store: path, migrations: [failing] }), /bad migration/);
    assert.equal(await portIsFree(port), true, "nothing is listening");

    const store = createFileDocumentStore(path);
    const [[, user]] = await store.entries("users");
    assert.equal(user.name, "Ann", "the data is as it was");
    assert.equal((await migrationStatus(store, [failing])).pending.length, 1);
    await store.close();
  }));

test("serve({ migrations: { auto: false } }): refuses to start while migrations are pending", () =>
  withV1Data(async (path) => {
    await assert.rejects(
      serve({ ...base, store: path, migrations: { list: [rename], auto: false } }),
      /1 migration is pending \(20261029T0700-rename-user-name\) and migrations.auto is false/
    );
    const applied = await serve({ ...base, store: path, migrations: [rename] });
    await applied.stop();
    const checked = await serve({ ...base, store: path, migrations: { list: [rename], auto: false } });
    assert.equal(checked.migrations, undefined);
    await checked.stop();
  }));

test("serve({ migrations }) in production: an unapproved destructive migration stops the start, with what it would destroy", () =>
  withV1Data(async (path) => {
    const list = [rename, dropNames];
    await assert.rejects(
      serve({ ...base, store: path, migrations: { list, production: true } }),
      /Nothing was applied\. Migration "20261029T0800-drop-full-name" is destructive: it removes 1 value .*allowDestructive/
    );
    const store = createFileDocumentStore(path);
    assert.deepEqual((await store.entries(MIGRATIONS_COLLECTION)).filter(([id]) => id !== "__lock"), [], "not even the safe one ran");
    await store.close();

    const served = await serve({ ...base, store: path, migrations: { list, production: true, allowDestructive: [dropNames.id] } });
    assert.deepEqual(served.migrations.applied.map((a) => [a.id, a.destructive]), [[rename.id, false], [dropNames.id, true]]);
    await served.stop();
  }));

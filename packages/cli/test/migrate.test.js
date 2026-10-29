/** `nexo migrate status`: run as a user would, against a real database. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createFileDocumentStore, field, model, resource, MIGRATIONS_COLLECTION } from "@nexo-alpha/core";

const execFileAsync = promisify(execFile);
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const coreUrl = pathToFileURL(fileURLToPath(import.meta.resolve("@nexo-alpha/core"))).href;

async function project(ids) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrate-cli-"));
  const body = ids.map((id) => `migration({ id: ${JSON.stringify(id)}, description: "about ${id}", up: () => undefined })`).join(",\n  ");
  await writeFile(join(dir, "migrations.mjs"), `import { migration } from ${JSON.stringify(coreUrl)};\nexport default [\n  ${body}\n];\n`);
  return dir;
}

const run = (dir, ...args) => execFileAsync(process.execPath, [cliPath, "migrate", ...args], { cwd: dir });

test("nexo migrate status: everything pending, without creating the database", async () => {
  const dir = await project(["20261029T0700-a", "20261029T0730-b"]);
  try {
    const { stdout } = await run(dir, "status", "--store", "data/app.json", "--migrations", "migrations.mjs");
    assert.match(stdout, /\(no database yet\)/);
    assert.match(stdout, /pending {2}20261029T0700-a {2}about 20261029T0700-a/);
    assert.match(stdout, /0 applied, 2 pending/);
    assert.equal(existsSync(join(dir, "data")), false, "status doesn't create the store");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nexo migrate status: applied, pending and problems, with paths from nexo.config.json", async () => {
  const dir = await project(["20261029T0700-a", "20261029T0730-b", "20261030T0900-c"]);
  try {
    await writeFile(join(dir, "nexo.config.json"), JSON.stringify({ app: "./app.js", store: "./app.json", migrations: "./migrations.mjs" }));
    const store = createFileDocumentStore(join(dir, "app.json"));
    const record = (id, checksum) => ({ id, checksum, appliedAt: "2026-10-29T08:00:00.000Z", durationMs: 3, by: "host:1:abcd" });
    await store.put(MIGRATIONS_COLLECTION, "20261029T0700-a", record("20261029T0700-a", "0000000000000000")); // edited since
    await store.put(MIGRATIONS_COLLECTION, "20261030T0900-c", record("20261030T0900-c", "x")); // b is now out of order
    await store.put(MIGRATIONS_COLLECTION, "20261028T0100-gone", record("20261028T0100-gone", "y")); // not in the list
    await store.close();

    const { stdout } = await run(dir, "status");
    assert.match(stdout, /applied {2}20261029T0700-a {2}2026-10-29T08:00:00.000Z {2}by host:1:abcd/);
    assert.match(stdout, /pending {2}20261029T0730-b/);
    assert.match(stdout, /"20261029T0730-b" is pending but sorts before applied "20261030T0900-c"/);
    assert.match(stdout, /"20261029T0700-a" changed after it was applied/);
    assert.match(stdout, /"20261028T0100-gone" is applied but not in the list/);
    assert.match(stdout, /3 applied, 1 pending/);

    const json = JSON.parse((await run(dir, "status", "--json")).stdout);
    assert.deepEqual(json.pending.map((m) => m.id), ["20261029T0730-b"]);
    assert.deepEqual(json.outOfOrder, [{ id: "20261029T0730-b", after: "20261030T0900-c" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nexo migrate: missing paths and unknown subcommands exit 1 with usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrate-cli-"));
  try {
    await assert.rejects(run(dir, "status"), (error) => error.code === 1 && /Pass --store <path> and --migrations <module>/.test(error.stderr));
    await assert.rejects(run(dir, "frobnicate"), (error) => error.code === 1 && /Usage:\r?\n  nexo migrate status/.test(error.stderr));
    await assert.rejects(run(dir, "down"), (error) => error.code === 1 && /nexo migrate down <id>/.test(error.stderr));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nexo migrate plan / up / check / down: the whole flow on a JSON file store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrate-cli-"));
  try {
    const UserV1 = model("users", { name: field.string(), age: field.string().optional() });
    const store = createFileDocumentStore(join(dir, "app.json"));
    const users = resource(UserV1, { store });
    await users.create({ name: "Ann", age: "41" });
    await users.create({ name: "Bo" });
    await store.close();

    const core = JSON.stringify(coreUrl);
    await writeFile(
      join(dir, "migrations.mjs"),
      [
        `import { migration } from ${core};`,
        "export default [",
        '  migration({ id: "20261029T0700-rename-user-name", up: (m) => m.renameField("users", "name", "fullName"), down: (m) => m.renameField("users", "fullName", "name") }),',
        '  migration({ id: "20261029T0710-drop-age", up: (m) => m.removeField("users", "age") })',
        "];"
      ].join("\n")
    );
    await writeFile(
      join(dir, "app.mjs"),
      [
        `import { createApplication, createInMemoryDocumentStore, field, model, resource } from ${core};`,
        'export const app = createApplication({ name: "users-app" });',
        'app.module(resource(model("users", { fullName: field.string() }), { store: createInMemoryDocumentStore() }));'
      ].join("\n")
    );
    await writeFile(join(dir, "nexo.config.json"), JSON.stringify({ app: "./app.mjs", store: "./app.json", migrations: "./migrations.mjs" }));
    const fileBefore = await readFile(join(dir, "app.json"), "utf8");

    const plan = (await run(dir, "plan")).stdout;
    assert.match(plan, /2 pending migrations/);
    assert.match(plan, /20261029T0700-rename-user-name\r?\n {4}users: 2 updated\r?\n/);
    assert.match(plan, /20261029T0710-drop-age\r?\n {4}users: 1 updated\r?\n {4}DESTRUCTIVE: removes 1 value \(users\/.+\.age\)/);
    assert.match(plan, /nexo migrate up would apply all of these/);

    await assert.rejects(
      run(dir, "plan", "--production"),
      (error) => error.code === 1 && /would stop without applying anything:\r?\n {2}Migration "20261029T0710-drop-age" is destructive/.test(error.stdout)
    );
    await assert.rejects(run(dir, "up", "--production"), (error) => error.code === 1 && /Nothing was applied/.test(error.stderr));
    // A refused up took and released the lock before checking; nothing else was written.
    const after = JSON.parse(await readFile(join(dir, "app.json"), "utf8"));
    assert.deepEqual(after.users, JSON.parse(fileBefore).users, "records unchanged");
    assert.deepEqual(Object.keys(after.nexo_migrations), ["__lock"], "no migration recorded");
    assert.ok(after.nexo_migrations.__lock.releasedAt);

    await assert.rejects(
      run(dir, "check"),
      (error) => error.code === 1 && /2 records don't match the model:/.test(error.stdout) && /"body.name" is not a field/.test(error.stdout)
    );

    const up = (await run(dir, "up", "--production", "--allow-destructive", "20261029T0710-drop-age")).stdout;
    assert.match(up, /JSON file stores are single-process/);
    assert.match(up, /applied {2}20261029T0700-rename-user-name: 2 documents changed\r?\n/);
    assert.match(up, /applied {2}20261029T0710-drop-age: 1 document changed \(destructive\)/);
    assert.match((await run(dir, "check")).stdout, /users \(2\)\r?\nEvery record matches its model\./);
    assert.match((await run(dir, "status")).stdout, /2 applied, 0 pending/);
    assert.match((await run(dir, "up")).stdout, /Nothing to apply/);
    await assert.rejects(run(dir, "down", "20261029T0710-drop-age"), (error) => error.code === 1 && /has no down\(\)/.test(error.stderr));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nexo migrate down: reverts the newest migration", async () => {
  const dir = await project(["20261029T0700-a"]);
  try {
    await writeFile(join(dir, "nexo.config.json"), JSON.stringify({ app: "./app.mjs", store: "./app.json", migrations: "./migrations.mjs" }));
    assert.match((await run(dir, "up")).stdout, /applied {2}20261029T0700-a: 0 documents changed/);
    await assert.rejects(run(dir, "down", "20261029T0700-a"), (error) => /has no down\(\)/.test(error.stderr));
    await writeFile(
      join(dir, "migrations.mjs"),
      `import { migration } from ${JSON.stringify(coreUrl)};\nexport default [migration({ id: "20261029T0700-a", up: () => undefined, down: () => undefined })];\n`
    );
    assert.match((await run(dir, "down", "20261029T0700-a")).stdout, /reverted 20261029T0700-a: 0 documents changed/);
    assert.match((await run(dir, "status")).stdout, /0 applied, 1 pending/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nexo migrate create: writes a timestamped migration and adds it to index.ts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrate-cli-"));
  try {
    const first = (await run(dir, "create", "Rename user name")).stdout;
    const file = /Created (.+?)\r?\n/.exec(first)[1];
    const id = /(\d{8}T\d{4}-rename-user-name)\.ts$/.exec(file)[1];
    assert.ok((await readFile(file, "utf8")).includes(`id: "${id}"`));
    const ident = `m${id.replace(/-/g, "_")}`;
    let index = await readFile(join(dir, "src", "migrations", "index.ts"), "utf8");
    assert.ok(index.startsWith(`import ${ident} from "./${id}.js";`), index);
    assert.ok(index.includes(`export default [${ident}];`), index);

    await run(dir, "create", "drop-age");
    index = await readFile(join(dir, "src", "migrations", "index.ts"), "utf8");
    assert.equal(index.match(/^import /gm).length, 2);
    assert.match(index, /export default \[m\w+_rename_user_name, m\w+_drop_age\];/);
    await assert.rejects(run(dir, "create"), (error) => error.code === 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("nexo migrate up takes a backup; backups lists it; restore --app-stopped brings the data back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migrate-cli-"));
  try {
    const store = createFileDocumentStore(join(dir, "app.json"));
    await resource(model("users", { name: field.string() }), { store }).create({ name: "Ann" });
    await store.close();
    const original = JSON.parse(await readFile(join(dir, "app.json"), "utf8")).users;
    await writeFile(
      join(dir, "migrations.mjs"),
      `import { migration } from ${JSON.stringify(coreUrl)};\nexport default [migration({ id: "20261029T0700-drop-name", up: (m) => m.removeField("users", "name") })];\n`
    );
    await writeFile(join(dir, "nexo.config.json"), JSON.stringify({ app: "./app.mjs", store: "./app.json", migrations: "./migrations.mjs" }));

    assert.match((await run(dir, "plan")).stdout, /A checked backup of the store will be taken first\./);
    const up = (await run(dir, "up")).stdout;
    const backup = /backup {3}(.+\.json)\r?\n/.exec(up)[1];
    assert.ok(backup.startsWith(join(dir, "backups")), backup);
    assert.match((await run(dir, "backups")).stdout, /before 20261029T0700-drop-name {2}users: 1/);

    await assert.rejects(run(dir, "restore", backup), (error) => error.code === 1 && /Stop the app that uses this store first/.test(error.stderr));
    const restored = (await run(dir, "restore", backup, "--app-stopped")).stdout;
    assert.match(restored, /Restored .*app\.json\./);
    assert.match(restored, /The file it replaced is at .*app\.json\.before-restore-/);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "app.json"), "utf8")).users, original);
    assert.match((await run(dir, "status")).stdout, /0 applied, 1 pending/);
    assert.equal((await run(dir, "up", "--no-backup")).stdout.includes("backup   "), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

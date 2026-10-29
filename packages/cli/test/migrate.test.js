/** `nexo migrate status`: run as a user would, against a real database. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createFileDocumentStore, MIGRATIONS_COLLECTION } from "@nexo-alpha/core";

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
    await assert.rejects(run(dir, "up"), (error) => error.code === 1 && /Usage: nexo migrate status/.test(error.stderr));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

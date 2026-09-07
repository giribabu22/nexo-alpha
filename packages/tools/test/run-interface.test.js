import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createRunInterface } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const passingFixture = join(here, "fixtures", "run-passing");
const failingFixture = join(here, "fixtures", "run-failing");
const missingFixture = join(here, "fixtures", "does-not-exist");

test("runTests succeeds when the target's \"test\" script exits 0", async () => {
  const run = createRunInterface(passingFixture);
  const result = await run.runTests();

  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /tests ok/);
});

test("runBuild succeeds when the target's \"build\" script exits 0", async () => {
  const run = createRunInterface(passingFixture);
  const result = await run.runBuild();

  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /build ok/);
});

test("runTypecheck reports failure without spawning when the script is missing", async () => {
  const run = createRunInterface(passingFixture);
  const result = await run.runTypecheck();

  assert.equal(result.success, false);
  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /no "typecheck" script/);
});

test("runTests reports failure with captured stderr when the script exits non-zero", async () => {
  const run = createRunInterface(failingFixture);
  const result = await run.runTests();

  assert.equal(result.success, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /tests failed/);
});

test("rejects when the project root has no package.json", async () => {
  const run = createRunInterface(missingFixture);

  await assert.rejects(() => run.runTests(), /No "package\.json" found/);
});

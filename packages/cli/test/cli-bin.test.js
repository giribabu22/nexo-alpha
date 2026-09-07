import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "cli.js");
// Fixtures live as a sibling of test/, not nested under it — Node's test
// runner treats any .js/.ts file under a directory literally named "test"
// as a test file to run, which would silently (and, for source-interface's
// fixtures, not-so-silently) execute these as phantom test cases.
const fixturesDir = join(__dirname, "..", "fixtures");
const fixtureAppPath = join(fixturesDir, "app.js");

test("nexo inspect prints the application summary and exits 0", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "inspect", fixtureAppPath]);

  assert.match(stdout, /Nexo Application/);
  assert.match(stdout, /Name: shop/);
  assert.match(stdout, /orders/);
  assert.match(stdout, /payments/);
});

test("nexo inspect <module> prints module detail and exits 0", async () => {
  const { stdout } = await execFileAsync("node", [
    cliPath,
    "inspect",
    fixtureAppPath,
    "payments"
  ]);

  assert.match(stdout, /^payments/);
  assert.match(stdout, /Purpose: Handle customer payments/);
});

test("nexo status prints the development state and exits 0", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "status", fixtureAppPath]);

  assert.match(stdout, /Nexo Development Status/);
  assert.match(stdout, /Implement payment recovery/);
});

test("nexo context prints valid JSON and exits 0", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "context", fixtureAppPath]);
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.application.name, "shop");
});

test("nexo context --source-root folds a source-tree scan into the manifest", async () => {
  const { stdout } = await execFileAsync("node", [
    cliPath,
    "context",
    fixtureAppPath,
    "--source-root",
    fixturesDir
  ]);
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.application.name, "shop");
  const appFile = parsed.sourceTree.files.find((file) => file.path === "app.js");
  assert.ok(appFile, "fixtures/app.js should be included in the scan");
  assert.equal(typeof parsed.sourceTreeHash, "string");
});

test("nexo search finds nodes by keyword over the registry alone (no --source-root)", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "search", "payments", fixtureAppPath]);
  const results = JSON.parse(stdout);

  assert.ok(results.some((node) => node.id === "module:payments"));
});

test("nexo trace reports dependents by default and narrows to callers with --callers", async () => {
  const { stdout: dependents } = await execFileAsync("node", [cliPath, "trace", "module:orders", fixtureAppPath]);
  const dependentEdges = JSON.parse(dependents);
  assert.ok(dependentEdges.some((edge) => edge.from === "module:payments" && edge.kind === "depends_on"));

  const { stdout: callers } = await execFileAsync("node", [
    cliPath,
    "trace",
    "module:orders",
    fixtureAppPath,
    "--callers"
  ]);
  assert.deepEqual(JSON.parse(callers), []);
});

test("nexo impact reports the transitive blast radius and narrows with --dependencies/--edge-kinds", async () => {
  const { stdout: dependents } = await execFileAsync("node", [cliPath, "impact", "module:orders", fixtureAppPath]);
  const dependentsResult = JSON.parse(dependents);
  assert.equal(dependentsResult.direction, "dependents");
  assert.ok(dependentsResult.reached.some((hit) => hit.nodeId === "module:payments"));

  const { stdout: dependencies } = await execFileAsync("node", [
    cliPath,
    "impact",
    "module:payments",
    fixtureAppPath,
    "--dependencies"
  ]);
  const dependenciesResult = JSON.parse(dependencies);
  assert.equal(dependenciesResult.direction, "dependencies");
  assert.ok(dependenciesResult.reached.some((hit) => hit.nodeId === "module:orders"));

  const { stdout: capped } = await execFileAsync("node", [
    cliPath,
    "impact",
    "module:orders",
    fixtureAppPath,
    "--edge-kinds",
    "exposes"
  ]);
  assert.deepEqual(JSON.parse(capped).reached, []);
});

test("nexo search with no query prints usage and exits 1", async () => {
  await assert.rejects(execFileAsync("node", [cliPath, "search"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Usage: nexo search/);
    return true;
  });
});

test("nexo knowledge prints the journal as JSON and exits 0", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "knowledge", fixtureAppPath]);
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.decisions[0].title, "Use Redis for job coordination");
  assert.ok(parsed.generatedAt, "generatedAt should be present");
  assert.equal(typeof parsed.structureHash, "string");
});

test("nexo source scans a project root and prints a file/export inventory", async () => {
  const { stdout } = await execFileAsync("node", [
    cliPath,
    "source",
    fixturesDir
  ]);
  const parsed = JSON.parse(stdout);

  const appFile = parsed.files.find((file) => file.path === "app.js");
  assert.ok(appFile, "fixtures/app.js should be included in the scan");
  assert.ok(appFile.exports.includes("app"));
  assert.ok(appFile.exports.includes("knowledge"));
  assert.equal(typeof parsed.sourceTreeHash, "string");
});

test("nexo validate prints validation summary and exits 0", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "validate", fixtureAppPath]);

  assert.match(stdout, /Nexo Validation:/);
});

test("nexo health prints health metrics and exits 0", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "health", fixtureAppPath]);

  assert.match(stdout, /Nexo Application Health/);
  assert.match(stdout, /State: created/);
});

test("a bad app path exits 1 with an error on stderr", async () => {
  await assert.rejects(
    execFileAsync("node", [cliPath, "inspect", "./does/not/exist.js"]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Cannot find module/);
      return true;
    }
  );
});

test("missing arguments prints usage and exits 1", async () => {
  await assert.rejects(execFileAsync("node", [cliPath]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Usage:/);
    return true;
  });
});

const withConfigDir = join(fixturesDir, "with-config");
const noConfigDir = join(fixturesDir, "no-config");

test("nexo inspect with no app path uses nexo.config.json in the cwd", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "inspect"], { cwd: withConfigDir });

  assert.match(stdout, /Nexo Application/);
  assert.match(stdout, /Name: shop/);
});

test("nexo inspect --module uses nexo.config.json and renders module detail", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [cliPath, "inspect", "--module", "payments"],
    { cwd: withConfigDir }
  );

  assert.match(stdout, /^payments/);
  assert.match(stdout, /Purpose: Handle customer payments/);
});

test("no app path and no config exits 1 with a config-aware error", async () => {
  await assert.rejects(
    execFileAsync("node", [cliPath, "inspect"], { cwd: noConfigDir }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /nexo\.config\.json/);
      return true;
    }
  );
});

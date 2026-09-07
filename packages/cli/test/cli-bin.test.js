import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "cli.js");
const fixtureAppPath = join(__dirname, "fixtures", "app.js");

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

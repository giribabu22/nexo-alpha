import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promises as fs } from "node:fs";
import * as os from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "cli.js");

test("cli prints help with --help flag", async () => {
  const { stdout } = await execFileAsync("node", [cliPath, "--help"]);
  assert.match(stdout, /create-nexo-app/);
  assert.match(stdout, /--template/);
});

test("cli prints usage with no arguments", async () => {
  const { stdout } = await execFileAsync("node", [cliPath]);
  assert.match(stdout, /create-nexo-app/);
  assert.match(stdout, /Usage:/);
});

test("cli errors when template flag is provided without project name", async () => {
  await assert.rejects(
    execFileAsync("node", [cliPath, "--template", "minimal"]),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr || err.stdout, /Error: Please specify the project name/);
      return true;
    }
  );
});

test("cli generates a project via command line execution", async () => {
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), "nexo-cli-test-"));
  const targetProject = join(tempDir, "cli-created-app");

  try {
    const { stdout } = await execFileAsync("node", [
      cliPath,
      targetProject,
      "--template",
      "backend-api"
    ]);

    assert.match(stdout, /Scaffolding Nexo project/);
    assert.match(stdout, /Success! Created cli-created-app/);

    const exists = await fs.stat(join(targetProject, "package.json")).then(() => true).catch(() => false);
    assert.ok(exists, "package.json should exist");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

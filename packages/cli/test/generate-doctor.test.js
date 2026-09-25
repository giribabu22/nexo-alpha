import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { doctor, generateFiles, renderDoctorReport, writeGeneratedFiles } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-cli-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

test("generateFiles: derives file, action and identifier names from any casing", () => {
  const [tool, toolTest] = generateFiles("tool", "RefundOrder");
  assert.equal(tool.path, "src/tools/refund-order.ts");
  assert.match(tool.content, /export const refundOrderTool: NexoTool/);
  assert.match(tool.content, /action: "refund_order"/);
  assert.match(tool.content, /permissions: \["refund:refund_order"\]/);
  assert.equal(toolTest.path, "test/tools/refund-order.test.js");

  const [workflow] = generateFiles("workflow", "order_cancellation");
  assert.equal(workflow.path, "src/workflows/order-cancellation.ts");
  assert.match(workflow.content, /export function createOrderCancellationWorkflow\(\): NexoWorkflow/);

  const [module] = generateFiles("module", "billing reports");
  assert.equal(module.path, "src/modules/billing-reports/index.ts");
  assert.match(module.content, /export const billingReportsModule: NexoModule/);
  assert.match(module.content, /path: "\/billing-reports\/status"/);
});

test("generateFiles: rejects names without a leading letter", () => {
  assert.throws(() => generateFiles("tool", "123"), /Invalid name/);
  assert.throws(() => generateFiles("tool", "--"), /Invalid name/);
});

test("writeGeneratedFiles: writes files, and refuses to overwrite anything unless forced", async () => {
  await withTempDir(async (dir) => {
    const files = generateFiles("tool", "send-email");
    assert.deepEqual(await writeGeneratedFiles(dir, files), ["src/tools/send-email.ts", "test/tools/send-email.test.js"]);

    await writeFile(join(dir, "src/tools/send-email.ts"), "// edited");
    await rm(join(dir, "test/tools/send-email.test.js"));
    await assert.rejects(writeGeneratedFiles(dir, files), /Refusing to overwrite existing file\(s\): src\/tools\/send-email\.ts/);
    assert.equal(await readFile(join(dir, "src/tools/send-email.ts"), "utf-8"), "// edited");
    await assert.rejects(readFile(join(dir, "test/tools/send-email.test.js")), /ENOENT/);

    await writeGeneratedFiles(dir, files, { force: true });
    assert.match(await readFile(join(dir, "src/tools/send-email.ts"), "utf-8"), /sendEmailTool/);
  });
});

test("nexo generate: CLI writes files and reports usage errors", async () => {
  await withTempDir(async (dir) => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, "generate", "workflow", "refund", "--dir", dir]);
    assert.equal(stdout.trim(), "created src/workflows/refund.ts");

    await assert.rejects(execFileAsync(process.execPath, [cliPath, "generate", "workflow", "refund", "--dir", dir]), /Refusing to overwrite/);
    await assert.rejects(execFileAsync(process.execPath, [cliPath, "generate", "widget", "x"]), /Usage: nexo generate/);
  });
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

async function writeProject(dir, { pkg = { type: "module" }, config, appFile, tsconfig, packages = {} } = {}) {
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
  if (config !== undefined) await writeFile(join(dir, "nexo.config.json"), JSON.stringify(config));
  if (appFile !== undefined) {
    await mkdir(dirname(join(dir, appFile)), { recursive: true });
    await writeFile(join(dir, appFile), "export default {};");
  }
  if (tsconfig !== undefined) await writeFile(join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
  for (const [name, version] of Object.entries(packages)) {
    await mkdir(join(dir, "node_modules", "@nexo-alpha", name), { recursive: true });
    await writeFile(join(dir, "node_modules", "@nexo-alpha", name, "package.json"), JSON.stringify({ name: `@nexo-alpha/${name}`, version }));
  }
}

const statusOf = (report, name) => report.checks.find((check) => check.name === name).status;

test("doctor: a healthy project passes every check", async () => {
  await withTempDir(async (dir) => {
    await writeProject(dir, {
      config: { app: "./dist/app.js" },
      appFile: "dist/app.js",
      tsconfig: { compilerOptions: { strict: true, module: "NodeNext" } },
      packages: { core: "0.5.0", agent: "0.5.0" }
    });
    const report = await doctor(dir, { nodeVersion: "22.19.0" });
    assert.equal(report.ok, true);
    assert.ok(report.checks.every((check) => check.status === "ok"), JSON.stringify(report.checks));
    assert.match(renderDoctorReport(report), /No problems found\./);
  });
});

test("doctor: reports failures and warnings with actionable messages", async () => {
  await withTempDir(async (dir) => {
    await writeProject(dir, {
      pkg: {},
      config: { app: "./dist/missing.js" },
      tsconfig: { compilerOptions: {} },
      packages: { core: "0.5.0", agent: "0.4.1" }
    });
    const report = await doctor(join(dir), { nodeVersion: "21.0.0" });

    assert.equal(report.ok, false);
    assert.equal(statusOf(report, "node"), "warn");
    assert.equal(statusOf(report, "package.json"), "warn");
    assert.equal(statusOf(report, "nexo.config.json"), "fail");
    assert.equal(statusOf(report, "packages"), "warn");
    assert.equal(statusOf(report, "tsconfig"), "warn");
    assert.match(renderDoctorReport(report), /1 problem\(s\), 4 warning\(s\)\./);
  });

  assert.equal((await doctor(".", { nodeVersion: "18.20.0" })).checks[0].status, "fail");
});

test("nexo doctor: --json output and a non-zero exit code on failure", async () => {
  await withTempDir(async (dir) => {
    await writeProject(dir, { config: {} });
    const error = await execFileAsync(process.execPath, [cliPath, "doctor", dir, "--json"]).then(() => undefined, (e) => e);
    assert.equal(error.code, 1);
    const report = JSON.parse(error.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((c) => c.name === "nexo.config.json").status, "fail");
  });
});

/**
 * `nexo doctor` — checks a project's environment and setup without loading
 * the application, so it works even when the app fails to start.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

export interface DoctorReport {
  readonly root: string;
  readonly checks: readonly DoctorCheck[];
  /** True when no check failed (warnings allowed). */
  readonly ok: boolean;
}

export interface DoctorOptions {
  /** Node.js version to check. Default: process.versions.node */
  readonly nodeVersion?: string;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function versionAtLeast(version: string, major: number, minor = 0): boolean {
  const [maj = 0, min = 0] = version.split(".").map(Number);
  return maj > major || (maj === major && min >= minor);
}

/** Finds the nearest directory at or above `start` containing `fileName`. */
async function findUp(start: string, fileName: string): Promise<string | undefined> {
  let dir = resolve(start);
  for (;;) {
    if (await exists(join(dir, fileName))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function doctor(cwd: string, options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: CheckStatus, message: string): void => {
    checks.push({ name, status, message });
  };

  // --- Node.js ---
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  if (!versionAtLeast(nodeVersion, 20)) {
    add("node", "fail", `Node.js ${nodeVersion} is too old; Nexo needs >= 20.`);
  } else if (!versionAtLeast(nodeVersion, 22, 5)) {
    add("node", "warn", `Node.js ${nodeVersion} works, but createSqliteDocumentStore() needs >= 22.5.`);
  } else {
    add("node", "ok", `Node.js ${nodeVersion}.`);
  }

  // --- package.json ---
  const root = (await findUp(cwd, "package.json")) ?? resolve(cwd);
  const pkg = await readJson(join(root, "package.json"));
  if (pkg === undefined) {
    add("package.json", "fail", `No readable package.json at or above ${resolve(cwd)}.`);
  } else if (pkg.type !== "module") {
    add("package.json", "warn", 'package.json has no "type": "module"; Nexo packages are ESM-only.');
  } else {
    add("package.json", "ok", "ESM package.json found.");
  }

  // --- nexo.config.json ---
  const configDir = await findUp(cwd, "nexo.config.json");
  if (configDir === undefined) {
    add("nexo.config.json", "warn", 'No nexo.config.json; CLI commands will need an explicit app path. Create one with { "app": "./dist/app.js" }.');
  } else {
    const config = await readJson(join(configDir, "nexo.config.json"));
    const app = config?.app;
    if (typeof app !== "string") {
      add("nexo.config.json", "fail", 'nexo.config.json must contain { "app": "<path to the built app module>" }.');
    } else if (!(await exists(resolve(configDir, app)))) {
      add("nexo.config.json", "fail", `Configured app "${app}" does not exist — build the project first.`);
    } else {
      add("nexo.config.json", "ok", `App module: ${app}.`);
    }
  }

  // --- Installed @nexo-alpha packages ---
  const scopeDir = join(root, "node_modules", "@nexo-alpha");
  const installed: { name: string; version: string }[] = [];
  for (const entry of await readdir(scopeDir).catch(() => [] as string[])) {
    const manifest = await readJson(join(scopeDir, entry, "package.json"));
    if (typeof manifest?.version === "string") installed.push({ name: `@nexo-alpha/${entry}`, version: manifest.version });
  }
  if (installed.length === 0) {
    add("packages", "warn", "No @nexo-alpha packages installed in node_modules.");
  } else {
    const versions = new Set(installed.map((p) => p.version));
    if (versions.size > 1) {
      add(
        "packages",
        "warn",
        `Mixed @nexo-alpha versions: ${installed.map((p) => `${p.name}@${p.version}`).join(", ")}. Align them to avoid duplicate types.`
      );
    } else {
      add("packages", "ok", `${installed.length} @nexo-alpha package(s) at ${[...versions][0]}.`);
    }
  }

  // --- TypeScript ---
  const tsconfig = await readJson(join(root, "tsconfig.json"));
  if (tsconfig === undefined) {
    add("tsconfig", "warn", "No tsconfig.json found (fine for plain JavaScript projects).");
  } else {
    const compilerOptions = (tsconfig.compilerOptions ?? {}) as Record<string, unknown>;
    const moduleSetting = String(compilerOptions.module ?? "").toLowerCase();
    if (compilerOptions.strict !== true) {
      add("tsconfig", "warn", 'tsconfig.json does not enable "strict"; Nexo\'s types assume strict mode.');
    } else if (moduleSetting !== "" && !moduleSetting.startsWith("node") && !moduleSetting.startsWith("es")) {
      add("tsconfig", "warn", `tsconfig "module": "${String(compilerOptions.module)}" — use "NodeNext" for ESM.`);
    } else {
      add("tsconfig", "ok", "Strict TypeScript configuration.");
    }
  }

  return { root, checks, ok: checks.every((check) => check.status !== "fail") };
}

const ICONS: Readonly<Record<CheckStatus, string>> = { ok: "✔", warn: "!", fail: "✖" };

export function renderDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map((check) => `${ICONS[check.status]} ${check.name.padEnd(17)} ${check.message}`);
  const failures = report.checks.filter((c) => c.status === "fail").length;
  const warnings = report.checks.filter((c) => c.status === "warn").length;
  lines.push("", report.ok ? `No problems found${warnings > 0 ? ` (${warnings} warning(s))` : ""}.` : `${failures} problem(s), ${warnings} warning(s).`);
  return lines.join("\n");
}

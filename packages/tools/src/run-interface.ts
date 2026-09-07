import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface RunResult {
  readonly success: boolean;
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface NexoRunInterface {
  runTests(): Promise<RunResult>;
  runTypecheck(): Promise<RunResult>;
  runBuild(): Promise<RunResult>;
}

type PackageManager = "pnpm" | "yarn" | "npm";

function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (existsSync(join(projectRoot, "yarn.lock"))) {
    return "yarn";
  }

  return "npm";
}

async function readScripts(
  projectRoot: string
): Promise<Record<string, string>> {
  const packageJsonPath = join(projectRoot, "package.json");

  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `No "package.json" found in project root "${projectRoot}".`
    );
  }

  const raw = await readFile(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  const scripts =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { scripts?: unknown }).scripts
      : undefined;

  return typeof scripts === "object" && scripts !== null
    ? (scripts as Record<string, string>)
    : {};
}

function runCommand(
  projectRoot: string,
  command: string,
  args: readonly string[]
): Promise<RunResult> {
  const startedAt = Date.now();
  const commandLabel = [command, ...args].join(" ");

  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      shell: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolvePromise({
        success: false,
        command: commandLabel,
        exitCode: null,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + error.message,
        durationMs: Date.now() - startedAt
      });
    });

    child.on("close", (exitCode) => {
      resolvePromise({
        success: exitCode === 0,
        command: commandLabel,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

function missingScriptResult(
  scriptName: string,
  projectRoot: string
): RunResult {
  return {
    success: false,
    command: `(no "${scriptName}" script)`,
    exitCode: null,
    stdout: "",
    stderr: `"${projectRoot}"'s package.json has no "${scriptName}" script.`,
    durationMs: 0
  };
}

async function runScript(
  projectRoot: string,
  scriptName: string
): Promise<RunResult> {
  const scripts = await readScripts(projectRoot);

  if (typeof scripts[scriptName] !== "string") {
    return missingScriptResult(scriptName, projectRoot);
  }

  const packageManager = detectPackageManager(projectRoot);
  const args =
    packageManager === "npm"
      ? ["run", scriptName]
      : packageManager === "yarn"
        ? [scriptName]
        : ["run", scriptName];

  return runCommand(projectRoot, packageManager, args);
}

/**
 * Shells out to the target application's own toolchain to run its
 * "test"/"typecheck"/"build" npm scripts, closing the process-shelling
 * half of PRD section 19's verification ops (the other half —
 * validateConfiguration/validateArchitecture/inspectDependencies/
 * checkApplicationHealth — are pure in-memory checks in
 * verification-interface.ts and don't need this).
 *
 * `run_lint()` is deliberately not implemented: there is no lint
 * tooling convention to detect against (this repo itself has none
 * configured), so building it now would mean guessing at a convention
 * rather than following an established one.
 *
 * `projectRoot` is supplied by the caller rather than discovered here
 * — @nexo-alpha/tools stays decoupled from the CLI's `nexo.config.json`
 * convention (`packages/cli/src/config.ts`); a caller that already knows
 * the project root (the CLI, or an AI tool given an explicit path) can
 * pass it directly.
 */
export function createRunInterface(projectRoot: string): NexoRunInterface {
  return {
    runTests() {
      return runScript(projectRoot, "test");
    },

    runTypecheck() {
      return runScript(projectRoot, "typecheck");
    },

    runBuild() {
      return runScript(projectRoot, "build");
    }
  };
}

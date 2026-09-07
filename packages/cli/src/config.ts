import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const CONFIG_FILE_NAME = "nexo.config.json";

export interface NexoConfig {
  readonly app: string;
}

export async function findNexoConfig(startDir: string): Promise<string | undefined> {
  let dir = resolve(startDir);

  while (true) {
    const candidate = join(dir, CONFIG_FILE_NAME);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(dir);

    if (parent === dir) {
      return undefined;
    }

    dir = parent;
  }
}

export async function resolveConfiguredAppPath(
  startDir: string
): Promise<string | undefined> {
  const configPath = await findNexoConfig(startDir);

  if (configPath === undefined) {
    return undefined;
  }

  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { app?: unknown }).app !== "string"
  ) {
    throw new Error(
      `"${configPath}" must have a string "app" field, e.g. { "app": "./dist/app.js" }.`
    );
  }

  return resolve(dirname(configPath), (parsed as NexoConfig).app);
}

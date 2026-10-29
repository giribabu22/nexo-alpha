import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const CONFIG_FILE_NAME = "nexo.config.json";

export interface NexoConfig {
  readonly app: string;
  /** Where records are stored, for `nexo migrate`: a ".json" file or a SQLite database. */
  readonly store?: string;
  /** Module whose default (or `migrations`) export is the migration list, e.g. "./dist/migrations/index.js". */
  readonly migrations?: string;
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

/** The "store" and "migrations" paths of the nearest nexo.config.json, resolved against its folder. */
export async function resolveConfiguredMigrations(
  startDir: string
): Promise<{ readonly store?: string; readonly migrations?: string }> {
  const configPath = await findNexoConfig(startDir);
  if (configPath === undefined) return {};
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<Record<"store" | "migrations", unknown>>;
  const at = (value: unknown, key: string): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new Error(`"${configPath}": "${key}" must be a path string.`);
    return resolve(dirname(configPath), value);
  };
  const store = at(parsed.store, "store");
  const migrations = at(parsed.migrations, "migrations");
  return { ...(store !== undefined ? { store } : {}), ...(migrations !== undefined ? { migrations } : {}) };
}

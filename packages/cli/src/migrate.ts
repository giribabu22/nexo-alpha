import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createFileDocumentStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  migrationStatus,
  type MigrationStatus,
  type NexoDocumentStore,
  type NexoMigration
} from "@nexo-alpha/core";
import { resolveConfiguredMigrations } from "./config.js";

export interface MigrateOptions {
  /** Flags as given; relative to `cwd`. Fall back to nexo.config.json's "store" and "migrations". */
  readonly store?: string | undefined;
  readonly migrations?: string | undefined;
  readonly cwd: string;
}

/** Loads a module whose default (or `migrations`) export is a migration list. */
export async function loadMigrations(modulePath: string): Promise<NexoMigration[]> {
  const imported = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  const list = imported.default ?? imported.migrations;
  if (!Array.isArray(list)) {
    throw new Error(`"${modulePath}" must export its migrations as an array: export default [migration({...}), ...].`);
  }
  return list as NexoMigration[];
}

async function resolvePaths(options: MigrateOptions): Promise<{ store: string; migrations: string }> {
  const configured = await resolveConfiguredMigrations(options.cwd);
  const store = options.store !== undefined ? resolve(options.cwd, options.store) : configured.store;
  const migrations = options.migrations !== undefined ? resolve(options.cwd, options.migrations) : configured.migrations;
  const missing = [store === undefined ? "--store <path>" : "", migrations === undefined ? "--migrations <module>" : ""].filter(Boolean);
  if (store === undefined || migrations === undefined) {
    throw new Error(
      `Pass ${missing.join(" and ")}, or set them in nexo.config.json: { "store": "./data/app.db", "migrations": "./dist/migrations/index.js" }.`
    );
  }
  return { store, migrations };
}

async function openStore(location: string): Promise<NexoDocumentStore> {
  return location.endsWith(".json") ? createFileDocumentStore(location) : createSqliteDocumentStore(location);
}

export interface MigrateStatusResult extends MigrationStatus {
  readonly store: string;
  /** False when the store file doesn't exist yet: every migration is pending. */
  readonly storeExists: boolean;
}

/** `nexo migrate status`: reads only, and never creates the database. */
export async function migrateStatus(options: MigrateOptions): Promise<MigrateStatusResult> {
  const paths = await resolvePaths(options);
  const list = await loadMigrations(paths.migrations);
  if (!existsSync(paths.store)) {
    // Nothing applied yet: compare with an empty store rather than create the database.
    return { ...(await migrationStatus(createInMemoryDocumentStore(), list)), store: paths.store, storeExists: false };
  }
  const store = await openStore(paths.store);
  try {
    return { ...(await migrationStatus(store, list)), store: paths.store, storeExists: true };
  } finally {
    await store.close();
  }
}

export function renderMigrateStatus(result: MigrateStatusResult): string {
  const lines = [`Migrations for ${result.store}${result.storeExists ? "" : " (no database yet)"}`];
  for (const record of result.applied) {
    lines.push(`  applied  ${record.id}  ${record.appliedAt}  by ${record.by}`);
  }
  for (const item of result.pending) {
    lines.push(`  pending  ${item.id}${item.description !== undefined ? `  ${item.description}` : ""}`);
  }
  const problems = [
    ...result.outOfOrder.map(({ id, after }) => `"${id}" is pending but sorts before applied "${after}": check them, then run with --allow-out-of-order`),
    ...result.edited.map((id) => `"${id}" changed after it was applied: write a new migration instead of editing it`),
    ...result.unknown.map((id) => `"${id}" is applied but not in the list: is this code older than the data?`)
  ];
  if (problems.length > 0) lines.push("", "Problems:", ...problems.map((problem) => `  ${problem}`));
  lines.push("", `${result.applied.length} applied, ${result.pending.length} pending`);
  return lines.join("\n");
}

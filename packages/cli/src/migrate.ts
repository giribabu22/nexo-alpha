import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createFileDocumentStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  describeDestructive,
  isResource,
  listBackups,
  migrationStatus,
  planMigrations,
  restoreBackup,
  revertMigration,
  runMigrations,
  type AppliedMigration,
  type BackupInfo,
  type MigrationRunOptions,
  type MigrationStatus,
  type NexoApplication,
  type NexoDocumentStore,
  type NexoMigration,
  type PlannedMigrations,
  type RestoreResult,
  type RunMigrationsResult
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

async function resolvePaths(options: MigrateOptions, need: { store: boolean; migrations: boolean }) {
  const configured = await resolveConfiguredMigrations(options.cwd);
  const store = options.store !== undefined ? resolve(options.cwd, options.store) : configured.store;
  const migrations = options.migrations !== undefined ? resolve(options.cwd, options.migrations) : configured.migrations;
  const missing = [
    need.store && store === undefined ? "--store <path>" : "",
    need.migrations && migrations === undefined ? "--migrations <module>" : ""
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Pass ${missing.join(" and ")}, or set them in nexo.config.json: { "store": "./data/app.db", "migrations": "./dist/migrations/index.js" }.`
    );
  }
  return { store: store ?? "", migrations: migrations ?? "" };
}

async function openStore(location: string): Promise<NexoDocumentStore> {
  return location.endsWith(".json") ? createFileDocumentStore(location) : createSqliteDocumentStore(location);
}

/** Runs `fn` on the store at `location`; an absent store is read as empty and not created unless `create`. */
async function withStore<T>(location: string, create: boolean, fn: (store: NexoDocumentStore) => Promise<T>): Promise<T> {
  const store = existsSync(location) || create ? await openStore(location) : createInMemoryDocumentStore();
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

export interface MigrateStatusResult extends MigrationStatus {
  readonly store: string;
  /** False when the store file doesn't exist yet: every migration is pending. */
  readonly storeExists: boolean;
}

/** `nexo migrate status`: reads only, and never creates the database. */
export async function migrateStatus(options: MigrateOptions): Promise<MigrateStatusResult> {
  const paths = await resolvePaths(options, { store: true, migrations: true });
  const list = await loadMigrations(paths.migrations);
  const status = await withStore(paths.store, false, (store) => migrationStatus(store, list));
  return { ...status, store: paths.store, storeExists: existsSync(paths.store) };
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

export interface MigrateRunFlags extends MigrateOptions {
  readonly production?: boolean;
  readonly allowDestructive?: readonly string[];
  readonly allowOutOfOrder?: boolean;
  readonly maxChanges?: number | undefined;
  /** --no-backup */
  readonly noBackup?: boolean;
  /** --backup-dir; default: "backups" next to the store */
  readonly backupDir?: string | undefined;
}

function runOptions(flags: MigrateRunFlags, warnings: string[]): MigrationRunOptions {
  return {
    ...(flags.production === true ? { production: true } : {}),
    allowDestructive: flags.allowDestructive ?? [],
    allowOutOfOrder: flags.allowOutOfOrder === true,
    ...(flags.maxChanges !== undefined ? { maxChanges: flags.maxChanges } : {}),
    backup: flags.noBackup === true ? false : flags.backupDir !== undefined ? { directory: resolve(flags.cwd, flags.backupDir) } : {},
    onWarning: (message) => warnings.push(message)
  };
}

export interface MigratePlanResult extends PlannedMigrations {
  readonly store: string;
  readonly warnings: readonly string[];
}

/** `nexo migrate plan`: what `up` would do now. Writes nothing, and doesn't create the database. */
export async function migratePlan(flags: MigrateRunFlags): Promise<MigratePlanResult> {
  const paths = await resolvePaths(flags, { store: true, migrations: true });
  const list = await loadMigrations(paths.migrations);
  const warnings: string[] = [];
  const planned = await withStore(paths.store, false, (store) => planMigrations(store, list, runOptions(flags, warnings)));
  return { ...planned, store: paths.store, warnings };
}

export function renderMigratePlan(result: MigratePlanResult): string {
  const lines = [`Plan for ${result.store}: ${result.plans.length} pending migration${result.plans.length === 1 ? "" : "s"}`];
  for (const plan of result.plans) {
    const counts = Object.entries(plan.collections)
      .map(([collection, c]) => `${collection}: ${[c.inserted && `${c.inserted} inserted`, c.updated && `${c.updated} updated`, c.deleted && `${c.deleted} deleted`].filter(Boolean).join(", ")}`)
      .join("; ");
    lines.push("", `  ${plan.id}${plan.description !== undefined ? `  ${plan.description}` : ""}`);
    lines.push(`    ${counts === "" ? "changes no documents" : counts}`);
    if (plan.destructive.length > 0) lines.push(`    DESTRUCTIVE: ${describeDestructive(plan.destructive)}`);
    if (plan.filesReleased.length > 0) {
      const shown = plan.filesReleased.slice(0, 3).map((f) => `${f.name ?? f.id} (${f.owner})`).join(", ");
      lines.push(
        `    releases ${plan.filesReleased.length} uploaded file${plan.filesReleased.length === 1 ? "" : "s"}: ${shown}${plan.filesReleased.length > 3 ? ", …" : ""}`,
        "      (cleanup removes their contents after its delay; restoring a backup after that brings back the records, not the contents)"
      );
    }
    if (plan.indexes.length > 0) lines.push(`    indexes: ${plan.indexes.map((i) => `${i.collection}.${i.field}`).join(", ")}`);
  }
  for (const warning of result.warnings) lines.push("", `Warning: ${warning}`);
  if (result.backupNeeded && result.refusals.length === 0) lines.push("", "A checked backup of the store will be taken first.");
  if (result.refusals.length > 0) lines.push("", "nexo migrate up would stop without applying anything:", ...result.refusals.map((r) => `  ${r}`));
  else if (result.plans.length > 0) lines.push("", "nexo migrate up would apply all of these.");
  return lines.join("\n");
}

export interface MigrateUpResult extends RunMigrationsResult {
  readonly store: string;
  readonly warnings: readonly string[];
}

/** `nexo migrate up`: applies pending migrations, as `serve({ migrations })` does at start. */
export async function migrateUp(flags: MigrateRunFlags): Promise<MigrateUpResult> {
  const paths = await resolvePaths(flags, { store: true, migrations: true });
  const list = await loadMigrations(paths.migrations);
  const warnings: string[] = [];
  if (paths.store.endsWith(".json")) {
    warnings.push("JSON file stores are single-process: make sure the app isn't running on this file, or migrate through serve() instead.");
  }
  const result = await withStore(paths.store, true, (store) => runMigrations(store, list, runOptions(flags, warnings)));
  return { ...result, store: paths.store, warnings };
}

const describeApplied = (a: AppliedMigration) =>
  `${a.id}: ${a.documentsChanged} document${a.documentsChanged === 1 ? "" : "s"} changed` +
  (a.filesReleased > 0 ? `, ${a.filesReleased} uploaded file${a.filesReleased === 1 ? "" : "s"} released` : "") +
  (a.destructive ? " (destructive)" : "");

export function renderMigrateUp(result: MigrateUpResult): string {
  const lines = result.warnings.map((warning) => `Warning: ${warning}`);
  if (result.backup !== undefined) lines.push(`backup   ${result.backup.path}`);
  if (result.applied.length === 0 && result.skipped.length === 0) lines.push(`Nothing to apply to ${result.store}.`);
  for (const applied of result.applied) lines.push(`applied  ${describeApplied(applied)}`);
  for (const id of result.skipped) lines.push(`skipped  ${id} (applied meanwhile by another process)`);
  return lines.join("\n");
}

/** `nexo migrate down <id>`: reverts the newest applied migration. */
export async function migrateDown(flags: MigrateRunFlags & { readonly id: string }): Promise<AppliedMigration & { readonly store: string }> {
  const paths = await resolvePaths(flags, { store: true, migrations: true });
  const list = await loadMigrations(paths.migrations);
  if (!existsSync(paths.store)) throw new Error(`No database at ${paths.store}; nothing is applied.`);
  const reverted = await withStore(paths.store, false, (store) => revertMigration(store, list, flags.id, runOptions(flags, [])));
  return { ...reverted, store: paths.store };
}

export function renderMigrateDown(result: AppliedMigration): string {
  return `reverted ${describeApplied(result)}`;
}

/** "Rename user name" → "rename-user-name" */
function kebab(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface MigrateCreateResult {
  readonly id: string;
  readonly file: string;
  readonly index: string;
  /** False if index.ts exists but has no `export default [...]` to add to. */
  readonly registered: boolean;
}

/**
 * `nexo migrate create <name>`: writes `<dir>/<id>.ts` with a timestamped id,
 * and adds it to `<dir>/index.ts` (creating it if needed).
 */
export async function migrateCreate(options: { readonly name: string; readonly dir: string; readonly cwd: string; readonly now?: Date }): Promise<MigrateCreateResult> {
  const name = kebab(options.name);
  if (name === "") throw new Error("Give the migration a name, e.g. nexo migrate create rename-user-name");
  const stamp = (options.now ?? new Date()).toISOString().replace(/[-:]/g, "").slice(0, 13); // yyyymmddThhmm
  const id = `${stamp}-${name}`;
  const dir = resolve(options.cwd, options.dir);
  const file = join(dir, `${id}.ts`);
  if (existsSync(file)) throw new Error(`${file} already exists.`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    `import { migration } from "@nexo-alpha/core";

export default migration({
  id: "${id}",
  description: "TODO: what this changes",
  async up(m) {
    // e.g. await m.renameField("users", "name", "fullName");
  },
  // Reverses up() for nexo migrate down. Delete it if the change can't be undone.
  async down(m) {
    // e.g. await m.renameField("users", "fullName", "name");
  }
});
`
  );

  const index = join(dir, "index.ts");
  const ident = `m${id.replace(/[^A-Za-z0-9]/g, "_")}`;
  const importLine = `import ${ident} from "./${id}.js";`;
  if (!existsSync(index)) {
    await writeFile(index, `${importLine}\n\n/** Applied in id order; never edit or remove one that has been applied. */\nexport default [${ident}];\n`);
    return { id, file, index, registered: true };
  }
  const source = await readFile(index, "utf8");
  const list = /export default \[([\s\S]*?)\];/.exec(source);
  if (list === null) return { id, file, index, registered: false };
  const items = list[1]!.trim().replace(/,\s*$/, "");
  let updated =
    source.slice(0, list.index) +
    `export default [${items === "" ? ident : `${items}, ${ident}`}];` +
    source.slice(list.index + list[0].length);
  // The import goes after the last import, or first if there are none.
  const lastImport = [...updated.matchAll(/^import .*$/gm)].at(-1);
  updated =
    lastImport === undefined
      ? `${importLine}\n${updated}`
      : `${updated.slice(0, lastImport.index + lastImport[0].length)}\n${importLine}${updated.slice(lastImport.index + lastImport[0].length)}`;
  await writeFile(index, updated);
  return { id, file, index, registered: true };
}

export interface MigrateCheckProblem {
  readonly collection: string;
  readonly id: string;
  readonly errors: readonly string[];
}

export interface MigrateCheckResult {
  readonly store: string;
  /** Collections checked, with how many documents each has. */
  readonly checked: Readonly<Record<string, number>>;
  readonly problems: readonly MigrateCheckProblem[];
}

/**
 * `nexo migrate check`: compares every stored record of each resource in the
 * app with its model: unknown fields, missing required ones, wrong types.
 */
export async function migrateCheck(options: MigrateOptions & { readonly app: NexoApplication }): Promise<MigrateCheckResult> {
  const paths = await resolvePaths(options, { store: true, migrations: false });
  return withStore(paths.store, false, async (store) => {
    if (store.entries === undefined) throw new Error("This store can't list its documents (no entries()).");
    const checked: Record<string, number> = {};
    const problems: MigrateCheckProblem[] = [];
    for (const module of options.app.getModules()) {
      if (!isResource(module)) continue;
      const model = module.model;
      const documents = await store.entries<Record<string, unknown>>(model.name);
      checked[model.name] = documents.length;
      for (const [id, document] of documents) {
        const outcome = model.validate(model.hydrate(document));
        if (!outcome.valid) problems.push({ collection: model.name, id, errors: outcome.errors ?? [] });
      }
    }
    return { store: paths.store, checked, problems };
  });
}

export function renderMigrateCheck(result: MigrateCheckResult): string {
  const lines = [`Checked ${result.store}: ${Object.entries(result.checked).map(([c, n]) => `${c} (${n})`).join(", ") || "no resources"}`];
  if (result.problems.length === 0) {
    lines.push("Every record matches its model.");
    return lines.join("\n");
  }
  lines.push("", `${result.problems.length} record${result.problems.length === 1 ? " doesn't" : "s don't"} match the model:`);
  for (const problem of result.problems.slice(0, 50)) {
    lines.push(`  ${problem.collection}/${problem.id}: ${problem.errors.join("; ")}`);
  }
  if (result.problems.length > 50) lines.push(`  … and ${result.problems.length - 50} more`);
  lines.push("", "Write a migration that brings them in line: nexo migrate create <name>");
  return lines.join("\n");
}

const backupsFolder = (flags: MigrateRunFlags, store: string) =>
  flags.backupDir !== undefined ? resolve(flags.cwd, flags.backupDir) : join(dirname(store), "backups");

export interface MigrateBackupsResult {
  readonly store: string;
  readonly directory: string;
  readonly backups: readonly BackupInfo[];
}

/** `nexo migrate backups`: the store's backups, oldest first. */
export async function migrateBackups(flags: MigrateRunFlags): Promise<MigrateBackupsResult> {
  const { store } = await resolvePaths(flags, { store: true, migrations: false });
  const directory = backupsFolder(flags, store);
  return { store, directory, backups: await listBackups(directory, store) };
}

export function renderMigrateBackups(result: MigrateBackupsResult): string {
  if (result.backups.length === 0) return `No backups of ${result.store} in ${result.directory}.`;
  return [
    `Backups of ${result.store} (oldest first):`,
    ...result.backups.map((b) => `  ${b.path}  ${b.createdAt}  ${b.reason}  ${Object.entries(b.counts).map(([c, n]) => `${c}: ${n}`).join(", ")}`),
    "",
    "Restore one with: nexo migrate restore <path> --app-stopped"
  ].join("\n");
}

/**
 * `nexo migrate restore <backup> --app-stopped`. An idle app using the store
 * can't be detected, so the person running it has to say it is stopped.
 */
export async function migrateRestore(options: { readonly backup: string; readonly cwd: string; readonly appStopped: boolean }): Promise<RestoreResult> {
  if (!options.appStopped) {
    throw new Error(
      "Stop the app that uses this store first, then run again with --app-stopped. " +
        "A running app would keep serving, and writing, the data being replaced."
    );
  }
  return restoreBackup(resolve(options.cwd, options.backup));
}

export function renderMigrateRestore(result: RestoreResult): string {
  return [
    `Restored ${result.restored}.`,
    result.movedAside === undefined ? "There was no store file to replace." : `The file it replaced is at ${result.movedAside}.`,
    "Uploaded file contents aren't part of a store backup; files released after the backup may be gone."
  ].join("\n");
}

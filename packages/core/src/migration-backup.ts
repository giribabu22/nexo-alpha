/**
 * Backups before migrating (docs/architecture/migrations-design.md §9): the
 * store writes and checks a copy (`store.backup()`); this module adds a
 * manifest with a checksum, keeps the newest `retain`, lists them, and
 * restores one.
 *
 * Backups cover the store only: not uploaded file contents, other databases
 * or other systems. They are not encrypted by Nexo. Restore one only while
 * the app using the store is stopped.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NexoMigrationError } from "./errors.js";
import { MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID } from "./migration-lock.js";
import { createFileDocumentStore, createSqliteDocumentStore, type NexoDocumentStore } from "./storage.js";

const MANIFEST_SUFFIX = ".manifest.json";

/** Stored next to each backup as `<backup>.manifest.json`. */
export interface BackupManifest {
  readonly format: 1;
  /** The backup file's name, in the same folder as the manifest. */
  readonly file: string;
  readonly kind: "sqlite" | "json";
  /** The store's file, which a restore replaces. */
  readonly source: string;
  readonly createdAt: string;
  /** e.g. "before 20261029T0730-rename-user-name" */
  readonly reason: string;
  /** Documents per collection, checked when the backup was taken. */
  readonly counts: Readonly<Record<string, number>>;
  readonly sha256: string;
  readonly bytes: number;
}

export interface BackupInfo extends BackupManifest {
  /** The backup file's full path. */
  readonly path: string;
}

export interface TakeBackupOptions {
  /** Default: a "backups" folder next to the store's file. */
  readonly directory?: string | undefined;
  readonly reason: string;
  /** Backups of this store to keep, newest first; older ones are deleted after this one is checked. Default: 5 */
  readonly retain?: number;
  /** Clock override (tests); also names the file. */
  readonly now?: number;
}

const sha256 = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:.]/g, ""); // 20261029T073000123Z

/**
 * Takes a checked backup of `store`, records its manifest, then deletes the
 * oldest backups of the same store beyond `retain`. Resolves with undefined
 * for a store with nothing to back up (in memory). Throws if the store can't
 * back up or the copy fails its check; older backups are left as they were.
 */
export async function takeBackup(store: NexoDocumentStore, options: TakeBackupOptions): Promise<BackupInfo | undefined> {
  if (store.backup === undefined) {
    throw new NexoMigrationError("This store can't back itself up (it has no backup()).");
  }
  const now = options.now ?? Date.now();
  const slug = options.reason.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const copy = await store.backup({ directory: options.directory, name: `${stamp(now)}-${slug}` });
  if (copy === undefined) return undefined;

  const manifest: BackupManifest = {
    format: 1,
    file: path.basename(copy.path),
    kind: copy.kind,
    source: copy.source,
    createdAt: new Date(now).toISOString(),
    reason: options.reason,
    counts: copy.counts,
    sha256: await sha256(copy.path),
    bytes: (await fs.stat(copy.path)).size
  };
  await fs.writeFile(copy.path + MANIFEST_SUFFIX, JSON.stringify(manifest, null, 2), { flag: "wx" });

  // Only now, with the new backup checked and recorded, may older ones go.
  const retain = Math.max(1, options.retain ?? 5);
  const own = await listBackups(path.dirname(copy.path), copy.source);
  for (const old of own.slice(0, Math.max(0, own.length - retain))) {
    await fs.rm(old.path, { force: true });
    await fs.rm(old.path + MANIFEST_SUFFIX, { force: true });
  }
  return { ...manifest, path: copy.path };
}

/** Backups in `directory` (of the store at `source`, if given), oldest first. */
export async function listBackups(directory: string, source?: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const found: BackupInfo[] = [];
  for (const name of names.filter((n) => n.endsWith(MANIFEST_SUFFIX))) {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, name), "utf8")) as BackupManifest;
    if (source !== undefined && path.resolve(manifest.source) !== path.resolve(source)) continue;
    found.push({ ...manifest, path: path.join(directory, manifest.file) });
  }
  return found.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.file < b.file ? -1 : 1));
}

export interface RestoreResult {
  /** The store file that now holds the backup. */
  readonly restored: string;
  /** Where the replaced store file was moved, or undefined if there was none. */
  readonly movedAside: string | undefined;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

async function openKind(kind: BackupManifest["kind"], file: string): Promise<NexoDocumentStore> {
  return kind === "sqlite" ? createSqliteDocumentStore(file) : createFileDocumentStore(file);
}

/**
 * Puts `backupPath` in place of the store it was taken from. Checks the
 * backup's checksum first, and refuses while a migration holds the lock.
 * The replaced file is moved aside, not deleted. Call it only while the app
 * using the store is stopped: an idle app can't be detected.
 */
export async function restoreBackup(backupPath: string, options: { readonly now?: number } = {}): Promise<RestoreResult> {
  const manifestPath = backupPath + MANIFEST_SUFFIX;
  if (!(await exists(manifestPath))) throw new NexoMigrationError(`${backupPath} has no manifest (${manifestPath}); it isn't a Nexo backup.`);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as BackupManifest;
  if (!(await exists(backupPath)) || (await sha256(backupPath)) !== manifest.sha256) {
    throw new NexoMigrationError(`${backupPath} is missing or doesn't match its checksum; it was changed or damaged since it was taken.`);
  }
  const target = manifest.source;

  if (await exists(target)) {
    const current = await openKind(manifest.kind, target);
    try {
      const lock = await current.get<{ owner: string; expiresAt: string; releasedAt?: string }>(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID);
      if (lock !== undefined && lock.releasedAt === undefined && Date.parse(lock.expiresAt) > (options.now ?? Date.now())) {
        throw new NexoMigrationError(`${lock.owner} is migrating this store (lock until ${lock.expiresAt}); restore after it finishes.`);
      }
    } finally {
      await current.close();
    }
  }

  let movedAside: string | undefined;
  if (await exists(target)) {
    movedAside = `${target}.before-restore-${stamp(options.now ?? Date.now())}`;
    if (manifest.kind === "sqlite") {
      // Fold the write-ahead log into the file, so moving the file moves every change.
      const specifier = "node:sqlite";
      const { DatabaseSync } = (await import(specifier)) as { DatabaseSync: new (f: string) => { exec(sql: string): void; close(): void } };
      const db = new DatabaseSync(target);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
    }
    await fs.rename(target, movedAside);
    for (const suffix of ["-wal", "-shm"]) {
      if (await exists(target + suffix)) await fs.rename(target + suffix, movedAside + suffix);
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(backupPath, target);

  // The backup was taken inside the migration lock; release that copy of it, so the next run doesn't wait for it to expire.
  const restored = await openKind(manifest.kind, target);
  try {
    const lock = await restored.get<Record<string, unknown>>(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID);
    if (lock !== undefined && lock.releasedAt === undefined) {
      const at = new Date(options.now ?? Date.now()).toISOString();
      await restored.put(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID, { ...lock, releasedAt: at, expiresAt: at });
    }
  } finally {
    await restored.close();
  }
  return { restored: target, movedAside };
}

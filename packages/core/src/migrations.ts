/**
 * Migrations: deliberate, recorded changes to stored documents when models
 * change (docs/architecture/migrations-design.md).
 *
 * ```ts
 * export default migration({
 *   id: "20261029T0730-rename-user-name",
 *   description: "users: name → fullName",
 *   up: (m) => m.renameField("users", "name", "fullName"),
 *   down: (m) => m.renameField("users", "fullName", "name")
 * });
 * ```
 *
 * This module defines migrations, validates lists of them, and tracks which
 * ran: one record per applied migration in the `nexo_migrations` collection.
 * Applying them atomically is the store's `writeBatch` (design step 2).
 */

import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { NexoMigrationError } from "./errors.js";
import { acquireMigrationLock, MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID, type MigrationLockOptions } from "./migration-lock.js";
import type { NexoDocumentStore } from "./storage.js";

/** `<UTC yyyymmdd>T<hhmm[ss]>-<kebab-name>`, e.g. `20261029T0730-rename-user-name`. Nexo's own add a `nexo:` prefix. */
export const MIGRATION_ID = /^\d{8}T\d{4}(?:\d{2})?-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NEXO_NAMESPACE = "nexo:";

/** A stored document as migrations see it: plain JSON, not a model instance. */
export type MigrationDocument = { readonly id: string } & Record<string, unknown>;

/** Returned from an `update` callback to delete the document. */
export interface MigrationRemove {
  readonly nexoMigrationRemove: true;
}

/**
 * What `up` and `down` change documents through. Changes are collected and
 * applied together when the function returns, so a migration can't
 * half-write. The helpers change a document only if it still needs it.
 */
export interface MigrationContext {
  /** Return this from an `update` callback to delete the document. */
  readonly remove: MigrationRemove;
  /** Calls `fn` for every document; return a changed copy, the same document, or `remove`. */
  update(
    collection: string,
    fn: (document: MigrationDocument) => MigrationDocument | MigrationRemove | Promise<MigrationDocument | MigrationRemove>
  ): Promise<void>;
  /** Adds a document; an `id` is generated if missing. */
  insert(collection: string, document: Record<string, unknown>): Promise<void>;
  /** Reads a document, seeing this migration's earlier changes. */
  get(collection: string, id: string): Promise<MigrationDocument | undefined>;
  /** Reads a collection, seeing this migration's earlier changes. */
  list(collection: string): Promise<MigrationDocument[]>;
  /** Moves `from` to `to`; documents that already have `to` are left alone. */
  renameField(collection: string, from: string, to: string): Promise<void>;
  /** Deletes `field` from every document. */
  removeField(collection: string, field: string): Promise<void>;
  /** Fills `field` where it is missing, with a value or one computed per document. */
  setField(collection: string, field: string, value: unknown | ((document: MigrationDocument) => unknown)): Promise<void>;
  /** Asks the store to index `field` (SQLite), after the migration commits. */
  index(collection: string, field: string): Promise<void>;
}

export interface MigrationDefinition {
  /** Sorts migrations; see {@link MIGRATION_ID}. Never change it once applied. */
  readonly id: string;
  readonly description?: string;
  readonly up: (m: MigrationContext) => void | Promise<void>;
  /** Reverses `up`, for `nexo migrate down`. Leave it out when that isn't possible. */
  readonly down?: (m: MigrationContext) => void | Promise<void>;
  /** Run once per project of a `scopeByProject()` store. */
  readonly perProject?: boolean;
}

export interface NexoMigration extends MigrationDefinition {
  /** Hash of `up`, `down` and `perProject`, to notice applied migrations edited later. */
  readonly checksum: string;
}

/** One applied migration, stored under its id in `nexo_migrations`. */
export interface MigrationRecord {
  readonly id: string;
  readonly description?: string;
  readonly checksum: string;
  readonly appliedAt: string;
  readonly durationMs: number;
  /** The process that applied it. */
  readonly by: string;
  /** Documents inserted, updated or deleted. */
  readonly documentsChanged?: number;
  /** Whether it deleted documents, removed values or changed their types. */
  readonly destructive?: boolean;
}

export interface MigrationStatus {
  /** Records of applied migrations, in order. */
  readonly applied: readonly MigrationRecord[];
  /** Migrations not applied yet, in the order they would run. */
  readonly pending: readonly NexoMigration[];
  /** Pending migrations that sort before one already applied: running them needs a person's check. */
  readonly outOfOrder: readonly { readonly id: string; readonly after: string }[];
  /** Applied migrations whose code changed since. */
  readonly edited: readonly string[];
  /** Applied migrations missing from the list, e.g. when this code is older than the data. */
  readonly unknown: readonly string[];
}

const isNexoId = (id: string) => id.startsWith(NEXO_NAMESPACE);
/** Nexo's own migrations run first; within a namespace, by id. */
const compareIds = (a: string, b: string) =>
  isNexoId(a) !== isNexoId(b) ? (isNexoId(a) ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0;

export function migration(definition: MigrationDefinition): NexoMigration {
  const { id, description, up, down, perProject } = definition;
  const bare = typeof id === "string" && isNexoId(id) ? id.slice(NEXO_NAMESPACE.length) : id;
  if (typeof bare !== "string" || !MIGRATION_ID.test(bare)) {
    throw new NexoMigrationError(
      `Invalid migration id ${JSON.stringify(id)}: use "<yyyymmdd>T<hhmm>-<name>", e.g. "20261029T0730-rename-user-name".`
    );
  }
  if (typeof up !== "function") throw new NexoMigrationError(`Migration "${id}" has no up() function.`);
  if (down !== undefined && typeof down !== "function") throw new NexoMigrationError(`Migration "${id}": down must be a function.`);
  if (description !== undefined && typeof description !== "string") {
    throw new NexoMigrationError(`Migration "${id}": description must be a string.`);
  }
  const checksum = createHash("sha256")
    .update(JSON.stringify([String(up), down === undefined ? null : String(down), perProject === true]))
    .digest("hex")
    .slice(0, 16);
  return Object.freeze({ ...definition, checksum });
}

/**
 * Checks an app's migration list and returns it in run order. Refuses
 * anything not made by `migration()`, duplicate ids, and ids in Nexo's own
 * `nexo:` namespace, which only Nexo's packages may use.
 */
export function validateMigrationList(
  list: readonly NexoMigration[],
  options: { readonly allowNexoNamespace?: boolean } = {}
): NexoMigration[] {
  if (!Array.isArray(list)) throw new NexoMigrationError("Migrations must be an array of migration(...) values.");
  const seen = new Set<string>();
  for (const [index, item] of list.entries()) {
    if (typeof item !== "object" || item === null || typeof item.checksum !== "string") {
      throw new NexoMigrationError(`Migration #${index + 1} wasn't made with migration(...).`);
    }
    if (seen.has(item.id)) throw new NexoMigrationError(`Migration id "${item.id}" is used twice.`);
    seen.add(item.id);
    if (isNexoId(item.id) && options.allowNexoNamespace !== true) {
      throw new NexoMigrationError(`Migration "${item.id}": ids starting "nexo:" belong to Nexo's own migrations.`);
    }
  }
  return [...list].sort((a, b) => compareIds(a.id, b.id));
}

/** The applied records in a store, in order. */
export async function readMigrationRecords(store: NexoDocumentStore): Promise<MigrationRecord[]> {
  // The lock lives in the same collection and has no id field.
  const documents = await store.list<Partial<MigrationRecord>>(MIGRATIONS_COLLECTION);
  return documents
    .filter((document): document is MigrationRecord => typeof document.id === "string" && document.id !== MIGRATION_LOCK_ID)
    .sort((a, b) => compareIds(a.id, b.id));
}

/** Compares a (validated, sorted) list with the applied records. */
export function compareWithRecords(list: readonly NexoMigration[], records: readonly MigrationRecord[]): MigrationStatus {
  const recorded = new Map(records.map((record) => [record.id, record]));
  const known = new Set(list.map((item) => item.id));
  const pending = list.filter((item) => !recorded.has(item.id));
  const lastApplied = (nexo: boolean) =>
    records.filter((record) => isNexoId(record.id) === nexo).map((record) => record.id).sort(compareIds).at(-1);
  const outOfOrder = pending.flatMap((item) => {
    const after = lastApplied(isNexoId(item.id));
    return after !== undefined && compareIds(item.id, after) < 0 ? [{ id: item.id, after }] : [];
  });
  return {
    applied: records,
    pending,
    outOfOrder,
    edited: list.filter((item) => recorded.has(item.id) && recorded.get(item.id)!.checksum !== item.checksum).map((item) => item.id),
    unknown: records.filter((record) => !known.has(record.id)).map((record) => record.id)
  };
}

/** Which migrations of `list` are applied to `store` and which are pending. Reads only. */
export async function migrationStatus(store: NexoDocumentStore, list: readonly NexoMigration[]): Promise<MigrationStatus> {
  return compareWithRecords(validateMigrationList(list), await readMigrationRecords(store));
}

/** The record to store for `item`, applied by `by` starting at `startedAt`. */
export function createMigrationRecord(
  item: NexoMigration,
  by: string,
  startedAt: number,
  now = Date.now(),
  changes?: { readonly documentsChanged: number; readonly destructive: boolean }
): MigrationRecord {
  return {
    id: item.id,
    ...(item.description !== undefined ? { description: item.description } : {}),
    checksum: item.checksum,
    appliedAt: new Date(now).toISOString(),
    durationMs: Math.max(0, now - startedAt),
    by,
    ...changes
  };
}

export interface RunPendingOptions {
  /** Lock options, or `false` to rely only on the records' atomic insert (tests). */
  readonly lock?: MigrationLockOptions | false;
  /** Run pending migrations that sort before applied ones (after a person checked them). */
  readonly allowOutOfOrder?: boolean;
  /** Edited and unknown migrations. Default: console.warn */
  readonly onWarning?: (message: string) => void;
  /** Nexo's own migrations are in the list (packages, not apps). */
  readonly allowNexoNamespace?: boolean;
  /** Runs inside the lock, after the order checks and before anything is applied; throw to stop. */
  readonly prepare?: (pending: readonly NexoMigration[]) => Promise<void>;
}

export interface RunPendingResult {
  /** Applied by this run, in order. */
  readonly applied: readonly string[];
  /** Applied meanwhile by another process. */
  readonly skipped: readonly string[];
}

/**
 * Applies one migration and stores its record in the same atomic write;
 * returns false, writing nothing, if the record already exists.
 */
export type ApplyMigration = (
  item: NexoMigration,
  info: {
    readonly by: string;
    readonly startedAt: number;
    /** Throws if the lock was lost; call right before writing. */
    readonly assertHeld: () => void;
  }
) => Promise<boolean>;

/**
 * Validates `list`, takes the lock, checks order and edits, and applies each
 * pending migration with `apply`, in order, stopping at the first failure.
 */
export async function runPendingMigrations(
  store: NexoDocumentStore,
  list: readonly NexoMigration[],
  apply: ApplyMigration,
  options: RunPendingOptions = {}
): Promise<RunPendingResult> {
  const ordered = validateMigrationList(list, { allowNexoNamespace: options.allowNexoNamespace === true });
  const warn = options.onWarning ?? ((message: string) => console.warn(`nexo migrations: ${message}`));
  const lock = options.lock === false ? undefined : await acquireMigrationLock(store, options.lock ?? {});
  const by = lock?.owner ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  try {
    const status = compareWithRecords(ordered, await readMigrationRecords(store));
    for (const id of status.edited) {
      warn(`migration "${id}" changed after it was applied. Applied migrations aren't run again; write a new migration instead.`);
    }
    for (const id of status.unknown) {
      warn(`migration "${id}" is recorded as applied but isn't in the list. Is this code older than the data?`);
    }
    if (status.outOfOrder.length > 0 && options.allowOutOfOrder !== true) {
      const pairs = status.outOfOrder.map(({ id, after }) => `"${id}" sorts before applied "${after}"`).join("; ");
      throw new NexoMigrationError(
        `Pending migrations are out of order: ${pairs}. Check that they don't touch the same data, then run with allowOutOfOrder.`
      );
    }

    await options.prepare?.(status.pending);

    const applied: string[] = [];
    const skipped: string[] = [];
    const assertHeld = () => lock?.assertHeld();
    for (const item of status.pending) {
      assertHeld();
      if (await apply(item, { by, startedAt: Date.now(), assertHeld })) {
        applied.push(item.id);
      } else if ((await store.get(MIGRATIONS_COLLECTION, item.id)) !== undefined) {
        skipped.push(item.id);
      } else {
        throw new NexoMigrationError(`Migration "${item.id}" was neither applied nor recorded by another process.`);
      }
    }
    return { applied, skipped };
  } finally {
    // An unreleased lease frees itself when it expires; don't hide the run's own error.
    await lock?.release().catch(() => undefined);
  }
}

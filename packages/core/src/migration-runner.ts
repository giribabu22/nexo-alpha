/**
 * Planning, applying and reverting migrations
 * (docs/architecture/migrations-design.md §5–8).
 *
 * ```ts
 * const plan = await planMigrations(store, migrations);   // what would change; writes nothing
 * await runMigrations(store, migrations);                   // applies pending ones, each all-or-nothing
 * ```
 *
 * Each migration is computed from fresh reads, then written with its record
 * in one `writeBatch`. If the app changed a document in between, the batch
 * writes nothing and the migration is computed again (up to 5 times).
 *
 * Before the first migration of a run, a checked backup is taken if any
 * pending migration is destructive, or none has ever been applied to the
 * store. If it can't be taken, nothing is applied.
 */

import { NexoMigrationError } from "./errors.js";
import { takeBackup, type BackupInfo } from "./migration-backup.js";
import { acquireMigrationLock, MIGRATIONS_COLLECTION, type MigrationLockOptions } from "./migration-lock.js";
import { assertMigratable, computeMigration, withWrites, type DestructiveChange, type MigrationPlan, type MigrationReader } from "./migration-plan.js";
import {
  allMigrations,
  createMigrationRecord,
  migrationStatus,
  readMigrationRecords,
  runPendingMigrations,
  validateMigrationList,
  type MigrationRecord,
  type MigrationStatus,
  type NexoMigration
} from "./migrations.js";
import type { NexoDocumentStore } from "./storage.js";
import type { NexoModule } from "./module.js";

const MAX_ATTEMPTS = 5;

export interface MigrationRunOptions {
  /** Production refuses destructive migrations unless approved. Default: `NODE_ENV === "production"` */
  readonly production?: boolean;
  /** Ids of destructive migrations approved to run in production. */
  readonly allowDestructive?: readonly string[];
  /** Most documents one migration may change; it is refused above this. Default: 100,000 */
  readonly maxChanges?: number;
  /** Run pending migrations that sort before applied ones (after a person checked them). */
  readonly allowOutOfOrder?: boolean;
  readonly lock?: MigrationLockOptions;
  /** Edited or unknown migrations, failed index requests. Default: console.warn */
  readonly onWarning?: (message: string) => void;
  /**
   * Backups before migrating. Default: on, newest 5 kept, in a "backups"
   * folder next to the store's file. `false` turns them off (e.g. when the
   * platform snapshots disks); destructive migrations then run without one.
   */
  readonly backup?: false | { readonly retain?: number; readonly directory?: string };
  /** The app's modules: Nexo's own migrations (`module.migrations`) are collected from them and run first. */
  readonly modules?: readonly NexoModule[];
}

export interface AppliedMigration {
  readonly id: string;
  readonly documentsChanged: number;
  readonly destructive: boolean;
  /** Uploaded files released for cleanup, because their records were deleted or no longer use them. */
  readonly filesReleased: number;
}

export interface RunMigrationsResult {
  /** Applied by this run, in order. */
  readonly applied: readonly AppliedMigration[];
  /** Applied meanwhile by another process. */
  readonly skipped: readonly string[];
  /** The backup taken before applying; undefined if none was needed or the store is in memory. */
  readonly backup: BackupInfo | undefined;
}

export interface PlannedMigrations extends MigrationStatus {
  /** Whether running now would take a backup first. */
  readonly backupNeeded: boolean;
  /** One plan per pending migration, each computed as if the ones before it had been applied. */
  readonly plans: readonly MigrationPlan[];
  /** Why running now would stop before applying anything; empty if it would run. */
  readonly refusals: readonly string[];
}

function settings(options: MigrationRunOptions) {
  return {
    production: options.production ?? process.env.NODE_ENV === "production",
    allowDestructive: new Set(options.allowDestructive ?? []),
    maxChanges: options.maxChanges ?? 100_000,
    backup: options.backup === false ? undefined : (options.backup ?? {}),
    warn: options.onWarning ?? ((message: string) => console.warn(`nexo migrations: ${message}`))
  };
}

/** "deletes 2 documents (notes/a, notes/b); removes 1 value (users/u1.email)" */
export function describeDestructive(changes: readonly DestructiveChange[]): string {
  const groups: Array<[string, string, (c: DestructiveChange) => string]> = [
    ["delete", "deletes {n} document{s}", (c) => `${c.collection}/${c.id}`],
    ["remove-field", "removes {n} value{s}", (c) => `${c.collection}/${c.id}.${"field" in c ? c.field : ""}`],
    [
      "change-type",
      "changes the type of {n} value{s}",
      (c) => (c.kind === "change-type" ? `${c.collection}/${c.id}.${c.field}: ${c.from} → ${c.to}` : "")
    ]
  ];
  return groups
    .map(([kind, text, example]) => {
      const matching = changes.filter((c) => c.kind === kind);
      if (matching.length === 0) return "";
      const shown = matching.slice(0, 3).map(example).join(", ") + (matching.length > 3 ? ", …" : "");
      return `${text.replace("{n}", String(matching.length)).replace("{s}", matching.length === 1 ? "" : "s")} (${shown})`;
    })
    .filter(Boolean)
    .join("; ");
}

function refusal(plan: MigrationPlan, s: ReturnType<typeof settings>): string | undefined {
  if (plan.writes.length > s.maxChanges) {
    return (
      `Migration "${plan.id}" changes ${plan.writes.length} documents, over maxChanges (${s.maxChanges}). ` +
      "Raise maxChanges if one transaction of that size is acceptable; batch mode for larger migrations isn't available yet."
    );
  }
  if (s.production && plan.destructive.length > 0 && !s.allowDestructive.has(plan.id)) {
    return (
      `Migration "${plan.id}" ${plan.direction === "down" ? "(down) " : ""}is destructive: it ${describeDestructive(plan.destructive)}. ` +
      `In production it needs approval: allowDestructive: ["${plan.id}"], or nexo migrate up --allow-destructive ${plan.id}.`
    );
  }
  return undefined;
}

async function planPending(
  store: NexoDocumentStore,
  status: MigrationStatus,
  s: ReturnType<typeof settings>
): Promise<{ plans: MigrationPlan[]; refusals: string[]; backupNeeded: boolean }> {
  const plans: MigrationPlan[] = [];
  let view: MigrationReader = store as MigrationReader;
  for (const item of status.pending) {
    const plan = await computeMigration(view, item, "up");
    plans.push(plan);
    view = withWrites(view, [...plan.writes, ...plan.fileWrites]);
  }
  const refusals = plans.map((plan) => refusal(plan, s)).filter((r): r is string => r !== undefined);
  const destructive = plans.filter((plan) => plan.destructive.length > 0);
  const backupNeeded = s.backup !== undefined && plans.length > 0 && (destructive.length > 0 || status.applied.length === 0);
  if (backupNeeded && destructive.length > 0 && store.backup === undefined) {
    refusals.push(
      `Migration "${destructive[0]!.id}" is destructive, and this store can't back itself up (no backup()). ` +
        "Pass backup: false to run destructive migrations without a backup."
    );
  }
  return { plans, refusals, backupNeeded };
}

/** What running the pending migrations would do now. Reads only. */
export async function planMigrations(
  store: NexoDocumentStore,
  list: readonly NexoMigration[],
  options: MigrationRunOptions = {}
): Promise<PlannedMigrations> {
  assertMigratable(store);
  const status = await migrationStatus(store, list, { modules: options.modules ?? [] });
  const s = settings(options);
  const { plans, refusals, backupNeeded } = await planPending(store, status, s);
  const order =
    status.outOfOrder.length > 0 && options.allowOutOfOrder !== true
      ? [`Pending migrations are out of order: ${status.outOfOrder.map(({ id, after }) => `"${id}" sorts before applied "${after}"`).join("; ")}.`]
      : [];
  return { ...status, plans, backupNeeded, refusals: [...order, ...refusals] };
}

async function requestIndexes(store: NexoDocumentStore, plan: MigrationPlan, warn: (message: string) => void): Promise<void> {
  for (const { collection, field } of plan.indexes) {
    // The migration is already committed; an index only makes queries faster, and resources request their own.
    await store.index?.(collection, field).catch((error: unknown) =>
      warn(`migration "${plan.id}" is applied, but indexing ${collection}.${field} failed: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Applies pending migrations in order, each with its record in one atomic
 * batch. Before applying anything, every pending migration is planned; if
 * one would be refused (too big, or destructive in production without
 * approval), nothing runs.
 */
export async function runMigrations(
  store: NexoDocumentStore,
  list: readonly NexoMigration[],
  options: MigrationRunOptions = {}
): Promise<RunMigrationsResult> {
  assertMigratable(store);
  const s = settings(options);
  const applied: AppliedMigration[] = [];
  let backup: BackupInfo | undefined;

  const result = await runPendingMigrations(
    store,
    allMigrations(list, options.modules),
    async (item, { by, startedAt, assertHeld }) => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const plan = await computeMigration(store, item, "up");
        const refused = refusal(plan, s);
        if (refused !== undefined) throw new NexoMigrationError(refused);
        const destructive = plan.destructive.length > 0;
        const record = createMigrationRecord(item, by, startedAt, Date.now(), {
          documentsChanged: plan.writes.length,
          filesReleased: plan.filesReleased.length,
          destructive,
          ...(backup !== undefined ? { backup: backup.path } : {})
        });
        assertHeld();
        const batch = [...plan.writes, ...plan.fileWrites, { collection: MIGRATIONS_COLLECTION, id: item.id, expected: undefined, next: record }];
        if (await store.writeBatch(batch)) {
          await requestIndexes(store, plan, s.warn);
          applied.push({ id: item.id, documentsChanged: plan.writes.length, destructive, filesReleased: plan.filesReleased.length });
          return true;
        }
        if ((await store.get(MIGRATIONS_COLLECTION, item.id)) !== undefined) return false; // applied by another process
      }
      throw new NexoMigrationError(
        `Migration "${item.id}" kept conflicting with other writes (${MAX_ATTEMPTS} attempts); nothing of it was written.`
      );
    },
    {
      ...(options.lock !== undefined ? { lock: options.lock } : {}),
      ...(options.allowOutOfOrder !== undefined ? { allowOutOfOrder: options.allowOutOfOrder } : {}),
      onWarning: s.warn,
      allowNexoNamespace: true,
      prepare: async (pending, status) => {
        const { refusals, backupNeeded } = await planPending(store, status, s);
        if (refusals.length > 0) throw new NexoMigrationError(`Nothing was applied. ${refusals.join(" ")}`);
        if (!backupNeeded || s.backup === undefined) return;
        if (store.backup === undefined) {
          s.warn("this store can't back itself up (no backup()); migrating without a backup.");
          return;
        }
        try {
          backup = await takeBackup(store, { ...s.backup, reason: `before ${pending[0]!.id}` });
        } catch (error) {
          throw new NexoMigrationError(
            `The backup before migrating failed, so nothing was applied: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  );
  return { applied, skipped: result.skipped, backup };
}

/**
 * Runs `id`'s `down()` and removes its record, in one atomic batch. Only the
 * most recently applied migration can be reverted.
 */
export async function revertMigration(
  store: NexoDocumentStore,
  list: readonly NexoMigration[],
  id: string,
  options: MigrationRunOptions = {}
): Promise<AppliedMigration> {
  assertMigratable(store);
  const s = settings(options);
  if (id.startsWith("nexo:")) {
    throw new NexoMigrationError(`"${id}" is one of Nexo's own migrations; it can't be reverted. Restore a backup taken before it instead.`);
  }
  const item = validateMigrationList(list).find((candidate) => candidate.id === id);
  if (item === undefined) throw new NexoMigrationError(`Migration "${id}" isn't in the list.`);
  if (item.down === undefined) throw new NexoMigrationError(`Migration "${id}" has no down(); it can't be reverted. Write a new migration instead.`);

  const lock = await acquireMigrationLock(store, options.lock ?? {});
  try {
    const latest = (await readMigrationRecords(store))
      .filter((record) => !record.id.startsWith("nexo:"))
      .sort((a, b) => (a.appliedAt < b.appliedAt ? -1 : a.appliedAt > b.appliedAt ? 1 : a.id < b.id ? -1 : 1))
      .at(-1);
    if (latest?.id !== id) {
      throw new NexoMigrationError(
        latest === undefined
          ? `Migration "${id}" isn't applied.`
          : `Only the most recently applied migration can be reverted, and that's "${latest.id}".`
      );
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const plan = await computeMigration(store, item, "down");
      const refused = refusal(plan, s);
      if (refused !== undefined) throw new NexoMigrationError(refused);
      const record = await store.get<MigrationRecord>(MIGRATIONS_COLLECTION, id);
      lock.assertHeld();
      if (await store.writeBatch([...plan.writes, ...plan.fileWrites, { collection: MIGRATIONS_COLLECTION, id, expected: record, next: undefined }])) {
        await requestIndexes(store, plan, s.warn);
        return { id, documentsChanged: plan.writes.length, destructive: plan.destructive.length > 0, filesReleased: plan.filesReleased.length };
      }
    }
    throw new NexoMigrationError(`Reverting "${id}" kept conflicting with other writes (${MAX_ATTEMPTS} attempts); nothing was written.`);
  } finally {
    await lock.release().catch(() => undefined);
  }
}

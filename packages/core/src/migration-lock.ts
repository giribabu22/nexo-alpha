/**
 * The migration lock: a lease document in the store, so only one process
 * applies migrations at a time (docs/architecture/migrations-design.md §7).
 *
 * Taking it relies on the store's atomic `insert` (SQLite: across processes).
 * A holder renews the lease while it works; a crashed holder's lease expires,
 * and the next process takes it over with `replaceIf`. Leases compare wall
 * clocks, so processes sharing a store need clocks within a lease of each
 * other. The lock isn't the only guard: each migration's record is inserted
 * atomically too, so a migration can't be recorded twice even if a lease is lost.
 */

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { NexoConfigurationError, NexoMigrationError } from "./errors.js";
import type { NexoDocumentStore } from "./storage.js";

/** Holds a record per applied migration, and the lock. */
export const MIGRATIONS_COLLECTION = "nexo_migrations";
/** The lock's document id; migration ids can't take this form. */
export const MIGRATION_LOCK_ID = "__lock";

interface LockDocument {
  readonly owner: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly releasedAt?: string;
}

export interface MigrationLockOptions {
  /** How long a lease lasts without renewal. Default: 10 minutes */
  readonly leaseMs?: number;
  /** How long to wait for another process's lock. Default: 10 minutes */
  readonly waitMs?: number;
  /** How often to check while waiting. Default: 250 ms */
  readonly pollMs?: number;
  /** Names the holder in the lock and in records. Default: `<host>:<pid>:<random>` */
  readonly owner?: string;
  /** Clock override, ms since epoch (tests). */
  readonly now?: () => number;
}

export interface MigrationLock {
  readonly owner: string;
  /** Throws NexoMigrationError if the lease was lost or ran out; call before each write. */
  assertHeld(): void;
  /** Ends the lease so the next process can take it at once. Safe to call twice. */
  release(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function acquireMigrationLock(
  store: NexoDocumentStore,
  options: MigrationLockOptions = {}
): Promise<MigrationLock> {
  if (store.insert === undefined) {
    throw new NexoConfigurationError(
      "Migrations need a store with an atomic insert() to lock against other processes; this store has none."
    );
  }
  const insert = store.insert.bind(store);
  const leaseMs = options.leaseMs ?? 10 * 60 * 1000;
  const waitMs = options.waitMs ?? 10 * 60 * 1000;
  const pollMs = options.pollMs ?? 250;
  const now = options.now ?? Date.now;
  const owner = options.owner ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function take(): Promise<LockDocument | undefined> {
    const at = now();
    const mine: LockDocument = { owner, acquiredAt: iso(at), expiresAt: iso(at + leaseMs) };
    if (await insert(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID, mine)) return mine;
    const current = await store.get<LockDocument>(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID);
    if (current === undefined) return undefined; // removed meanwhile; the next try inserts
    if (current.releasedAt === undefined && Date.parse(current.expiresAt) > at) return undefined;
    return (await store.replaceIf(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID, current, mine)) ? mine : undefined;
  }

  const deadline = now() + waitMs;
  let held = await take();
  while (held === undefined) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      const current = await store.get<LockDocument>(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID);
      throw new NexoMigrationError(
        `Migrations are locked by ${current?.owner ?? "another process"} until ${current?.expiresAt ?? "unknown"}. ` +
          "Another instance is migrating; if it crashed, the lock frees itself when that time passes."
      );
    }
    await sleep(Math.min(pollMs, remaining));
    held = await take();
  }

  let current: LockDocument = held;
  let lost = false;
  let released = false;

  async function renew(): Promise<void> {
    const stored = await store.get<LockDocument>(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID);
    if (stored?.owner !== owner || stored.releasedAt !== undefined) {
      lost = true;
      return;
    }
    const next: LockDocument = { ...stored, expiresAt: iso(now() + leaseMs) };
    if (await store.replaceIf(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID, stored, next)) current = next;
  }
  // A failed renewal is retried on the next tick; assertHeld() stops work once the known lease runs out.
  const timer = setInterval(() => void renew().catch(() => undefined), Math.max(10, Math.floor(leaseMs / 3)));
  timer.unref?.();

  return {
    owner,
    assertHeld() {
      if (released) throw new NexoMigrationError("The migration lock was released.");
      if (lost || now() >= Date.parse(current.expiresAt)) {
        throw new NexoMigrationError(`The migration lock held by ${owner} was lost (its lease ran out). Nothing more was applied.`);
      }
    },
    async release() {
      if (released) return;
      released = true;
      clearInterval(timer);
      const stored = await store.get<LockDocument>(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID);
      if (stored?.owner !== owner || stored.releasedAt !== undefined) return;
      const at = iso(now());
      await store.replaceIf(MIGRATIONS_COLLECTION, MIGRATION_LOCK_ID, stored, { ...stored, releasedAt: at, expiresAt: at });
    }
  };
}

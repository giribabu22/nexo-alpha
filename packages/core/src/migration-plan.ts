/**
 * Computing a migration: runs `up` (or `down`) against documents read from a
 * store and turns what it did into writes for `writeBatch`, without writing
 * anything (docs/architecture/migrations-design.md §4–5). The same plan is
 * what `nexo migrate plan` shows and what the runner applies.
 */

import { randomUUID } from "node:crypto";
import { NexoMigrationError } from "./errors.js";
import { MIGRATIONS_COLLECTION } from "./migration-lock.js";
import type { MigrationContext, MigrationDocument, MigrationRemove, NexoMigration } from "./migrations.js";
import type { DocumentWrite, NexoDocumentStore } from "./storage.js";
import { FILES_COLLECTION } from "./file-attachments.js";

/** What computing a migration reads: any store with `entries`, or a plan overlay. */
export interface MigrationReader {
  get<T = unknown>(collection: string, id: string): Promise<T | undefined>;
  entries<T = unknown>(collection: string): Promise<Array<[id: string, document: T]>>;
}

/** A change that loses data, found by comparing each write's document before and after. */
export type DestructiveChange =
  | { readonly kind: "delete"; readonly collection: string; readonly id: string }
  | { readonly kind: "remove-field"; readonly collection: string; readonly id: string; readonly field: string }
  | {
      readonly kind: "change-type";
      readonly collection: string;
      readonly id: string;
      readonly field: string;
      readonly from: string;
      readonly to: string;
    };

export interface MigrationPlan {
  readonly id: string;
  readonly description?: string;
  readonly direction: "up" | "down";
  /** The writes, each with the document as read; empty if there is nothing to change. */
  readonly writes: readonly DocumentWrite[];
  /** Counts per collection. */
  readonly collections: Readonly<Record<string, { readonly inserted: number; readonly updated: number; readonly deleted: number }>>;
  readonly destructive: readonly DestructiveChange[];
  /** Index requests, run after the migration commits. */
  readonly indexes: readonly { readonly collection: string; readonly field: string }[];
}

/** `m.remove`: returned from an update callback to delete the document. */
export const MIGRATION_REMOVE: MigrationRemove = Object.freeze({ nexoMigrationRemove: true });

/** The collection Nexo's project registry uses by default; its ids are the projects a perProject migration runs for. */
const PROJECTS_COLLECTION = "nexo_projects";

interface Entry {
  /** JSON as read from the store; undefined if it didn't exist. */
  readonly original: string | undefined;
  /** Whether the stored document keeps its id inside it (resource records do; e.g. auth-emails don't). */
  readonly hasIdField: boolean;
  current: Record<string, unknown> | undefined;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const kindOf = (value: unknown) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

function assertStoredId(collection: string, id: string, document: unknown): Record<string, unknown> {
  if (!isPlainObject(document)) {
    throw new NexoMigrationError(`"${collection}/${id}" isn't a JSON object; migrations change objects only.`);
  }
  if ("id" in document && document.id !== id) {
    throw new NexoMigrationError(`"${collection}/${id}" has an id field ${JSON.stringify(document.id)} that differs from its key.`);
  }
  return document;
}

/** Collections a migration may not write: the runner manages them. */
function reservedCollections(item: NexoMigration): readonly string[] {
  return item.id.startsWith("nexo:") ? [MIGRATIONS_COLLECTION] : [MIGRATIONS_COLLECTION, FILES_COLLECTION];
}

export async function computeMigration(
  reader: MigrationReader,
  item: NexoMigration,
  direction: "up" | "down" = "up"
): Promise<MigrationPlan> {
  const run = direction === "up" ? item.up : item.down;
  if (run === undefined) throw new NexoMigrationError(`Migration "${item.id}" has no down(); it can't be reverted. Write a new migration instead.`);
  const reserved = reservedCollections(item);

  const staged = new Map<string, Map<string, Entry>>();
  const loaded = new Set<string>();
  const indexes: { collection: string; field: string }[] = [];
  const docs = (collection: string) => {
    let map = staged.get(collection);
    if (map === undefined) {
      map = new Map();
      staged.set(collection, map);
    }
    return map;
  };
  const remember = (collection: string, id: string, stored: unknown): Entry => {
    const document = stored === undefined ? undefined : assertStoredId(collection, id, stored);
    const entry: Entry = {
      original: document === undefined ? undefined : JSON.stringify(document),
      hasIdField: document === undefined || "id" in document,
      current: document === undefined ? undefined : structuredClone(document)
    };
    docs(collection).set(id, entry);
    return entry;
  };
  const view = (id: string, entry: Entry): MigrationDocument | undefined =>
    entry.current === undefined ? undefined : (structuredClone({ ...entry.current, id }) as MigrationDocument);
  const writable = (collection: string) => {
    if (reserved.includes(collection.replace(/^.*::/, ""))) {
      throw new NexoMigrationError(`Migration "${item.id}" writes "${collection}", which Nexo manages itself.`);
    }
  };

  async function load(collection: string): Promise<Map<string, Entry>> {
    if (!loaded.has(collection)) {
      for (const [id, document] of await reader.entries(collection)) {
        if (!docs(collection).has(id)) remember(collection, id, document);
      }
      loaded.add(collection);
    }
    return docs(collection);
  }
  async function entryFor(collection: string, id: string): Promise<Entry> {
    const known = staged.get(collection)?.get(id);
    if (known !== undefined) return known;
    if (loaded.has(collection)) return remember(collection, id, undefined);
    return remember(collection, id, await reader.get(collection, id));
  }

  function context(prefix: string): MigrationContext {
    const at = (collection: string) => prefix + collection;
    const m: MigrationContext = {
      remove: MIGRATION_REMOVE,
      async get(collection, id) {
        return view(id, await entryFor(at(collection), id));
      },
      async list(collection) {
        const out: MigrationDocument[] = [];
        for (const [id, entry] of await load(at(collection))) {
          const document = view(id, entry);
          if (document !== undefined) out.push(document);
        }
        return out;
      },
      async update(collection, fn) {
        const name = at(collection);
        writable(name);
        for (const document of await m.list(collection)) {
          const result = await fn(document);
          const entry = docs(name).get(document.id)!;
          if (result === MIGRATION_REMOVE) {
            entry.current = undefined;
            continue;
          }
          if (!isPlainObject(result)) {
            throw new NexoMigrationError(`Migration "${item.id}": the update of "${name}" must return a document or m.remove.`);
          }
          if (result.id !== document.id) {
            throw new NexoMigrationError(`Migration "${item.id}" changed the id of "${name}/${document.id}"; ids can't change.`);
          }
          const { id: _id, ...rest } = result;
          entry.current = entry.hasIdField ? structuredClone(result) : structuredClone(rest);
        }
      },
      async insert(collection, document) {
        const name = at(collection);
        writable(name);
        if (!isPlainObject(document)) throw new NexoMigrationError(`Migration "${item.id}": insert into "${name}" needs an object.`);
        const id = document.id ?? randomUUID();
        if (typeof id !== "string" || id === "") throw new NexoMigrationError(`Migration "${item.id}": insert into "${name}" has an invalid id.`);
        const entry = await entryFor(name, id);
        if (entry.current !== undefined) throw new NexoMigrationError(`Migration "${item.id}": "${name}/${id}" already exists.`);
        entry.current = structuredClone({ ...document, id });
      },
      renameField: (collection, from, to) =>
        m.update(collection, (document) => {
          if (!(from in document) || to in document) return document;
          const { [from]: value, ...rest } = document;
          return { ...rest, [to]: value } as MigrationDocument;
        }),
      removeField: (collection, field) =>
        m.update(collection, (document) => {
          if (!(field in document) || field === "id") return document;
          const { [field]: _removed, ...rest } = document;
          return rest as MigrationDocument;
        }),
      setField: (collection, field, value) =>
        m.update(collection, (document) =>
          document[field] !== undefined
            ? document
            : ({ ...document, [field]: typeof value === "function" ? (value as (d: MigrationDocument) => unknown)(document) : value } as MigrationDocument)
        ),
      async index(collection, field) {
        indexes.push({ collection: at(collection), field });
      }
    };
    return m;
  }

  if (item.perProject === true) {
    for (const [projectId] of await reader.entries(PROJECTS_COLLECTION)) await run(context(`${projectId}::`));
  } else {
    await run(context(""));
  }

  const writes: DocumentWrite[] = [];
  const collections: Record<string, { inserted: number; updated: number; deleted: number }> = {};
  const destructive: DestructiveChange[] = [];
  for (const [collection, map] of staged) {
    for (const [id, entry] of map) {
      const next = entry.current === undefined ? undefined : JSON.stringify(entry.current);
      if (next === entry.original) continue;
      const before = entry.original === undefined ? undefined : (JSON.parse(entry.original) as Record<string, unknown>);
      writes.push({ collection, id, expected: before, next: entry.current });
      const counts = (collections[collection] ??= { inserted: 0, updated: 0, deleted: 0 });
      if (before === undefined) counts.inserted += 1;
      else if (entry.current === undefined) {
        counts.deleted += 1;
        destructive.push({ kind: "delete", collection, id });
      } else {
        counts.updated += 1;
        destructive.push(...lostData(collection, id, before, entry.current));
      }
    }
  }
  return {
    id: item.id,
    ...(item.description !== undefined ? { description: item.description } : {}),
    direction,
    writes,
    collections,
    destructive,
    indexes
  };
}

/**
 * Fields that held a value and lost it, or whose value changed type. A value
 * that reappears unchanged under a new field (a rename) isn't lost.
 */
function lostData(collection: string, id: string, before: Record<string, unknown>, after: Record<string, unknown>): DestructiveChange[] {
  const found: DestructiveChange[] = [];
  const added = Object.keys(after).filter((key) => !(key in before)).map((key) => JSON.stringify(after[key]));
  for (const [field, value] of Object.entries(before)) {
    if (value === null || value === undefined) continue;
    const now = after[field];
    if (now === undefined || now === null) {
      if (!added.includes(JSON.stringify(value))) found.push({ kind: "remove-field", collection, id, field });
    } else if (kindOf(now) !== kindOf(value)) {
      found.push({ kind: "change-type", collection, id, field, from: kindOf(value), to: kindOf(now) });
    }
  }
  return found;
}

/** A reader that sees `writes` applied on top of `reader`, for planning later migrations without writing. */
export function withWrites(reader: MigrationReader, writes: readonly DocumentWrite[]): MigrationReader {
  const key = (collection: string, id: string) => JSON.stringify([collection, id]);
  const staged = new Map(writes.map((write) => [key(write.collection, write.id), write]));
  return {
    async get<T>(collection: string, id: string) {
      const write = staged.get(key(collection, id));
      return (write !== undefined ? structuredClone(write.next) : await reader.get(collection, id)) as T | undefined;
    },
    async entries<T>(collection: string) {
      const out: Array<[string, T]> = [];
      const seen = new Set<string>();
      for (const [id, document] of await reader.entries<T>(collection)) {
        seen.add(id);
        const write = staged.get(key(collection, id));
        if (write === undefined) out.push([id, document]);
        else if (write.next !== undefined) out.push([id, structuredClone(write.next) as T]);
      }
      for (const write of writes) {
        if (write.collection === collection && !seen.has(write.id) && write.next !== undefined) {
          out.push([write.id, structuredClone(write.next) as T]);
        }
      }
      return out;
    }
  };
}

/** Throws unless `store` can apply a migration all at once (design G2). */
export function assertMigratable(store: NexoDocumentStore): asserts store is NexoDocumentStore & Required<Pick<NexoDocumentStore, "writeBatch" | "entries">> {
  const missing = [store.writeBatch === undefined ? "writeBatch()" : "", store.entries === undefined ? "entries()" : ""].filter(Boolean);
  if (missing.length > 0) {
    throw new NexoMigrationError(
      `This store has no ${missing.join(" or ")}, so it can't apply a migration all at once. ` +
        "The built-in memory, JSON file and SQLite stores can."
    );
  }
}

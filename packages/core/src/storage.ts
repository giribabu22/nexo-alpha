/**
 * Document storage.
 *
 * A deliberately small persistence contract — JSON documents addressed by
 * `(collection, id)` — that framework stores (workflow state, agent memory,
 * …) and applications can build on, with three interchangeable backends:
 *
 * - {@link createInMemoryDocumentStore}: tests and ephemeral processes.
 * - {@link createFileDocumentStore}: one JSON file, cached in memory; writes
 *   are group-committed and replace the file atomically. Single-process only —
 *   use SQLite to share data between processes.
 * - {@link createSqliteDocumentStore}: SQLite via Node's built-in
 *   `node:sqlite` (Node >= 22.5; experimental in Node 22, which prints an
 *   ExperimentalWarning). Loaded lazily, so other backends work on Node 20.
 *
 * Documents must be JSON-serializable. Every backend stores and returns
 * copies, so mutating a returned document never changes stored data, and
 * `list()` returns documents in first-insertion order.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NexoConfigurationError } from "./errors.js";
import {
  asciiLower,
  assertQueryField,
  type DocumentQuery,
  type DocumentQueryResult,
  type DocumentScalar
} from "./document-query.js";

export interface NexoDocumentStore {
  /** The document stored under `(collection, id)`, if any. */
  get<T = unknown>(collection: string, id: string): Promise<T | undefined>;
  /** Inserts or replaces the document stored under `(collection, id)`. */
  put(collection: string, id: string, document: unknown): Promise<void>;
  /** Removes a document. Returns false if it did not exist. */
  delete(collection: string, id: string): Promise<boolean>;
  /**
   * Atomic compare-and-swap: replaces the document only if it currently
   * equals `expected` (compared by JSON serialization, as last read). Returns
   * whether it was replaced. With SQLite this is atomic across processes, which
   * is what lets several job-queue workers share one database safely.
   */
  replaceIf(collection: string, id: string, expected: unknown, next: unknown): Promise<boolean>;
  /**
   * Stores the document only if `(collection, id)` is free, atomically.
   * Returns whether it was stored. Optional, so existing custom stores keep
   * working; call it through {@link insertDocument}, which falls back to
   * get-then-put. Lets ids act as unique keys (e.g. one account per email).
   */
  insert?(collection: string, id: string, document: unknown): Promise<boolean>;
  /**
   * Filters, searches, sorts and pages a collection inside the store (the
   * SQLite store does it in SQL). Optional: without it, callers use
   * `queryDocuments(await store.list(…), query)`, which gives the same results.
   */
  query?<T = unknown>(collection: string, query: DocumentQuery): Promise<DocumentQueryResult<T>>;
  /**
   * Makes `query()` filters on `field` fast (the SQLite store creates an
   * expression index). Pass the same `default` the queries use. Optional and
   * idempotent; stores without it just filter by scanning.
   */
  index?(collection: string, field: string, options?: { readonly default?: DocumentScalar | undefined }): Promise<void>;
  /** Every document in `collection`, in first-insertion order. */
  list<T = unknown>(collection: string): Promise<T[]>;
  /** Releases resources (file handles, connections). The store must not be used afterwards. */
  close(): Promise<void>;
}

function serialize(document: unknown): string {
  const json = JSON.stringify(document);
  if (json === undefined) {
    throw new TypeError("Documents must be JSON-serializable (got undefined or a function).");
  }
  return json;
}

function clone<T>(value: T): T {
  return JSON.parse(serialize(value)) as T;
}

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

export function createInMemoryDocumentStore(): NexoDocumentStore {
  const collections = new Map<string, Map<string, string>>();

  return {
    async get<T>(collection: string, id: string) {
      const json = collections.get(collection)?.get(id);
      return json === undefined ? undefined : (JSON.parse(json) as T);
    },
    async put(collection, id, document) {
      let docs = collections.get(collection);
      if (docs === undefined) {
        docs = new Map();
        collections.set(collection, docs);
      }
      docs.set(id, serialize(document));
    },
    async delete(collection, id) {
      return collections.get(collection)?.delete(id) ?? false;
    },
    async replaceIf(collection, id, expected, next) {
      const docs = collections.get(collection);
      const nextJson = serialize(next);
      if (docs === undefined || docs.get(id) !== serialize(expected)) return false;
      docs.set(id, nextJson);
      return true;
    },
    async insert(collection, id, document) {
      const json = serialize(document);
      let docs = collections.get(collection);
      if (docs === undefined) {
        docs = new Map();
        collections.set(collection, docs);
      }
      if (docs.has(id)) return false;
      docs.set(id, json);
      return true;
    },
    async list<T>(collection: string) {
      return [...(collections.get(collection)?.values() ?? [])].map((json) => JSON.parse(json) as T);
    },
    async close() {
      collections.clear();
    }
  };
}

// ---------------------------------------------------------------------------
// JSON file
// ---------------------------------------------------------------------------

type FileContents = Record<string, Record<string, unknown>>;

/**
 * Stores every collection in one JSON file (`{ [collection]: { [id]: document } }`).
 *
 * The file is read once and kept in memory, so reads never touch the disk.
 * Writes use group commit: changes made while a write is in flight are
 * persisted together by the next write, and every caller's promise resolves
 * only once its change is on disk. Each write replaces the file atomically
 * (temp file, then rename). Single-process only — changes other processes
 * make to the file are not seen; use SQLite to share data between processes.
 */
export function createFileDocumentStore(filePath: string): NexoDocumentStore {
  let cache: FileContents | undefined;
  let loading: Promise<FileContents> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let pending: Promise<void> | undefined;
  let writeCounter = 0;

  async function readFromDisk(): Promise<FileContents> {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    return content.trim() === "" ? {} : (JSON.parse(content) as FileContents);
  }

  function data(): Promise<FileContents> {
    if (cache !== undefined) return Promise.resolve(cache);
    loading ??= readFromDisk().then(
      (loaded) => {
        cache = loaded;
        return loaded;
      },
      (error: unknown) => {
        loading = undefined;
        throw error;
      }
    );
    return loading;
  }

  async function writeSnapshot(snapshot: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    writeCounter += 1;
    const tempPath = `${filePath}.${process.pid}.${writeCounter}.tmp`;
    await fs.writeFile(tempPath, snapshot, "utf-8");
    await fs.rename(tempPath, filePath);
  }

  /** Resolves once every change made before this call is on disk. */
  function persist(): Promise<void> {
    pending ??= (async () => {
      await writing.catch(() => undefined);
      // Changes made from here on are picked up by the next write.
      pending = undefined;
      const snapshot = JSON.stringify(cache ?? {}, null, 2);
      writing = writeSnapshot(snapshot);
      try {
        await writing;
      } catch (error) {
        // The memory copy may now be ahead of the file: reload from disk next time.
        cache = undefined;
        loading = undefined;
        throw error;
      }
    })();
    return pending;
  }

  return {
    async get<T>(collection: string, id: string) {
      const document = (await data())[collection]?.[id];
      return document === undefined ? undefined : clone(document as T);
    },

    async put(collection, id, document) {
      const copy = clone(document);
      const all = await data();
      all[collection] = { ...all[collection], [id]: copy };
      await persist();
    },

    async delete(collection, id) {
      const all = await data();
      const docs = all[collection];
      if (docs === undefined || !(id in docs)) return false;
      delete docs[id];
      await persist();
      return true;
    },

    async list<T>(collection: string) {
      return clone(Object.values((await data())[collection] ?? {}) as T[]);
    },

    async replaceIf(collection, id, expected, next) {
      const expectedJson = serialize(expected);
      const copy = clone(next);
      const all = await data();
      const current = all[collection]?.[id];
      if (current === undefined || JSON.stringify(current) !== expectedJson) return false;
      all[collection] = { ...all[collection], [id]: copy };
      await persist();
      return true;
    },

    async insert(collection, id, document) {
      const copy = clone(document);
      const all = await data();
      // No await between the check and the write, so this is atomic within the process.
      if (all[collection]?.[id] !== undefined) return false;
      all[collection] = { ...all[collection], [id]: copy };
      await persist();
      return true;
    },

    async close() {
      await pending?.catch(() => undefined);
      await writing.catch(() => undefined);
    }
  };
}

// ---------------------------------------------------------------------------
// SQLite (node:sqlite)
// ---------------------------------------------------------------------------

/** The subset of `node:sqlite`'s DatabaseSync API used here (not in @types/node 20). */
interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface SqliteDocumentStoreOptions {
  /** Table name. Letters, digits and underscores only. Default: "nexo_documents" */
  readonly table?: string;
}

/**
 * Creates a SQLite-backed store at `filePath` (or `":memory:"`). Requires
 * Node >= 22.5 for `node:sqlite`; throws a NexoConfigurationError otherwise.
 * File databases use WAL mode and a 5s busy timeout, so several processes
 * can share one database file.
 */
export async function createSqliteDocumentStore(
  filePath: string,
  options: SqliteDocumentStoreOptions = {}
): Promise<NexoDocumentStore> {
  const table = options.table ?? "nexo_documents";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new NexoConfigurationError(`Invalid SQLite table name "${table}".`);
  }

  let sqlite: { DatabaseSync: new (location: string) => SqliteDatabase };
  try {
    // A variable specifier keeps TypeScript (and bundlers) from resolving it statically.
    const specifier = "node:sqlite";
    sqlite = (await import(specifier)) as typeof sqlite;
  } catch {
    throw new NexoConfigurationError(
      `createSqliteDocumentStore() needs Node.js >= 22.5 (node:sqlite); this is ${process.version}.`
    );
  }

  const inMemory = filePath === ":memory:";
  if (!inMemory) await fs.mkdir(path.dirname(filePath), { recursive: true });

  const db = new sqlite.DatabaseSync(filePath);
  if (!inMemory) db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (
       collection TEXT NOT NULL,
       id TEXT NOT NULL,
       data TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (collection, id)
     )`
  );

  const getStmt = db.prepare(`SELECT data FROM ${table} WHERE collection = ? AND id = ?`);
  const putStmt = db.prepare(
    `INSERT INTO ${table} (collection, id, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  );
  const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE collection = ? AND id = ?`);
  const listStmt = db.prepare(`SELECT data FROM ${table} WHERE collection = ? ORDER BY rowid`);
  const insertStmt = db.prepare(
    `INSERT INTO ${table} (collection, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (collection, id) DO NOTHING`
  );
  // A single conditional UPDATE is atomic, even across processes sharing the file.
  const replaceIfStmt = db.prepare(
    `UPDATE ${table} SET data = ?, updated_at = ? WHERE collection = ? AND id = ? AND data = ?`
  );

  // Queries are built per shape; cache the prepared statements by SQL text.
  const queryStatements = new Map<string, SqliteStatement>();
  function prepared(sql: string): SqliteStatement {
    let statement = queryStatements.get(sql);
    if (statement === undefined) {
      if (queryStatements.size >= 200) queryStatements.clear();
      statement = db.prepare(sql);
      queryStatements.set(sql, statement);
    }
    return statement;
  }

  /** node:sqlite binds numbers, strings, null and bytes; JSON booleans read back as 1/0. */
  const bindable = (value: unknown): unknown => (typeof value === "boolean" ? (value ? 1 : 0) : value);

  /** A default as SQL text, so queries and index definitions spell the expression identically. */
  function sqlLiteral(value: DocumentScalar): string | undefined {
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
    return `'${value.replace(/'/g, "''")}'`;
  }

  /**
   * The SQL for a field's value, falling back to `fallback` when the document
   * lacks it. Names are checked to be plain identifiers, so the JSON path can be
   * written into the SQL — which lets SQLite use the indexes `index()` creates.
   */
  function fieldSql(name: string, fallback: unknown): string {
    assertQueryField(name);
    const extract = `json_extract(data, '$.${name}')`;
    const literal = typeof fallback === "string" || typeof fallback === "number" || typeof fallback === "boolean"
      ? sqlLiteral(fallback)
      : undefined;
    return literal === undefined ? extract : `COALESCE(${extract}, ${literal})`;
  }

  /** A short stable index name for an expression. */
  function indexName(expression: string): string {
    let hash = 5381;
    for (let i = 0; i < expression.length; i++) hash = ((hash * 33) ^ expression.charCodeAt(i)) >>> 0;
    return `${table}_field_${hash.toString(36)}`;
  }

  function runQuery<T>(collection: string, query: DocumentQuery): DocumentQueryResult<T> {
    const field = (name: string): string => fieldSql(name, query.defaults?.[name]);
    const sortKey = query.sort === undefined ? "NULL" : field(query.sort.field);

    const whereParams: unknown[] = [collection];
    const conditions = ["collection = ?"];
    for (const [name, expected] of Object.entries(query.where ?? {})) {
      conditions.push(`${field(name)} = ?`);
      whereParams.push(bindable(expected));
    }
    if (query.search !== undefined && query.search.fields.length > 0) {
      const text = asciiLower(query.search.text);
      const anyField = query.search.fields.map((name) => {
        const expression = field(name);
        whereParams.push(text);
        return `instr(lower(CAST(${expression} AS TEXT)), ?) > 0`;
      });
      conditions.push(`(${anyField.join(" OR ")})`);
    }
    const where = conditions.join(" AND ");
    const direction = query.sort?.descending === true ? "DESC" : "ASC";
    const order = query.sort === undefined ? "rid" : `sort_key IS NULL, sort_key COLLATE NOCASE ${direction}, rid`;

    // The sort key is an output column, so it is extracted once per row, and a
    // LIMIT lets SQLite keep only the top rows while sorting.
    const rows = prepared(
      `SELECT data, rowid AS rid, ${sortKey} AS sort_key FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`
    ).all(...whereParams, query.limit ?? -1, query.offset ?? 0) as { data: string }[];
    const total = Number((prepared(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...whereParams) as { n: number | bigint }).n);
    return { items: rows.map((row) => JSON.parse(row.data) as T), total };
  }

  let closed = false;
  function open(): void {
    if (closed) throw new NexoConfigurationError("SQLite document store is closed.");
  }

  return {
    async get<T>(collection: string, id: string) {
      open();
      const row = getStmt.get(collection, id) as { data: string } | undefined;
      return row === undefined ? undefined : (JSON.parse(row.data) as T);
    },
    async put(collection, id, document) {
      open();
      putStmt.run(collection, id, serialize(document), new Date().toISOString());
    },
    async delete(collection, id) {
      open();
      return Number(deleteStmt.run(collection, id).changes) > 0;
    },
    async list<T>(collection: string) {
      open();
      return (listStmt.all(collection) as { data: string }[]).map((row) => JSON.parse(row.data) as T);
    },
    async replaceIf(collection, id, expected, next) {
      open();
      const result = replaceIfStmt.run(serialize(next), new Date().toISOString(), collection, id, serialize(expected));
      return Number(result.changes) > 0;
    },
    async insert(collection, id, document) {
      open();
      return Number(insertStmt.run(collection, id, serialize(document), new Date().toISOString()).changes) > 0;
    },
    async query<T>(collection: string, query: DocumentQuery) {
      open();
      return runQuery<T>(collection, query);
    },
    async index(_collection, fieldName, indexOptions = {}) {
      open();
      // (collection, value) serves every collection with this field, so it is one index per expression.
      const expression = fieldSql(fieldName, indexOptions.default);
      db.exec(`CREATE INDEX IF NOT EXISTS ${indexName(expression)} ON ${table} (collection, ${expression})`);
    },
    async close() {
      if (closed) return;
      closed = true;
      db.close();
    }
  };
}

/**
 * Stores `document` only if `(collection, id)` is free; returns whether it
 * was stored. Atomic with the built-in stores (and across processes with
 * SQLite). For a custom store without `insert`, it checks then writes, which
 * is only safe when one writer at a time uses that id.
 */
export async function insertDocument(
  store: NexoDocumentStore,
  collection: string,
  id: string,
  document: unknown
): Promise<boolean> {
  if (store.insert !== undefined) return store.insert(collection, id, document);
  if ((await store.get(collection, id)) !== undefined) return false;
  await store.put(collection, id, document);
  return true;
}

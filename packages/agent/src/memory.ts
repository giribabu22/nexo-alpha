/**
 * Cross-run Agent Memory.
 *
 * `WorkflowState.context` only lives for one workflow run. AgentMemory holds
 * facts that later runs should be able to recall — e.g. "customer X prefers
 * refunds over store credit" — keyed, tagged, and optionally scoped.
 *
 * Supports in-memory, JSON-file and document-store (e.g. SQLite) storage,
 * mirroring {@link WorkflowStore}.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { NexoDocumentStore } from "@nexo-alpha/core";

export interface MemoryEntry {
  /** Unique key. Remembering an existing key overwrites its value. */
  readonly key: string;
  /** Any JSON-serializable value. */
  readonly value: unknown;
  /** Free-form labels used for filtering in {@link RecallQuery.tags}. */
  readonly tags: readonly string[];
  /** Optional namespace, e.g. a workflow name or customer ID. */
  readonly scope?: string | undefined;
  /** ISO-8601 timestamp of first write. */
  readonly createdAt: string;
  /** ISO-8601 timestamp of the latest write. */
  readonly updatedAt: string;
}

export interface RememberOptions {
  readonly tags?: readonly string[] | undefined;
  readonly scope?: string | undefined;
}

export interface RecallQuery {
  /** Exact key match. */
  readonly key?: string | undefined;
  /** Every listed tag must be present on the entry. */
  readonly tags?: readonly string[] | undefined;
  /** Exact scope match. */
  readonly scope?: string | undefined;
  /**
   * Keyword search over key, tags and the serialized value. Case-insensitive;
   * words shorter than 3 characters are ignored. An entry must match at least
   * one word, and results are ranked by how many words match.
   */
  readonly text?: string | undefined;
  /** Maximum number of entries to return. */
  readonly limit?: number | undefined;
}

export interface AgentMemory {
  /** Stores a value under `key`, overwriting any previous value. */
  remember(key: string, value: unknown, options?: RememberOptions): Promise<MemoryEntry>;
  /** Returns the entry stored under `key`, if any. */
  get(key: string): Promise<MemoryEntry | undefined>;
  /** Returns entries matching every provided criterion, most relevant first. */
  recall(query?: RecallQuery): Promise<MemoryEntry[]>;
  /** Removes the entry stored under `key`. Returns false if it did not exist. */
  forget(key: string): Promise<boolean>;
}

/** Raw persistence used by {@link createAgentMemory}. */
export interface MemoryBackend {
  read(): Promise<Record<string, MemoryEntry>>;
  write(entries: Record<string, MemoryEntry>): Promise<void>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function searchTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((word) => word.length >= 3);
}

function textScore(entry: MemoryEntry, terms: readonly string[]): number {
  const haystack = `${entry.key} ${entry.tags.join(" ")} ${JSON.stringify(entry.value)}`.toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length;
}

function buildEntry(key: string, value: unknown, options: RememberOptions | undefined, previous: MemoryEntry | undefined): MemoryEntry {
  const now = new Date().toISOString();
  return {
    key,
    value: clone(value),
    tags: [...(options?.tags ?? [])],
    ...(options?.scope !== undefined ? { scope: options.scope } : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  };
}

/** Applies a {@link RecallQuery} to a set of entries. */
function recallEntries(all: readonly MemoryEntry[], query: RecallQuery): MemoryEntry[] {
  let entries = [...all];

  if (query.key !== undefined) {
    entries = entries.filter((e) => e.key === query.key);
  }
  if (query.scope !== undefined) {
    entries = entries.filter((e) => e.scope === query.scope);
  }
  if (query.tags !== undefined && query.tags.length > 0) {
    const required = query.tags;
    entries = entries.filter((e) => required.every((tag) => e.tags.includes(tag)));
  }

  let ranked = entries.map((entry) => ({ entry, score: 0 }));
  if (query.text !== undefined) {
    const terms = searchTerms(query.text);
    ranked = ranked
      .map(({ entry }) => ({ entry, score: textScore(entry, terms) }))
      .filter(({ score }) => score > 0);
  }

  ranked.sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt));

  const limited = query.limit !== undefined ? ranked.slice(0, query.limit) : ranked;
  return clone(limited.map(({ entry }) => entry));
}

/** Runs async operations one at a time so read-modify-write sequences can't lose updates. */
function createSerialQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (operation) => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

/**
 * Creates an {@link AgentMemory} on top of any {@link MemoryBackend}.
 * Operations on one instance are serialized, so concurrent writes are not lost.
 */
export function createAgentMemory(backend: MemoryBackend): AgentMemory {
  const exclusive = createSerialQueue();

  return {
    remember(key, value, options) {
      return exclusive(async () => {
        const all = await backend.read();
        const entry = buildEntry(key, value, options, all[key]);
        all[key] = entry;
        await backend.write(all);
        return clone(entry);
      });
    },

    get(key) {
      return exclusive(async () => {
        const entry = (await backend.read())[key];
        return entry ? clone(entry) : undefined;
      });
    },

    recall(query = {}) {
      return exclusive(async () => recallEntries(Object.values(await backend.read()), query));
    },

    forget(key) {
      return exclusive(async () => {
        const all = await backend.read();
        if (!(key in all)) return false;
        delete all[key];
        await backend.write(all);
        return true;
      });
    }
  };
}

export interface DocumentAgentMemoryOptions {
  /** Collection holding the entries. Default: "agent_memory" */
  readonly collection?: string | undefined;
}

/**
 * Creates an {@link AgentMemory} stored in a `@nexo-alpha/core`
 * {@link NexoDocumentStore} (in-memory, JSON file, or SQLite), one document
 * per entry.
 */
export function createDocumentAgentMemory(store: NexoDocumentStore, options: DocumentAgentMemoryOptions = {}): AgentMemory {
  const collection = options.collection ?? "agent_memory";
  const exclusive = createSerialQueue();

  return {
    remember(key, value, rememberOptions) {
      return exclusive(async () => {
        const entry = buildEntry(key, value, rememberOptions, await store.get<MemoryEntry>(collection, key));
        await store.put(collection, key, entry);
        return clone(entry);
      });
    },

    get(key) {
      return store.get<MemoryEntry>(collection, key);
    },

    async recall(query = {}) {
      return recallEntries(await store.list<MemoryEntry>(collection), query);
    },

    forget(key) {
      return store.delete(collection, key);
    }
  };
}

/**
 * Creates an in-memory {@link AgentMemory}. Contents are lost when the process exits.
 */
export function createInMemoryAgentMemory(): AgentMemory {
  let data: Record<string, MemoryEntry> = {};
  return createAgentMemory({
    async read() {
      return clone(data);
    },
    async write(entries) {
      data = clone(entries);
    }
  });
}

/**
 * Creates a file-system backed {@link AgentMemory} (JSON file) that persists
 * across process restarts.
 */
export function createFileAgentMemory(filePath: string): AgentMemory {
  return createAgentMemory({
    async read() {
      try {
        return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, MemoryEntry>;
      } catch {
        return {};
      }
    },
    async write(entries) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(entries, null, 2), "utf-8");
    }
  });
}

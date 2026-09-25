/**
 * Client for the agent memory HTTP API exposed by `createMemoryApiModule()`
 * in `@nexo-alpha/agent`. Reached through `client.memory` on a NexoClient.
 */

import type { NexoClient } from "./client.js";

export interface MemoryEntry {
  readonly key: string;
  readonly value: unknown;
  readonly tags: readonly string[];
  readonly scope?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryQuery {
  /** Keyword search over key, tags and value. */
  readonly text?: string | undefined;
  /** Every tag must be present. */
  readonly tags?: readonly string[] | undefined;
  readonly scope?: string | undefined;
  readonly limit?: number | undefined;
}

export interface RememberRequest {
  readonly tags?: readonly string[];
  readonly scope?: string;
}

export class NexoMemoryClient {
  private readonly basePath: string;

  constructor(private readonly client: NexoClient, basePath = "/memory") {
    this.basePath = basePath.replace(/\/+$/, "");
  }

  private keyPath(key: string): string {
    return `${this.basePath}/${encodeURIComponent(key)}`;
  }

  /** Entries matching every provided criterion, most relevant first. */
  async recall(query: MemoryQuery = {}): Promise<MemoryEntry[]> {
    const params = new URLSearchParams();
    if (query.text !== undefined && query.text !== "") params.set("text", query.text);
    if (query.tags !== undefined && query.tags.length > 0) params.set("tags", query.tags.join(","));
    if (query.scope !== undefined && query.scope !== "") params.set("scope", query.scope);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    const search = params.toString();
    return (await this.client.get<{ entries: MemoryEntry[] }>(`${this.basePath}${search === "" ? "" : `?${search}`}`)).entries;
  }

  /** One entry. Rejects with NexoApiError (404) if it does not exist. */
  get(key: string): Promise<MemoryEntry> {
    return this.client.get<MemoryEntry>(this.keyPath(key));
  }

  /** Stores `value` under `key`, replacing any previous value. */
  remember(key: string, value: unknown, options: RememberRequest = {}): Promise<MemoryEntry> {
    return this.client.put<MemoryEntry>(this.keyPath(key), { value, ...options });
  }

  /** Removes an entry. Rejects with NexoApiError (404) if it does not exist. */
  async forget(key: string): Promise<void> {
    await this.client.delete(this.keyPath(key));
  }
}

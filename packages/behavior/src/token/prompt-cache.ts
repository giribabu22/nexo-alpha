/**
 * PromptCache — LRU-keyed prompt deduplication.
 *
 * Problem: In high-frequency flows (workflow step loops, batch agent runs)
 * the same DecisionRequest with identical state is evaluated repeatedly.
 * Each call re-encodes the prompt string and re-scores questions even though
 * the answer is deterministically the same.
 *
 * Solution: Cache DecisionResponse keyed on a hash of:
 *   { providerName, stateHash, questionSignature }
 *
 * Uses the same LRU doubly-linked-list pattern from packages/frontend/src/dsa/lru.ts
 * re-implemented here to keep @nexo-alpha/behavior independent of @nexo-alpha/frontend.
 *
 * Cache entries also carry a TTL so stale responses are evicted automatically.
 */

import { createHash } from "node:crypto";
import type { DecisionRequest, DecisionResponse } from "../types/provider.js";

// ---------------------------------------------------------------------------
// LRU-TTL cache (same algorithm as DscOrchestrator's LruTtlCache)
// ---------------------------------------------------------------------------

interface LruNode<K, V> {
  key: K;
  value: V;
  expiresAt: number;
  prev: LruNode<K, V> | null;
  next: LruNode<K, V> | null;
}

class LruTtlCache<V> {
  private readonly capacity: number;
  private readonly map = new Map<string, LruNode<string, V>>();
  private head: LruNode<string, V> | null = null;
  private tail: LruNode<string, V> | null = null;
  private hits = 0;
  private misses = 0;

  constructor(capacity = 256) {
    this.capacity = capacity;
  }

  get(key: string, now = Date.now()): V | undefined {
    const node = this.map.get(key);
    if (!node) { this.misses++; return undefined; }
    if (now >= node.expiresAt) {
      this.evict(node);
      this.misses++;
      return undefined;
    }
    this.moveToHead(node);
    this.hits++;
    return node.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    const now = Date.now();
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = now + ttlMs;
      this.moveToHead(existing);
      return;
    }
    const node: LruNode<string, V> = { key, value, expiresAt: now + ttlMs, prev: null, next: null };
    this.map.set(key, node);
    this.addToHead(node);
    if (this.map.size > this.capacity) this.evictTail();
  }

  get cacheHitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  get size(): number { return this.map.size; }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this.hits = 0;
    this.misses = 0;
  }

  private addToHead(node: LruNode<string, V>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: LruNode<string, V>): void {
    if (node.prev) node.prev.next = node.next; else this.head = node.next;
    if (node.next) node.next.prev = node.prev; else this.tail = node.prev;
  }

  private moveToHead(node: LruNode<string, V>): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }

  private evict(node: LruNode<string, V>): void {
    this.removeNode(node);
    this.map.delete(node.key);
  }

  private evictTail(): void {
    if (!this.tail) return;
    this.map.delete(this.tail.key);
    this.removeNode(this.tail);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptCacheOptions {
  /** Maximum number of cached responses. Default: 256. */
  readonly capacity?: number;
  /** Default TTL in ms. Default: 5 minutes. */
  readonly defaultTtlMs?: number;
  /** Provider name to scope the cache. */
  readonly providerName?: string;
}

export interface PromptCacheStats {
  readonly size: number;
  readonly hitRate: number;
}

// ---------------------------------------------------------------------------
// PromptCache
// ---------------------------------------------------------------------------

/**
 * PromptCache deduplicates DecisionRequest evaluations.
 *
 * A cache hit returns the stored DecisionResponse immediately without calling
 * the provider, saving both latency and token cost.
 */
export class PromptCache {
  private readonly cache: LruTtlCache<DecisionResponse>;
  private readonly defaultTtlMs: number;
  private readonly providerName: string;

  constructor(options: PromptCacheOptions = {}) {
    this.cache = new LruTtlCache<DecisionResponse>(options.capacity ?? 256);
    this.defaultTtlMs = options.defaultTtlMs ?? 300_000; // 5 min
    this.providerName = options.providerName ?? "default";
  }

  /**
   * Compute a stable cache key for a DecisionRequest.
   * Key = hash(providerName + stateJson + questionSignature).
   */
  keyFor<TState>(request: DecisionRequest<TState>): string {
    const stateJson = JSON.stringify(request.state ?? null);
    const questionSig = Object.keys(request.questions).sort().join("|");
    const raw = `${this.providerName}::${stateJson}::${questionSig}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 24);
  }

  get(key: string): DecisionResponse | undefined {
    return this.cache.get(key);
  }

  set(key: string, response: DecisionResponse, ttlMs?: number): void {
    this.cache.set(key, response, ttlMs ?? this.defaultTtlMs);
  }

  /**
   * Try to get a cached response; if not found, call `evaluate` and cache the result.
   *
   * @param request   - The DecisionRequest
   * @param evaluate  - The fallback provider call
   * @param ttlMs     - Optional per-call TTL override
   */
  async getOrEvaluate<TState>(
    request: DecisionRequest<TState>,
    evaluate: (req: DecisionRequest<TState>) => Promise<DecisionResponse>,
    ttlMs?: number
  ): Promise<{ response: DecisionResponse; cacheHit: boolean }> {
    const key = this.keyFor(request);
    const cached = this.get(key);
    if (cached) {
      return { response: cached, cacheHit: true };
    }

    const response = await evaluate(request);
    this.set(key, response, ttlMs);
    return { response, cacheHit: false };
  }

  get stats(): PromptCacheStats {
    return {
      size: this.cache.size,
      hitRate: this.cache.cacheHitRate
    };
  }

  clear(): void {
    this.cache.clear();
  }
}

export function createPromptCache(options?: PromptCacheOptions): PromptCache {
  return new PromptCache(options);
}

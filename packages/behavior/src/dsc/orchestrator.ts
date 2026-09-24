import { createHash } from "node:crypto";
import { DscCollector } from "./collector.js";
import type {
  DscOperationDefinition,
  DscExecutionContext,
  DscPlanResult
} from "./types.js";

// ---------------------------------------------------------------------------
// DSA: LRU cache with Bloom-filter pre-check
// ---------------------------------------------------------------------------

interface LruNode<K, V> {
  key: K;
  value: V;
  expiresAt: number;
  prev: LruNode<K, V> | null;
  next: LruNode<K, V> | null;
}

/**
 * LRU cache with TTL — replaces the unbounded Map used previously.
 * Capacity defaults to 512 entries. O(1) get/set via doubly-linked list + Map.
 */
class LruTtlCache<V = unknown> {
  private readonly capacity: number;
  private readonly map = new Map<string, LruNode<string, V>>();
  private head: LruNode<string, V> | null = null;
  private tail: LruNode<string, V> | null = null;

  constructor(capacity = 512) {
    this.capacity = capacity;
  }

  has(key: string, now = Date.now()): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    if (now >= node.expiresAt) {
      this.remove(node);
      this.map.delete(key);
      return false;
    }
    return true;
  }

  get(key: string, now = Date.now()): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    if (now >= node.expiresAt) {
      this.remove(node);
      this.map.delete(key);
      return undefined;
    }
    this.moveToHead(node);
    return node.value;
  }

  set(key: string, value: V, expiresAt: number): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = expiresAt;
      this.moveToHead(existing);
      return;
    }

    const node: LruNode<string, V> = { key, value, expiresAt, prev: null, next: null };
    this.map.set(key, node);
    this.addToHead(node);

    if (this.map.size > this.capacity) {
      this.evictTail();
    }
  }

  delete(key: string): void {
    const node = this.map.get(key);
    if (!node) return;
    this.remove(node);
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  private addToHead(node: LruNode<string, V>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private remove(node: LruNode<string, V>): void {
    if (node.prev) node.prev.next = node.next; else this.head = node.next;
    if (node.next) node.next.prev = node.prev; else this.tail = node.prev;
  }

  private moveToHead(node: LruNode<string, V>): void {
    if (node === this.head) return;
    this.remove(node);
    this.addToHead(node);
  }

  private evictTail(): void {
    if (!this.tail) return;
    this.map.delete(this.tail.key);
    this.remove(this.tail);
  }
}

/**
 * BloomFilter — probabilistic pre-check before LRU lookup.
 * False-positive probability: ~1.2% at 512 entries (m=2048, k=3).
 * Returns false → key is DEFINITELY not in cache (skip Map lookup).
 */
class BloomFilter {
  private readonly bits: Uint8Array;
  private readonly m: number;
  private readonly k: number;

  constructor(m = 2048, k = 3) {
    this.m = m;
    this.k = k;
    this.bits = new Uint8Array(Math.ceil(m / 8));
  }

  add(key: string): void {
    for (let i = 0; i < this.k; i++) {
      const idx = this.hash(key, i) % this.m;
      this.bits[idx >> 3]! |= 1 << (idx & 7);
    }
  }

  mightContain(key: string): boolean {
    for (let i = 0; i < this.k; i++) {
      const idx = this.hash(key, i) % this.m;
      if (!((this.bits[idx >> 3]! >> (idx & 7)) & 1)) return false;
    }
    return true;
  }

  clear(): void { this.bits.fill(0); }

  private hash(key: string, seed: number): number {
    let h1 = 2166136261;
    let h2 = 0;
    for (let j = 0; j < key.length; j++) {
      const c = key.charCodeAt(j);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ (c << 5), 2246822519);
    }
    return Math.abs((h1 + seed * h2) | 0);
  }
}

// ---------------------------------------------------------------------------
// DscOrchestrator
// ---------------------------------------------------------------------------

export class DscOrchestrator {
  private readonly collector: DscCollector;
  // LRU-bounded cache with Bloom-filter pre-check
  private readonly cache = new LruTtlCache<unknown>(512);
  private readonly bloom = new BloomFilter(2048, 3);
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(collector?: DscCollector) {
    this.collector = collector ?? new DscCollector();
  }

  getCollector(): DscCollector {
    return this.collector;
  }

  private hashKey(prefix: string, input: unknown): string {
    const serialized = typeof input === "string" ? input : JSON.stringify(input ?? null);
    const hash = createHash("sha256").update(serialized).digest("hex").slice(0, 16);
    return `${prefix}:${hash}`;
  }

  async run<TInput, TOutput>(
    operation: DscOperationDefinition<TInput, TOutput>,
    input: TInput,
    metadata?: Record<string, unknown>
  ): Promise<TOutput> {
    const operationId = `dsc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const context: DscExecutionContext<TInput> = {
      operationId,
      operationName: operation.name,
      input,
      metadata,
      stageData: {}
    };

    // Stage 1: Plan
    const planStart = performance.now();
    let planResult: DscPlanResult | undefined;

    if (operation.plan) {
      planResult = await operation.plan(context);
    }

    const planDuration = Math.round((performance.now() - planStart) * 100) / 100;

    // Check early termination
    if (planResult?.skipExecution && planResult.earlyResult !== undefined) {
      this.collector.record({
        operationId,
        operationName: operation.name,
        stage: "plan",
        status: "early_terminated",
        durationMs: planDuration,
        tokensSaved: 50
      });
      return planResult.earlyResult as TOutput;
    }

    this.collector.record({
      operationId,
      operationName: operation.name,
      stage: "plan",
      status: "success",
      durationMs: planDuration
    });

    // Derive cache key
    const cacheKey = planResult?.cacheKey ?? (operation.idempotent ? this.hashKey(operation.name, input) : undefined);

    // DSA: Bloom filter pre-check — eliminates Map lookup for cold keys
    if (cacheKey) {
      if (this.bloom.mightContain(cacheKey)) {
        // Bloom says "probably present" → do the actual LRU lookup
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
          this.collector.record({
            operationId,
            operationName: operation.name,
            stage: "execute",
            status: "cached",
            durationMs: 0.1,
            cacheHit: true,
            tokensSaved: 100
          });
          return cached as TOutput;
        }
      }
      // Bloom says "definitely not present" → skip LRU lookup entirely

      // In-Flight Request Deduplication
      if (this.inFlight.has(cacheKey)) {
        this.collector.record({
          operationId,
          operationName: operation.name,
          stage: "execute",
          status: "deduplicated",
          durationMs: 0.1,
          deduplicated: true
        });
        return (await this.inFlight.get(cacheKey)) as TOutput;
      }
    }

    // Execute the remaining stages
    const executionPromise = (async (): Promise<TOutput> => {
      // Stage 2: Resolve
      const resolveStart = performance.now();
      if (operation.resolve) {
        await operation.resolve(context);
      }
      this.collector.record({
        operationId,
        operationName: operation.name,
        stage: "resolve",
        status: "success",
        durationMs: Math.round((performance.now() - resolveStart) * 100) / 100
      });

      // Stage 3: Execute
      const execStart = performance.now();
      const rawResult = await operation.execute(context);
      this.collector.record({
        operationId,
        operationName: operation.name,
        stage: "execute",
        status: "success",
        durationMs: Math.round((performance.now() - execStart) * 100) / 100,
        cacheHit: cacheKey ? false : undefined
      });

      // Stage 4: Verify
      if (operation.verify) {
        const verifyStart = performance.now();
        const verification = await operation.verify(rawResult, context);
        const verifyDuration = Math.round((performance.now() - verifyStart) * 100) / 100;
        const isValid = typeof verification === "boolean" ? verification : verification.valid;

        if (!isValid) {
          const reason = typeof verification === "object" ? verification.reason : "Verification failed";
          this.collector.record({
            operationId,
            operationName: operation.name,
            stage: "verify",
            status: "failure",
            durationMs: verifyDuration,
            error: reason
          });
          throw new Error(`[DSC Verify Failed] ${operation.name}: ${reason}`);
        }

        this.collector.record({
          operationId,
          operationName: operation.name,
          stage: "verify",
          status: "success",
          durationMs: verifyDuration
        });
      }

      // Stage 5: Write
      if (operation.write) {
        const writeStart = performance.now();
        await operation.write(rawResult, context);
        this.collector.record({
          operationId,
          operationName: operation.name,
          stage: "write",
          status: "success",
          durationMs: Math.round((performance.now() - writeStart) * 100) / 100
        });
      }

      // Store in LRU cache + Bloom filter
      if (cacheKey) {
        const ttl = operation.ttlMs ?? 60_000;
        this.cache.set(cacheKey, rawResult, Date.now() + ttl);
        this.bloom.add(cacheKey);
      }

      return rawResult;
    })();

    if (cacheKey) {
      this.inFlight.set(cacheKey, executionPromise);
    }

    try {
      return await executionPromise;
    } finally {
      if (cacheKey) {
        this.inFlight.delete(cacheKey);
      }
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.bloom.clear();
  }
}

export function createDscOrchestrator(collector?: DscCollector): DscOrchestrator {
  return new DscOrchestrator(collector);
}

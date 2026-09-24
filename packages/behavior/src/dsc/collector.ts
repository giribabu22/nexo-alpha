import type {
  DscMetricRecord,
  DscAggregateMetrics,
  DscStage,
  DscExecutionStatus
} from "./types.js";

// ---------------------------------------------------------------------------
// DSA: Ring Buffer — bounded O(1) push, bounded memory
// ---------------------------------------------------------------------------

class RingBuffer<T> {
  private readonly buf: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private _size = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  get size(): number { return this._size; }

  /** O(1) push. Overwrites oldest entry when full. */
  push(item: T): void {
    if (this._size === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this._size++;
    }
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
  }

  /** O(n) — returns all items oldest → newest. */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this._size; i++) {
      result.push(this.buf[(this.head + i) % this.capacity] as T);
    }
    return result;
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this._size = 0;
  }
}

// ---------------------------------------------------------------------------
// DscCollector
// ---------------------------------------------------------------------------

/**
 * DscCollector — bounded metrics collector backed by a RingBuffer.
 *
 * Upgrade over the previous unbounded Array:
 *  - Hard cap at `maxRecords` (default 4096) prevents memory leaks in
 *    long-running processes.
 *  - O(1) push via RingBuffer (no array re-allocation).
 *  - Oldest records are silently evicted when capacity is reached.
 */
export class DscCollector {
  private readonly ring: RingBuffer<DscMetricRecord>;
  private readonly listeners: Set<(record: DscMetricRecord) => void> = new Set();

  constructor(maxRecords = 4096) {
    this.ring = new RingBuffer<DscMetricRecord>(maxRecords);
  }

  record(entry: Omit<DscMetricRecord, "timestamp">): void {
    const record: DscMetricRecord = {
      ...entry,
      timestamp: new Date().toISOString()
    };
    this.ring.push(record);
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // Suppress listener errors so telemetry never breaks runtime
      }
    }
  }

  getRecords(): readonly DscMetricRecord[] {
    return this.ring.toArray();
  }

  getMetrics(): DscAggregateMetrics {
    const records = this.ring.toArray();

    const initialStages: Record<DscStage, number> = {
      plan: 0,
      resolve: 0,
      execute: 0,
      verify: 0,
      write: 0
    };

    const initialStatuses: Record<DscExecutionStatus, number> = {
      success: 0,
      failure: 0,
      early_terminated: 0,
      cached: 0,
      deduplicated: 0
    };

    let totalDurationMs = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokensSaved = 0;
    let totalWastedStateTokens = 0;
    let totalCostUsd = 0;
    let totalToolCalls = 0;
    let duplicatedToolCalls = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    let deduplicatedOps = 0;

    for (const r of records) {
      totalDurationMs += r.durationMs;
      initialStages[r.stage] = (initialStages[r.stage] ?? 0) + r.durationMs;
      initialStatuses[r.status] = (initialStatuses[r.status] ?? 0) + 1;

      if (r.promptTokens) totalPromptTokens += r.promptTokens;
      if (r.completionTokens) totalCompletionTokens += r.completionTokens;
      if (r.tokensSaved) totalTokensSaved += r.tokensSaved;
      if (r.wastedStateTokens) totalWastedStateTokens += r.wastedStateTokens;
      if (r.costUsd) totalCostUsd += r.costUsd;
      if (r.toolCalls) totalToolCalls += r.toolCalls;
      if (r.duplicatedToolCalls) duplicatedToolCalls += r.duplicatedToolCalls;

      if (r.cacheHit === true) cacheHits++;
      else if (r.cacheHit === false) cacheMisses++;

      if (r.deduplicated) deduplicatedOps++;
    }

    const totalOperations = records.length;
    const totalCacheEvents = cacheHits + cacheMisses;
    const cacheHitRate = totalCacheEvents > 0 ? cacheHits / totalCacheEvents : 0;
    const averageDurationMs = totalOperations > 0 ? totalDurationMs / totalOperations : 0;

    return {
      totalOperations,
      totalDurationMs,
      averageDurationMs: Math.round(averageDurationMs * 100) / 100,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokensSaved,
      totalWastedStateTokens,
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      totalToolCalls,
      duplicatedToolCalls,
      cacheHits,
      cacheMisses,
      cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
      deduplicatedOps,
      stageDurations: initialStages,
      statusCounts: initialStatuses
    };
  }

  subscribe(listener: (record: DscMetricRecord) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  clear(): void {
    this.ring.clear();
  }
}

export function createDscCollector(maxRecords = 4096): DscCollector {
  return new DscCollector(maxRecords);
}

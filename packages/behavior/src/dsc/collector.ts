import type {
  DscMetricRecord,
  DscAggregateMetrics,
  DscStage,
  DscExecutionStatus
} from "./types.js";

export class DscCollector {
  private records: DscMetricRecord[] = [];
  private listeners: Set<(record: DscMetricRecord) => void> = new Set();

  record(entry: Omit<DscMetricRecord, "timestamp">): void {
    const record: DscMetricRecord = {
      ...entry,
      timestamp: new Date().toISOString()
    };
    this.records.push(record);
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // Suppress listener errors so telemetry never breaks runtime
      }
    }
  }

  getRecords(): readonly DscMetricRecord[] {
    return [...this.records];
  }

  getMetrics(): DscAggregateMetrics {
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

    for (const r of this.records) {
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

      if (r.cacheHit === true) {
        cacheHits++;
      } else if (r.cacheHit === false) {
        cacheMisses++;
      }

      if (r.deduplicated) {
        deduplicatedOps++;
      }
    }

    const totalOperations = this.records.length;
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
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.records = [];
  }
}

export function createDscCollector(): DscCollector {
  return new DscCollector();
}

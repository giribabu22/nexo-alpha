export interface TelemetryRecord {
  readonly timestamp: string;
  readonly providerName: string;
  readonly questionCount: number;
  readonly durationMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly estimatedCostUsd: number;
  readonly savedTokens: number;
}

export interface BehaviorTelemetryMetrics {
  totalEvaluations: number;
  totalQuestions: number;
  totalDurationMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  estimatedSavedTokens: number;
  providerCounts: Record<string, number>;
}

export class TelemetryTracker {
  private records: TelemetryRecord[] = [];

  public record(entry: Omit<TelemetryRecord, "timestamp">): void {
    this.records.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
  }

  public getRecords(): readonly TelemetryRecord[] {
    return [...this.records];
  }

  public getMetrics(): BehaviorTelemetryMetrics {
    const metrics: BehaviorTelemetryMetrics = {
      totalEvaluations: this.records.length,
      totalQuestions: 0,
      totalDurationMs: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCostUsd: 0,
      estimatedSavedTokens: 0,
      providerCounts: {}
    };

    for (const r of this.records) {
      metrics.totalQuestions += r.questionCount;
      metrics.totalDurationMs += r.durationMs;
      metrics.totalPromptTokens += r.promptTokens;
      metrics.totalCompletionTokens += r.completionTokens;
      metrics.totalCostUsd += r.estimatedCostUsd;
      metrics.estimatedSavedTokens += r.savedTokens;
      metrics.providerCounts[r.providerName] = (metrics.providerCounts[r.providerName] ?? 0) + 1;
    }

    return metrics;
  }

  public clear(): void {
    this.records = [];
  }
}

export function createTelemetryTracker(): TelemetryTracker {
  return new TelemetryTracker();
}

/**
 * Wire types of the metrics snapshot served by `createMetricsApiModule()`
 * in `@nexo-alpha/tools` (declared here so browser bundles stay server-free).
 */

export interface NexoApiMetrics {
  readonly calls: number;
  readonly errors: number;
  readonly averageDurationMs: number;
}

export interface NexoCronJobMetrics {
  readonly runs: number;
  readonly failures: number;
  readonly averageDurationMs: number;
}

export interface NexoWorkflowMetrics {
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly paused: number;
  readonly stepsCompleted: number;
  readonly stepsFailed: number;
  readonly averageDurationMs: number;
}

export interface NexoQueueMetrics {
  readonly enqueued: number;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
  readonly averageDurationMs: number;
}

export interface NexoMetricsSnapshot {
  readonly apis: Readonly<Record<string, NexoApiMetrics>>;
  readonly jobs: Readonly<Record<string, NexoCronJobMetrics>>;
  readonly workflows: Readonly<Record<string, NexoWorkflowMetrics>>;
  readonly queues: Readonly<Record<string, NexoQueueMetrics>>;
}

/** Totals across all entries, for summary tiles. */
export interface NexoMetricsTotals {
  readonly apiCalls: number;
  readonly apiErrors: number;
  readonly workflowRunsStarted: number;
  readonly workflowRunsFailed: number;
  readonly queueJobsFailed: number;
  readonly queueJobsRetried: number;
}

export function summarizeMetrics(snapshot: NexoMetricsSnapshot): NexoMetricsTotals {
  const sum = <T>(entries: Readonly<Record<string, T>>, pick: (entry: T) => number): number =>
    Object.values(entries).reduce((total, entry) => total + pick(entry), 0);
  return {
    apiCalls: sum(snapshot.apis, (m) => m.calls),
    apiErrors: sum(snapshot.apis, (m) => m.errors),
    workflowRunsStarted: sum(snapshot.workflows, (m) => m.started),
    workflowRunsFailed: sum(snapshot.workflows, (m) => m.failed),
    queueJobsFailed: sum(snapshot.queues, (m) => m.failed),
    queueJobsRetried: sum(snapshot.queues, (m) => m.retried)
  };
}

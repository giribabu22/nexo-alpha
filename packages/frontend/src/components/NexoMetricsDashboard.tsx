import React, { useCallback, useEffect, useRef, useState } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";
import { useNexoClient } from "../context.js";
import { NexoCard } from "./NexoCard.js";
import { NexoMetric } from "./NexoMetric.js";
import { summarizeMetrics, type NexoMetricsSnapshot } from "../metrics.js";
import type { UsePollingOptions } from "../types.js";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseNexoMetricsOptions extends UsePollingOptions {
  /** Route of `createMetricsApiModule()`. Default: "/metrics" */
  readonly path?: string | undefined;
}

export interface UseNexoMetricsResult {
  readonly metrics: NexoMetricsSnapshot | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

export function useNexoMetrics(options: UseNexoMetricsOptions = {}): UseNexoMetricsResult {
  const client = useNexoClient();
  const [metrics, setMetrics] = useState<NexoMetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const path = options.path;

  const refetch = useCallback(async () => {
    try {
      const data = await client.getMetrics(path);
      if (mountedRef.current) {
        setMetrics(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [client, path]);

  useEffect(() => {
    mountedRef.current = true;
    if (options.enabled === false) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }
    void refetch();
    const interval = options.pollInterval !== undefined && options.pollInterval > 0
      ? setInterval(() => void refetch(), options.pollInterval)
      : undefined;
    return () => {
      mountedRef.current = false;
      if (interval !== undefined) clearInterval(interval);
    };
  }, [refetch, options.enabled, options.pollInterval]);

  return { metrics, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface NexoMetricsDashboardProps {
  readonly id?: string | undefined;
  /** Render a fixed snapshot instead of fetching. */
  readonly metrics?: NexoMetricsSnapshot | null | undefined;
  /** Refresh interval when fetching. Default: 5000 */
  readonly pollInterval?: number | undefined;
  readonly path?: string | undefined;
}

const cell: React.CSSProperties = { padding: "4px 8px", textAlign: "right" };
const nameCell: React.CSSProperties = { padding: "4px 8px", textAlign: "left" };
const ms = (value: number): string => `${Math.round(value)}ms`;

function Section<T>({ title, entries, columns }: {
  readonly title: string;
  readonly entries: Readonly<Record<string, T>>;
  readonly columns: readonly (readonly [string, (entry: T) => React.ReactNode])[];
}): React.JSX.Element | null {
  const names = Object.keys(entries);
  if (names.length === 0) return null;
  return (
    <NexoCard title={title} variant="subtle">
      <table className="nexo-metrics-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--nexo-text-secondary, #94a3b8)" }}>
            <th style={nameCell}>Name</th>
            {columns.map(([label]) => <th key={label} style={cell}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {names.map((name) => (
            <tr key={name}>
              <td style={nameCell}><code>{name}</code></td>
              {columns.map(([label, value]) => <td key={label} style={cell}>{value(entries[name] as T)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </NexoCard>
  );
}

export const NexoMetricsDashboardComp: NexoComp<NexoMetricsDashboardProps> = nexoComp<NexoMetricsDashboardProps>({
  name: "NexoMetricsDashboard",
  purpose: "Observability dashboard for API, cron job, workflow and queue metrics",
  render: ({ metrics: fixed, pollInterval, path }) => {
    const fetched = useNexoMetrics({ enabled: fixed === undefined, pollInterval: pollInterval ?? 5000, path });
    const metrics = fixed !== undefined ? fixed : fetched.metrics;

    if (metrics === null) {
      return (
        <div className="nexo-panel nexo-metrics-dashboard">
          {fetched.error !== null ? `Metrics unavailable: ${fetched.error.message}` : "Loading metrics…"}
        </div>
      );
    }

    const totals = summarizeMetrics(metrics);
    return (
      <div className="nexo-metrics-dashboard" style={{ display: "grid", gap: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
          <NexoMetric label="API calls" value={totals.apiCalls} />
          <NexoMetric label="API errors" value={totals.apiErrors} accentColor="var(--nexo-danger, #ef4444)" />
          <NexoMetric label="Workflow runs" value={totals.workflowRunsStarted} />
          <NexoMetric label="Failed runs" value={totals.workflowRunsFailed} accentColor="var(--nexo-danger, #ef4444)" />
          <NexoMetric label="Job retries" value={totals.queueJobsRetried} accentColor="var(--nexo-warning, #fbbf24)" />
          <NexoMetric label="Failed jobs" value={totals.queueJobsFailed} accentColor="var(--nexo-danger, #ef4444)" />
        </div>
        <Section title="APIs" entries={metrics.apis} columns={[
          ["Calls", (m) => m.calls], ["Errors", (m) => m.errors], ["Avg", (m) => ms(m.averageDurationMs)]
        ]} />
        <Section title="Workflows" entries={metrics.workflows} columns={[
          ["Started", (m) => m.started], ["Completed", (m) => m.completed], ["Failed", (m) => m.failed],
          ["Paused", (m) => m.paused], ["Steps ok/failed", (m) => `${m.stepsCompleted}/${m.stepsFailed}`], ["Avg", (m) => ms(m.averageDurationMs)]
        ]} />
        <Section title="Job queues" entries={metrics.queues} columns={[
          ["Enqueued", (m) => m.enqueued], ["Completed", (m) => m.completed], ["Retried", (m) => m.retried],
          ["Failed", (m) => m.failed], ["Avg", (m) => ms(m.averageDurationMs)]
        ]} />
        <Section title="Cron jobs" entries={metrics.jobs} columns={[
          ["Runs", (m) => m.runs], ["Failures", (m) => m.failures], ["Avg", (m) => ms(m.averageDurationMs)]
        ]} />
      </div>
    );
  }
});

export const NexoMetricsDashboard = NexoMetricsDashboardComp;

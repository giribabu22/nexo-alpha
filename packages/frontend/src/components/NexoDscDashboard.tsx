/**
 * NexoDscDashboard — Live DSC metrics panel.
 *
 * Subscribes to a DscCollector and re-renders on every new record,
 * displaying cache hit rate, average latency, deduplication stats,
 * token savings, and a live stage-duration breakdown.
 *
 * This is a nexoComp so it benefits from LRU memoization and DAG
 * dirty-tracking just like every other UI primitive.
 */
import React, { useEffect, useRef, useState } from "react";
import { nexoComp } from "../comp/nexo-comp.js";

// ---------------------------------------------------------------------------
// Minimal interface mirror — no direct @nexo-alpha/behavior dep in frontend
// ---------------------------------------------------------------------------

interface DscAggregateMetrics {
  totalOperations: number;
  totalDurationMs: number;
  averageDurationMs: number;
  totalTokensSaved: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  deduplicatedOps: number;
  totalCostUsd: number;
  stageDurations: Record<string, number>;
  statusCounts: Record<string, number>;
}

interface DscCollectorLike {
  getMetrics(): DscAggregateMetrics;
  subscribe(listener: (record: unknown) => void): () => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NexoDscDashboardProps {
  /** The DscCollector instance to observe (from createDscCollector()). */
  readonly collector: DscCollectorLike;
  /** Poll interval in ms for metric refresh. Default: 500ms. */
  readonly refreshMs?: number;
  /** CSS class applied to the outer container. */
  readonly className?: string;
  /** Whether to show the stage duration breakdown. Default: true. */
  readonly showStages?: boolean;
  /** Whether to show status distribution. Default: true. */
  readonly showStatus?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Meter bar sub-component
// ---------------------------------------------------------------------------

function MeterBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 4, height: 6, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`,
        height: "100%",
        background: color,
        borderRadius: 4,
        transition: "width 0.4s ease"
      }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card sub-component
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, accent }: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.05)",
      borderRadius: 10,
      padding: "12px 16px",
      border: "1px solid rgba(255,255,255,0.08)",
      minWidth: 120
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? "#e2e8f0", lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function NexoDscDashboardInner({
  collector,
  refreshMs = 500,
  className,
  showStages = true,
  showStatus = true
}: NexoDscDashboardProps): React.JSX.Element {
  const [metrics, setMetrics] = useState<DscAggregateMetrics>(() => collector.getMetrics());
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Subscribe to real-time updates
    const unsub = collector.subscribe(() => {
      // Debounce: refresh at most once per refreshMs
      if (!tickRef.current) {
        tickRef.current = setTimeout(() => {
          tickRef.current = null;
          setMetrics(collector.getMetrics());
        }, refreshMs);
      }
    });

    return () => {
      unsub();
      if (tickRef.current) clearTimeout(tickRef.current);
    };
  }, [collector, refreshMs]);

  const stages = Object.entries(metrics.stageDurations).filter(([, v]) => v > 0);
  const statuses = Object.entries(metrics.statusCounts).filter(([, v]) => v > 0);
  const maxStage = Math.max(...stages.map(([, v]) => v), 1);

  const stageColors: Record<string, string> = {
    plan: "#6366f1",
    resolve: "#8b5cf6",
    execute: "#3b82f6",
    verify: "#10b981",
    write: "#f59e0b"
  };

  const statusColors: Record<string, string> = {
    success: "#10b981",
    cached: "#6366f1",
    deduplicated: "#8b5cf6",
    early_terminated: "#f59e0b",
    failure: "#ef4444"
  };

  return (
    <div
      className={className}
      style={{
        fontFamily: "'Inter', 'Outfit', sans-serif",
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
        borderRadius: 14,
        padding: 20,
        color: "#e2e8f0",
        border: "1px solid rgba(99,102,241,0.25)",
        boxShadow: "0 8px 32px rgba(99,102,241,0.15)"
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: metrics.totalOperations > 0 ? "#10b981" : "#6b7280",
          boxShadow: metrics.totalOperations > 0 ? "0 0 8px #10b981" : "none",
          animation: metrics.totalOperations > 0 ? "pulse 2s infinite" : "none"
        }} />
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.02em" }}>
          DSC Runtime Metrics
        </span>
        <span style={{
          marginLeft: "auto",
          fontSize: 11,
          color: "rgba(255,255,255,0.35)",
          fontVariantNumeric: "tabular-nums"
        }}>
          {metrics.totalOperations.toLocaleString()} ops
        </span>
      </div>

      {/* Primary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 18 }}>
        <StatCard
          label="Cache Hit"
          value={formatPct(metrics.cacheHitRate)}
          sub={`${metrics.cacheHits}H / ${metrics.cacheMisses}M`}
          accent={metrics.cacheHitRate > 0.5 ? "#10b981" : metrics.cacheHitRate > 0.2 ? "#f59e0b" : "#ef4444"}
        />
        <StatCard
          label="Avg Latency"
          value={formatMs(metrics.averageDurationMs)}
          sub="per operation"
          accent="#6366f1"
        />
        <StatCard
          label="Deduped"
          value={metrics.deduplicatedOps.toString()}
          sub="in-flight saved"
          accent="#8b5cf6"
        />
        <StatCard
          label="Tokens Saved"
          value={metrics.totalTokensSaved.toLocaleString()}
          {...(metrics.totalCostUsd > 0 ? { sub: `$${metrics.totalCostUsd.toFixed(4)} saved` } : {})}
          accent="#f59e0b"
        />
      </div>

      {/* Stage breakdown */}
      {showStages && stages.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Stage Durations
          </div>
          {stages.map(([stage, ms]) => (
            <div key={stage} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: stageColors[stage] ?? "#94a3b8", textTransform: "capitalize" }}>
                  {stage}
                </span>
                <span style={{ color: "rgba(255,255,255,0.5)", fontVariantNumeric: "tabular-nums" }}>
                  {formatMs(ms)}
                </span>
              </div>
              <MeterBar value={ms} max={maxStage} color={stageColors[stage] ?? "#94a3b8"} />
            </div>
          ))}
        </div>
      )}

      {/* Status distribution */}
      {showStatus && statuses.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Status Distribution
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {statuses.map(([status, count]) => (
              <div key={status} style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(255,255,255,0.06)",
                borderRadius: 20,
                padding: "3px 10px",
                fontSize: 11,
                border: `1px solid ${statusColors[status] ?? "#94a3b8"}33`
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: statusColors[status] ?? "#94a3b8",
                  flexShrink: 0
                }} />
                <span style={{ color: "rgba(255,255,255,0.65)", textTransform: "capitalize" }}>
                  {status.replace(/_/g, " ")}
                </span>
                <span style={{ color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const NexoDscDashboard = NexoDscDashboardInner;

export const NexoDscDashboardComp = nexoComp({
  name: "NexoDscDashboard",
  purpose: "Live DSC (Deterministic State & Computation) runtime metrics panel. Shows cache hit rate, average latency, deduplication stats, token savings, and stage-duration breakdown from a DscCollector.",
  dependencies: ["NexoComp", "DscCollector"],
  dsa: {
    trackDirty: false, // metrics always re-render live
    lruCache: false    // collector subscription drives updates
  },
  render: (props: NexoDscDashboardProps) => <NexoDscDashboardInner {...props} />
});

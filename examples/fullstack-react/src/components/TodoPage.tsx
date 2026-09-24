import React, { type ReactNode } from "react";
import {
  nexoComp,
  NexoCard,
  NexoBadge,
  NexoMetric,
  NexoButton,
  NexoTerminal,
  NexoElementRoot,
  type NexoBadgeVariant
} from "@nexo-alpha/frontend";

export interface TodoData {
  readonly id: number;
  readonly text: string;
  readonly completed: boolean;
  readonly priority: "low" | "medium" | "high";
  readonly category: string;
}

export interface TodoAppProps {
  readonly todos: readonly TodoData[];
  readonly dscMetrics: {
    readonly totalOperations: number;
    readonly cacheHitRate: number;
    readonly totalTokensSaved: number;
    readonly deduplicatedOps: number;
    readonly averageDurationMs: number;
  };
  readonly serverUri?: string | undefined;
}

// 1. TodoItemComp using nexoComp with LRU memoization
export const TodoItemComp = nexoComp<{ readonly todo: TodoData }>({
  name: "TodoItem",
  purpose: "Renders an individual task with status badges and actions",
  dependencies: ["NexoBadge", "NexoButton"],
  dsa: {
    trackDirty: true,
    lruCache: true,
    cacheKey: (props: { readonly todo: TodoData }) => `${props.todo.id}:${props.todo.completed}:${props.todo.text}`
  },
  render: ({ todo }: { readonly todo: TodoData }): ReactNode => {
    const badgeVariant: NexoBadgeVariant =
      todo.priority === "high" ? "danger" : todo.priority === "medium" ? "warning" : "info";

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          backgroundColor: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "8px",
          marginBottom: "8px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <input
            type="checkbox"
            checked={todo.completed}
            readOnly
            style={{ width: "16px", height: "16px", accentColor: "#6366f1" }}
          />
          <span
            style={{
              fontSize: "14px",
              color: todo.completed ? "#94a3b8" : "#f1f5f9",
              textDecoration: todo.completed ? "line-through" : "none"
            }}
          >
            {todo.text}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NexoBadge variant="neutral">{todo.category}</NexoBadge>
          <NexoBadge variant={badgeVariant}>{todo.priority}</NexoBadge>
        </div>
      </div>
    );
  }
});

// 2. MetricsHeaderComp using nexoComp
export const MetricsHeaderComp = nexoComp<{ readonly metrics: TodoAppProps["dscMetrics"] }>({
  name: "MetricsHeader",
  purpose: "Displays live DSC deterministic compute metrics",
  dependencies: ["NexoMetric", "NexoCard"],
  dsa: { trackDirty: true },
  render: ({ metrics }: { readonly metrics: TodoAppProps["dscMetrics"] }): ReactNode => {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <NexoMetric label="DSC Operations" value={metrics.totalOperations} accentColor="#38bdf8" />
        <NexoMetric label="Cache Hit Rate" value={`${Math.round(metrics.cacheHitRate * 100)}%`} accentColor="#4ade80" />
        <NexoMetric label="Avg Latency" value={`${metrics.averageDurationMs} ms`} accentColor="#818cf8" />
        <NexoMetric label="Tokens Saved" value={metrics.totalTokensSaved} accentColor="#fbbf24" />
      </div>
    );
  }
});

// 3. Main Dashboard using nexoComp composition
export const NexoFullstackDashboard = nexoComp<TodoAppProps>({
  name: "NexoFullstackDashboard",
  purpose: "Full dashboard aggregating Todo management, DSC telemetry, and Nexo terminal",
  dependencies: ["TodoItem", "MetricsHeader", "NexoCard", "NexoTerminal"],
  dsa: { trackDirty: true },
  render: ({ todos, dscMetrics, serverUri }: TodoAppProps): ReactNode => {
    const completedCount = todos.filter((t: TodoData) => t.completed).length;

    return (
      <NexoElementRoot>
        <div
          style={{
            minHeight: "100vh",
            backgroundColor: "#0b0f19",
            color: "#f8fafc",
            fontFamily: "system-ui, -apple-system, sans-serif",
            padding: "32px 24px"
          }}
        >
          <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            {/* Header Banner */}
            <div style={{ marginBottom: "28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <h1 style={{ fontSize: "28px", fontWeight: 700, margin: 0, color: "#ffffff" }}>
                  Nexo Fullstack + DSC Studio
                </h1>
                <NexoBadge variant="purple">React Background Engine</NexoBadge>
                <NexoBadge variant="success">DSC Enabled</NexoBadge>
              </div>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
                Autonomous backend orchestrated by Nexo Core & DSC Pipeline. Frontend declared via <code>nexoComp</code> with DAG tracking.
                {serverUri ? ` Connected to: ${serverUri}` : ""}
              </p>
            </div>

            {/* DSC Telemetry Metrics */}
            <MetricsHeaderComp metrics={dscMetrics} />

            {/* Todo List Card */}
            <NexoCard
              title="Autonomous Task Queue"
              subtitle={`${completedCount} of ${todos.length} completed`}
              variant="glow"
              headerActions={
                <NexoButton variant="primary" size="sm">
                  + Add Task
                </NexoButton>
              }
            >
              <div style={{ marginTop: "12px" }}>
                {todos.map((todo: TodoData) => (
                  <TodoItemComp key={todo.id} todo={todo} />
                ))}
              </div>
            </NexoCard>

            {/* Live Terminal */}
            <div style={{ marginTop: "24px" }}>
              <NexoTerminal
                title="DSC Execution & Observability Stream"
                entries={[
                  {
                    id: "log-1",
                    timestamp: new Date().toISOString(),
                    level: "info",
                    message: "DSC Orchestrator initialized with LRU Cache and Telemetry Sink"
                  },
                  {
                    id: "log-2",
                    timestamp: new Date().toISOString(),
                    level: "success",
                    message: `Fetched ${todos.length} items with deterministic verification`
                  },
                  {
                    id: "log-3",
                    timestamp: new Date().toISOString(),
                    level: "info",
                    message: `Scheduler active: health-monitor scheduled on cron */5 * * * *`
                  }
                ]}
              />
            </div>
          </div>
        </div>
      </NexoElementRoot>
    );
  }
});

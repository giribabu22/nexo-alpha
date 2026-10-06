import React, { useState, type ReactNode } from "react";
import {
  nexoComp,
  NexoCard,
  NexoBadge,
  NexoButton,
  NexoTerminal,
  NexoTabs,
  NexoKnowledgeInspector,
  NexoWorkflowCatalog,
  NexoWorkflowDashboard,
  NexoMetricsDashboard,
  NexoMemoryBrowser,
  NexoProjectSwitcher,
  NexoElementRoot,
  NexoProvider,
  type NexoTabItem,
  type TerminalEntry
} from "@nexo-alpha/frontend";
import { TodoItemComp, MetricsHeaderComp, type TodoData } from "./TodoPage.js";

export interface NexoStudioProps {
  readonly todos: readonly TodoData[];
  readonly dscMetrics: {
    readonly totalOperations: number;
    readonly cacheHitRate: number;
    readonly totalTokensSaved: number;
    readonly deduplicatedOps: number;
    readonly averageDurationMs: number;
  };
  readonly serverUri?: string | undefined;
  readonly defaultTab?: string | undefined;
  readonly activeProject?: string | undefined;
}

export const NexoStudioComp = nexoComp<NexoStudioProps>({
  name: "NexoStudio",
  purpose: "Unified Fullstack AI Studio integrating Task Management, DSC Telemetry, Workflows, Knowledge Graph, Metrics, and Memory",
  dependencies: [
    "NexoTabs",
    "NexoCard",
    "NexoWorkflowDashboard",
    "NexoWorkflowCatalog",
    "NexoKnowledgeInspector",
    "NexoMetricsDashboard",
    "NexoMemoryBrowser",
    "NexoProjectSwitcher"
  ],
  dsa: { trackDirty: true },
  render: ({
    todos,
    dscMetrics,
    serverUri,
    defaultTab = "tasks",
    activeProject = "default"
  }: NexoStudioProps): ReactNode => {
    const [selectedProject, setSelectedProject] = useState(activeProject);
    const [terminalLogs, setTerminalLogs] = useState<readonly TerminalEntry[]>([
      {
        id: "init-1",
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Nexo Studio booted with 5 integrated subsystems"
      },
      {
        id: "init-2",
        timestamp: new Date().toISOString(),
        level: "success",
        message: `Connected to runtime backend at ${serverUri ?? "local"}`
      },
      {
        id: "init-3",
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Decision Engine active: tool permission rules enforced"
      }
    ]);

    const completedCount = todos.filter((t) => t.completed).length;

    // 1. Tasks Tab Content
    const tasksContent = (
      <div style={{ display: "grid", gap: "24px" }}>
        <MetricsHeaderComp metrics={dscMetrics} />

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "20px" }}>
          <NexoCard
            title="Deterministic Task Queue"
            subtitle={`${completedCount} of ${todos.length} completed • Monitored by DSC Pipeline`}
            variant="glow"
            headerActions={
              <NexoButton variant="primary" size="sm">
                + Add Task
              </NexoButton>
            }
          >
            <div style={{ marginTop: "12px" }}>
              {todos.map((todo) => (
                <TodoItemComp key={todo.id} todo={todo} />
              ))}
            </div>
          </NexoCard>

          <NexoCard title="Quick AI Autonomous Actions" subtitle="Safety-gated triggers">
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
              <div
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.06)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontWeight: 600, fontSize: "14px" }}>Run Task Optimizer</span>
                  <NexoBadge variant="info">Workflow</NexoBadge>
                </div>
                <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 10px 0" }}>
                  Audits all pending tasks, scores priority urgency, and logs insights to Agent Memory.
                </p>
                <NexoButton
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await fetch(`${serverUri ?? ""}/workflows/task-optimizer/runs`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-user": "studio-user" },
                        body: JSON.stringify({ goal: "Optimize pending tasks and record insights" })
                      });
                      const run = await res.json();
                      setTerminalLogs((prev) => [
                        ...prev,
                        {
                          id: `run-${Date.now()}`,
                          timestamp: new Date().toISOString(),
                          level: "success",
                          message: `Workflow run triggered: ${run.id} (${run.status})`
                        }
                      ]);
                    } catch (e: any) {
                      setTerminalLogs((prev) => [
                        ...prev,
                        {
                          id: `err-${Date.now()}`,
                          timestamp: new Date().toISOString(),
                          level: "error",
                          message: `Failed to trigger workflow: ${e.message}`
                        }
                      ]);
                    }
                  }}
                >
                  ⚡ Execute Optimizer
                </NexoButton>
              </div>

              <div
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.06)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontWeight: 600, fontSize: "14px" }}>DSC Cache Flush</span>
                  <NexoBadge variant="warning">Telemetry</NexoBadge>
                </div>
                <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 10px 0" }}>
                  Invalidates memoized execution cache to trigger deterministic cold runs.
                </p>
                <NexoButton
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTerminalLogs((prev) => [
                      ...prev,
                      {
                        id: `cache-${Date.now()}`,
                        timestamp: new Date().toISOString(),
                        level: "info",
                        message: "DSC cache invalidated manually from Studio console."
                      }
                    ]);
                  }}
                >
                  Clear Cache
                </NexoButton>
              </div>
            </div>
          </NexoCard>
        </div>

        <NexoTerminal
          title="DSC & Agent Runtime Event Stream"
          entries={terminalLogs}
        />
      </div>
    );

    // 2. Workflows Tab Content
    const workflowsContent = (
      <div style={{ display: "grid", gap: "24px" }}>
        <NexoWorkflowCatalog />
        <NexoWorkflowDashboard workflow="task-optimizer" pollInterval={3000} />
      </div>
    );

    // 3. Knowledge Tab Content
    const knowledgeContent = (
      <div style={{ display: "grid", gap: "24px" }}>
        <NexoKnowledgeInspector pollInterval={4000} />
      </div>
    );

    // 4. Metrics Tab Content
    const metricsContent = (
      <div style={{ display: "grid", gap: "24px" }}>
        <NexoMetricsDashboard pollInterval={3000} />
      </div>
    );

    // 5. Memory Tab Content
    const memoryContent = (
      <div style={{ display: "grid", gap: "24px" }}>
        <NexoCard title="Agent Memory Inspector" subtitle="Long-term recall and contextual knowledge across runs">
          <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "4px" }}>
            The agent recalls these records across workflow runs to adapt to user preferences and persistent project context.
          </p>
        </NexoCard>
        <NexoMemoryBrowser />
      </div>
    );

    const tabs: readonly NexoTabItem[] = [
      { id: "tasks", label: "📋 Tasks & DSC Pipeline", content: tasksContent },
      { id: "workflows", label: "⚡ AI Workflows", content: workflowsContent },
      { id: "knowledge", label: "🧠 Knowledge Graph", content: knowledgeContent },
      { id: "metrics", label: "📊 System Metrics", content: metricsContent },
      { id: "memory", label: "💾 Agent Memory", content: memoryContent }
    ];

    return (
      <NexoElementRoot>
        <NexoProvider baseUrl={serverUri ?? ""} projectId={selectedProject}>
          <div
            style={{
              minHeight: "100vh",
              backgroundColor: "#0b0f19",
              color: "#f8fafc",
              fontFamily: "system-ui, -apple-system, sans-serif",
              padding: "24px 32px"
            }}
          >
            <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
              {/* Studio Header Bar */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "16px",
                  paddingBottom: "20px",
                  marginBottom: "24px",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
                    <h1 style={{ fontSize: "26px", fontWeight: 800, margin: 0, color: "#ffffff", letterSpacing: "-0.02em" }}>
                      Nexo Studio
                    </h1>
                    <NexoBadge variant="purple">v0.6.0</NexoBadge>
                    <NexoBadge variant="success">● Connected</NexoBadge>
                    <NexoBadge variant="info">Multi-Tenant</NexoBadge>
                  </div>
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
                    Autonomous AI Application Framework • Fullstack DSC & React Studio
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "13px", color: "#94a3b8" }}>Tenant Scope:</span>
                  <NexoProjectSwitcher
                    value={selectedProject}
                    onChange={(projectId) => setSelectedProject(projectId)}
                    allowCreate
                  />
                </div>
              </div>

              {/* Segmented Subsystems Navigation Tabs */}
              <NexoTabs
                tabs={tabs}
                defaultTabId={defaultTab}
              />
            </div>
          </div>
        </NexoProvider>
      </NexoElementRoot>
    );
  }
});

export const NexoStudio = NexoStudioComp;

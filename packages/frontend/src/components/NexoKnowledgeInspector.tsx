import React from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";
import { useNexoKnowledge, useNexoHealth } from "../hooks.js";
import { NexoModuleGraph } from "./NexoModuleGraph.js";
import type { NexoKnowledge, NexoModuleInfo } from "../types.js";

export interface NexoKnowledgeInspectorProps {
  readonly id?: string | undefined;
  readonly knowledge?: NexoKnowledge | null | undefined;
  readonly moduleGraph?: readonly NexoModuleInfo[] | undefined;
  readonly loading?: boolean | undefined;
  readonly pollInterval?: number | undefined;
}

export const NexoKnowledgeInspectorComp: NexoComp<NexoKnowledgeInspectorProps> = nexoComp<NexoKnowledgeInspectorProps>({
  name: "NexoKnowledgeInspector",
  purpose: "Live interactive inspector for Nexo ADR decisions, architectural constraints, and intents",
  render: ({
    knowledge: propKnowledge,
    moduleGraph: propModuleGraph,
    loading: propLoading,
    pollInterval
  }) => {
  const knowledgeHook = useNexoKnowledge({
    enabled: propKnowledge === undefined,
    pollInterval: pollInterval ?? 10000
  });

  const healthHook = useNexoHealth({
    enabled: propModuleGraph === undefined,
    pollInterval: pollInterval ?? 10000
  });

  const isLoading = propLoading !== undefined ? propLoading : (knowledgeHook.loading && healthHook.loading);
  const knowledge = propKnowledge !== undefined ? propKnowledge : knowledgeHook.knowledge;
  const moduleGraph = propModuleGraph !== undefined ? propModuleGraph : healthHook.health?.moduleGraph;

  if (isLoading) {
    return (
      <div className="nexo-panel" style={{ textAlign: "center", padding: "40px 20px" }}>
        <p style={{ color: "var(--nexo-text-secondary, #94a3b8)" }}>
          Connecting to Nexo Application Context & Knowledge Journal...
        </p>
      </div>
    );
  }

  if (!knowledge) {
    return (
      <div className="nexo-panel" style={{ textAlign: "center", padding: "40px 20px" }}>
        <p style={{ color: "var(--nexo-danger, #ef4444)" }}>
          Unable to load Nexo Knowledge. Ensure the backend is running.
        </p>
      </div>
    );
  }

  const decisions = knowledge.decisions || [];
  const constraints = knowledge.constraints || [];
  const intents = knowledge.intents || [];
  const state = knowledge.developmentState;

  return (
    <div className="nexo-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "var(--nexo-text-primary, #f8fafc)" }}>
            Nexo Knowledge Journal
          </h2>
          <p style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.9rem", marginTop: "4px" }}>
            Live introspection of application decisions, constraints, component intents, and module dependency graph
          </p>
        </div>
        <span className="nexo-badge nexo-badge-accepted">
          ● Live Sync
        </span>
      </div>

      {/* Metrics Row */}
      <div className="nexo-stats-grid">
        <div className="nexo-stat-box">
          <div className="nexo-stat-val">{decisions.length}</div>
          <div className="nexo-stat-label">Decisions (ADRs)</div>
        </div>
        <div className="nexo-stat-box">
          <div className="nexo-stat-val">{constraints.length}</div>
          <div className="nexo-stat-label">Invariants</div>
        </div>
        <div className="nexo-stat-box">
          <div className="nexo-stat-val">{intents.length}</div>
          <div className="nexo-stat-label">Component Intents</div>
        </div>
        <div className="nexo-stat-box">
          <div className="nexo-stat-val">{moduleGraph?.length || 0}</div>
          <div className="nexo-stat-label">Active Modules</div>
        </div>
      </div>

      {/* Module Graph Section */}
      {moduleGraph && moduleGraph.length > 0 && (
        <div style={{ marginTop: "28px" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", color: "var(--nexo-text-primary, #f8fafc)" }}>
            <span>🔗</span> Module Dependency & Dependents Graph
          </h3>
          <NexoModuleGraph modules={moduleGraph} />
        </div>
      )}

      {/* Decisions Section */}
      <div style={{ marginTop: "28px" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", color: "var(--nexo-text-primary, #f8fafc)" }}>
          <span>🏛️</span> Architectural Decisions
        </h3>
        <div className="nexo-grid">
          {decisions.map((d, idx) => (
            <div key={d.id || idx} className="nexo-card">
              <div className="nexo-card-header">
                <strong style={{ fontSize: "1.05rem", color: "var(--nexo-text-primary, #f8fafc)" }}>{d.title}</strong>
                <span className="nexo-badge nexo-badge-accepted">{d.status || "accepted"}</span>
              </div>
              {d.reason && (
                <p style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.95rem", lineHeight: 1.5, margin: "6px 0 0 0" }}>
                  {d.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Constraints Section */}
      <div style={{ marginTop: "28px" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", color: "var(--nexo-text-primary, #f8fafc)" }}>
          <span>🛡️</span> System Constraints & Invariants
        </h3>
        <div className="nexo-grid">
          {constraints.map((c, idx) => (
            <div key={idx} className="nexo-card">
              <div className="nexo-card-header">
                <span style={{ fontWeight: 600, fontSize: "0.98rem", color: "var(--nexo-text-primary, #f8fafc)" }}>
                  {c.description}
                </span>
                <span className="nexo-badge nexo-badge-constraint">invariant</span>
              </div>
              {c.reason && (
                <p style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.9rem", margin: "6px 0 0 0" }}>
                  <strong>Reason:</strong> {c.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Intents Section */}
      <div style={{ marginTop: "28px" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", color: "var(--nexo-text-primary, #f8fafc)" }}>
          <span>🎯</span> Component & Entity Intents (AI-Era Context)
        </h3>
        <div className="nexo-grid">
          {intents.map((item, idx) => (
            <div key={idx} className="nexo-card">
              <div className="nexo-card-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <code style={{ fontSize: "1rem", color: "var(--nexo-accent, #38bdf8)", fontWeight: 700 }}>
                    &lt;{item.entityName} /&gt;
                  </code>
                  <span className="nexo-badge nexo-badge-intent">{item.entityKind}</span>
                </div>
              </div>
              <p style={{ color: "var(--nexo-text-primary, #f8fafc)", fontSize: "0.95rem", margin: "6px 0 0 0" }}>
                {item.purpose}
              </p>
              {item.evidence && (
                <div style={{ marginTop: "10px", fontSize: "0.8rem", color: "var(--nexo-accent, #38bdf8)", fontFamily: "monospace" }}>
                  <span>📍 {item.evidence.file}{item.evidence.line ? `:${item.evidence.line}` : ""}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Development State */}
      {state && (
        <div style={{ marginTop: "28px" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", color: "var(--nexo-text-primary, #f8fafc)" }}>
            <span>🚀</span> Development State
          </h3>
          <div className="nexo-card">
            {state.completed && state.completed.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--nexo-text-secondary, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Completed Work
                </span>
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0 0", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {state.completed.map((item, idx) => (
                    <li key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.95rem", color: "var(--nexo-text-primary, #f8fafc)" }}>
                      <span style={{ color: "var(--nexo-success, #22c55e)" }}>✓</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {state.inProgress && state.inProgress.length > 0 && (
              <div style={{ marginTop: "16px" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--nexo-text-secondary, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  In Progress
                </span>
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0 0", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {state.inProgress.map((item, idx) => (
                    <li key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.95rem", color: "var(--nexo-text-primary, #f8fafc)" }}>
                      <span style={{ color: "var(--nexo-accent, #38bdf8)" }}>●</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    );
  }
});

export const NexoKnowledgeInspector = NexoKnowledgeInspectorComp;

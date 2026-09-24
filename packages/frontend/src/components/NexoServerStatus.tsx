import React from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";
import { useNexoHealth } from "../hooks.js";
import type { NexoHealth } from "../types.js";

export interface NexoServerStatusProps {
  readonly id?: string | undefined;
  readonly health?: NexoHealth | null | undefined;
  readonly pollInterval?: number | undefined;
}

export const NexoServerStatusComp: NexoComp<NexoServerStatusProps> = nexoComp<NexoServerStatusProps>({
  name: "NexoServerStatus",
  purpose: "Live connection health monitor and active module graph display with DAG tracking",
  render: ({ health: propHealth, pollInterval }) => {
    const hookResult = useNexoHealth({
      enabled: propHealth === undefined,
      pollInterval: pollInterval ?? 5000
    });

    const health = propHealth !== undefined ? propHealth : hookResult.health;
    const isOnline = health?.status === "ok";

    return (
      <div className="nexo-panel nexo-server-status">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className={`nexo-status-indicator ${isOnline ? "online" : "offline"}`} />
          <strong style={{ fontSize: "1.05rem" }}>Backend Status:</strong>
          <span style={{ color: "var(--nexo-text-secondary, #94a3b8)" }}>
            {health ? "Connected & Online" : "Connecting..."}
          </span>
        </div>

        {health && (
          <div style={{ display: "flex", gap: "16px", alignItems: "center", fontSize: "0.9rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span>Modules:</span>
              {health.moduleGraph && health.moduleGraph.length > 0 ? (
                health.moduleGraph.map((mod) => (
                  <span
                    key={mod.name}
                    className="nexo-module-chip"
                    title={
                      `${mod.name}\n` +
                      (mod.dependencies.length ? `• Depends on: ${mod.dependencies.join(", ")}\n` : "") +
                      (mod.dependents.length ? `• Dependents: ${mod.dependents.join(", ")}\n` : "• Dependents: none\n") +
                      (mod.externalDependencies?.length ? `• npm packages: ${mod.externalDependencies.join(", ")}` : "")
                    }
                  >
                    {mod.name}
                    {mod.dependents && mod.dependents.length > 0 && (
                      <span style={{ marginLeft: "5px", color: "var(--nexo-accent, #38bdf8)", fontSize: "0.75rem", fontWeight: 700 }}>
                        ({mod.dependents.length} dep{mod.dependents.length > 1 ? "s" : ""})
                      </span>
                    )}
                  </span>
                ))
              ) : (
                <strong style={{ color: "var(--nexo-text-primary, #f8fafc)" }}>
                  {health.modules?.join(", ") || "none"}
                </strong>
              )}
            </div>
            <span>
              Uptime: <strong style={{ color: "var(--nexo-text-primary, #f8fafc)" }}>{health.uptimeSeconds}s</strong>
            </span>
          </div>
        )}
      </div>
    );
  }
});

export const NexoServerStatus = NexoServerStatusComp;

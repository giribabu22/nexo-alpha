import React from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";
import type { NexoModuleInfo } from "../types.js";

export interface NexoModuleGraphProps {
  readonly id?: string | undefined;
  readonly modules: readonly NexoModuleInfo[];
}

export const NexoModuleGraphComp: NexoComp<NexoModuleGraphProps> = nexoComp<NexoModuleGraphProps>({
  name: "NexoModuleGraph",
  purpose: "Visual DAG inspector showing upstream dependencies and downstream dependents across modules",
  render: ({ modules }) => {
    if (!modules || modules.length === 0) {
      return (
        <div className="nexo-card" style={{ textAlign: "center", color: "var(--nexo-text-secondary, #94a3b8)", padding: "20px" }}>
          No modules registered.
        </div>
      );
    }

    return (
      <div className="nexo-grid">
        {modules.map((mod) => (
          <div key={mod.name} className="nexo-card">
            <div className="nexo-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <code style={{ fontSize: "1.05rem", color: "var(--nexo-accent, #38bdf8)", fontWeight: 700 }}>
                  {mod.name}
                </code>
                <span className="nexo-badge nexo-badge-accepted">module</span>
              </div>
              <span style={{ fontSize: "0.8rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>
                {mod.dependents.length} dependent{mod.dependents.length === 1 ? "" : "s"}
              </span>
            </div>

            {mod.description && (
              <p style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.9rem", margin: "6px 0 10px 0" }}>
                {mod.description}
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.85rem", marginTop: "10px" }}>
              <div>
                <span style={{ color: "var(--nexo-text-secondary, #94a3b8)" }}>Depends on (upstream): </span>
                {mod.dependencies.length > 0 ? (
                  mod.dependencies.map((d) => (
                    <span key={d} className="nexo-badge nexo-badge-intent" style={{ marginRight: "4px" }}>
                      {d}
                    </span>
                  ))
                ) : (
                  <span style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontStyle: "italic" }}>
                    None (Root module)
                  </span>
                )}
              </div>

              <div>
                <span style={{ color: "var(--nexo-text-secondary, #94a3b8)" }}>Dependents (downstream): </span>
                {mod.dependents.length > 0 ? (
                  mod.dependents.map((dep) => (
                    <span key={dep} className="nexo-badge nexo-badge-constraint" style={{ marginRight: "4px" }}>
                      {dep}
                    </span>
                  ))
                ) : (
                  <span style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontStyle: "italic" }}>
                    None (Leaf module)
                  </span>
                )}
              </div>

              {mod.externalDependencies && mod.externalDependencies.length > 0 && (
                <div>
                  <span style={{ color: "var(--nexo-text-secondary, #94a3b8)" }}>NPM Packages: </span>
                  {mod.externalDependencies.map((pkg) => (
                    <span key={pkg} className="nexo-badge nexo-badge-accepted" style={{ marginRight: "4px" }}>
                      {pkg}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }
});

export const NexoModuleGraph = NexoModuleGraphComp;

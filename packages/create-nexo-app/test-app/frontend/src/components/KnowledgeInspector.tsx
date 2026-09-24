export function KnowledgeInspector({ 
  knowledge, 
  moduleGraph, 
  loading 
}: { 
  knowledge: any; 
  moduleGraph?: any[]; 
  loading: boolean 
}) {
  if (loading) {
    return (
      <div className="glass-panel" style={{ textAlign: "center", padding: "40px 20px" }}>
        <p style={{ color: "var(--text-secondary)" }}>Connecting to Nexo Application Context & Knowledge Journal...</p>
      </div>
    );
  }

  if (!knowledge) {
    return (
      <div className="glass-panel" style={{ textAlign: "center", padding: "40px 20px" }}>
        <p style={{ color: "var(--danger)" }}>Unable to load Nexo Knowledge. Ensure the backend is running.</p>
      </div>
    );
  }

  const decisions = knowledge.decisions || [];
  const constraints = knowledge.constraints || [];
  const intents = knowledge.intents || [];
  const state = knowledge.developmentState;

  return (
    <div className="glass-panel" style={{ animation: "slideUp 0.6s both" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Nexo Knowledge Journal</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "4px" }}>
            Live introspection of application decisions, constraints, component intents, and module dependency graph
          </p>
        </div>
        <span className="badge-live-sync">● Live Sync</span>
      </div>

      {/* Metrics Row */}
      <div className="k-stats-grid">
        <div className="k-stat-box">
          <div className="k-stat-val">{decisions.length}</div>
          <div className="k-stat-label">Decisions (ADRs)</div>
        </div>
        <div className="k-stat-box">
          <div className="k-stat-val">{constraints.length}</div>
          <div className="k-stat-label">Invariants</div>
        </div>
        <div className="k-stat-box">
          <div className="k-stat-val">{intents.length}</div>
          <div className="k-stat-label">Component Intents</div>
        </div>
        <div className="k-stat-box">
          <div className="k-stat-val">{moduleGraph?.length || 0}</div>
          <div className="k-stat-label">Active Modules</div>
        </div>
      </div>

      {/* Module Graph Section */}
      {moduleGraph && moduleGraph.length > 0 && (
        <div style={{ marginTop: "28px" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>🔗</span> Module Dependency & Dependents Graph
          </h3>
          <div className="knowledge-grid">
            {moduleGraph.map((mod: any) => (
              <div key={mod.name} className="k-card">
                <div className="k-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <code style={{ fontSize: "1.05rem", color: "var(--accent-primary)", fontWeight: 700 }}>
                      {mod.name}
                    </code>
                    <span className="k-badge badge-accepted">module</span>
                  </div>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    {mod.dependents?.length || 0} dependent{mod.dependents?.length === 1 ? "" : "s"}
                  </span>
                </div>
                {mod.description && (
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "6px 0 10px 0" }}>
                    {mod.description}
                  </p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.85rem", marginTop: "10px" }}>
                  <div>
                    <span style={{ color: "var(--text-secondary)" }}>Depends on (upstream): </span>
                    {mod.dependencies?.length > 0 ? (
                      mod.dependencies.map((d: string) => (
                        <span key={d} className="k-badge badge-intent" style={{ marginRight: "4px" }}>{d}</span>
                      ))
                    ) : (
                      <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>None (Root module)</span>
                    )}
                  </div>
                  <div>
                    <span style={{ color: "var(--text-secondary)" }}>Dependents (downstream): </span>
                    {mod.dependents?.length > 0 ? (
                      mod.dependents.map((dep: string) => (
                        <span key={dep} className="k-badge badge-constraint" style={{ marginRight: "4px" }}>{dep}</span>
                      ))
                    ) : (
                      <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>None (Leaf module)</span>
                    )}
                  </div>
                  {mod.externalDependencies && mod.externalDependencies.length > 0 && (
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>NPM Packages: </span>
                      {mod.externalDependencies.map((pkg: string) => (
                        <span key={pkg} className="k-badge badge-accepted" style={{ marginRight: "4px" }}>{pkg}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decisions Section */}
      <div style={{ marginTop: "28px" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>🏛️</span> Architectural Decisions
        </h3>
        <div className="knowledge-grid">
          {decisions.map((d: any, idx: number) => (
            <div key={d.id || idx} className="k-card">
              <div className="k-header">
                <strong style={{ fontSize: "1.05rem" }}>{d.title}</strong>
                <span className="k-badge badge-accepted">{d.status || "accepted"}</span>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.5, margin: "6px 0 0 0" }}>
                {d.reason}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Constraints Section */}
      <div style={{ marginTop: "28px" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>🛡️</span> System Constraints & Invariants
        </h3>
        <div className="knowledge-grid">
          {constraints.map((c: any, idx: number) => (
            <div key={idx} className="k-card">
              <div className="k-header">
                <span style={{ fontWeight: 600, fontSize: "0.98rem" }}>{c.description}</span>
                <span className="k-badge badge-constraint">invariant</span>
              </div>
              {c.reason && (
                <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "6px 0 0 0" }}>
                  <strong>Reason:</strong> {c.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Intents Section */}
      <div style={{ marginTop: "28px" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>🎯</span> Component & Entity Intents (AI-Era Context)
        </h3>
        <div className="knowledge-grid">
          {intents.map((item: any, idx: number) => (
            <div key={idx} className="k-card">
              <div className="k-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <code style={{ fontSize: "1rem", color: "var(--accent-primary)", fontWeight: 700 }}>
                    &lt;{item.entityName} /&gt;
                  </code>
                  <span className="k-badge badge-intent">{item.entityKind}</span>
                </div>
              </div>
              <p style={{ color: "var(--text-primary)", fontSize: "0.95rem", margin: "6px 0 0 0" }}>
                {item.purpose}
              </p>
              {item.evidence && (
                <div className="k-evidence">
                  <span>📍 {item.evidence.file}{item.evidence.line ? ":" + item.evidence.line : ""}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Development State */}
      {state && (
        <div style={{ marginTop: "28px" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>🚀</span> Development State
          </h3>
          <div className="k-card">
            <div style={{ marginBottom: "12px" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Completed Work
              </span>
              <ul className="k-state-list" style={{ marginTop: "8px" }}>
                {state.completed?.map((item: string, idx: number) => (
                  <li key={idx} className="k-state-item">
                    <span style={{ color: "var(--success)" }}>✓</span> {item}
                  </li>
                ))}
              </ul>
            </div>
            {state.inProgress?.length > 0 && (
              <div style={{ marginTop: "16px" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  In Progress
                </span>
                <ul className="k-state-list" style={{ marginTop: "8px" }}>
                  {state.inProgress?.map((item: string, idx: number) => (
                    <li key={idx} className="k-state-item">
                      <span className="pulse-indicator">●</span> {item}
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

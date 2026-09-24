export function ServerStatus({ health }: { health: any }) {
  const isOk = health?.status === "ok";
  
  return (
    <div className="glass-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ 
          width: "12px", height: "12px", borderRadius: "50%", 
          background: isOk ? "var(--success)" : "var(--danger)",
          boxShadow: `0 0 10px ${isOk ? "var(--success)" : "var(--danger)"}`
        }} />
        <strong style={{ fontSize: "1.1rem" }}>Backend Status:</strong> 
        <span style={{ color: "var(--text-secondary)" }}>{health ? "Connected & Online" : "Connecting..."}</span>
      </div>
      {health && (
        <div style={{ display: "flex", gap: "16px", alignItems: "center", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span>Modules:</span>
            {health.moduleGraph ? (
              health.moduleGraph.map((m: any) => (
                <span
                  key={m.name}
                  style={{
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(255, 255, 255, 0.06)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    fontSize: "0.85rem",
                    color: "var(--text-primary)"
                  }}
                  title={
                    `${m.name}\n` +
                    (m.dependencies?.length ? `• Depends on: ${m.dependencies.join(", ")}\n` : "") +
                    (m.dependents?.length ? `• Dependents: ${m.dependents.join(", ")}` : "• Dependents: none")
                  }
                >
                  {m.name}
                  {m.dependents && m.dependents.length > 0 && (
                    <span style={{ marginLeft: "5px", color: "var(--accent-primary)", fontSize: "0.75rem" }}>
                      ({m.dependents.length} dep{m.dependents.length > 1 ? "s" : ""})
                    </span>
                  )}
                </span>
              ))
            ) : (
              <strong style={{ color: "var(--text-primary)" }}>{health.modules?.join(", ")}</strong>
            )}
          </div>
          <span>Uptime: <strong style={{ color: "var(--text-primary)" }}>{health.uptimeSeconds}s</strong></span>
        </div>
      )}
    </div>
  );
}

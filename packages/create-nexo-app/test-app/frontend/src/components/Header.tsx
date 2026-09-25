export function Header({ projectName }: { projectName: string }) {
  return (
    <header style={{ textAlign: "center", marginBottom: "40px", animation: "slideUp 0.6s both" }}>
      <div style={{ display: "inline-flex", justifyContent: "center", marginBottom: "16px" }}>
        <img
          src="/logo.png"
          alt="Nexo Logo"
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "18px",
            boxShadow: "0 10px 30px rgba(56, 189, 248, 0.25)",
            border: "1px solid rgba(56, 189, 248, 0.2)"
          }}
        />
      </div>
      <h1 className="gradient-text" style={{ fontSize: "3rem", fontWeight: 800, marginBottom: "8px", letterSpacing: "-0.02em" }}>
        {projectName}
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
        The AI Application Framework — Powered by Nexo
      </p>
    </header>
  );
}

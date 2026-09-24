export function Header({ projectName }: { projectName: string }) {
  return (
    <header style={{ textAlign: "center", marginBottom: "40px", animation: "slideUp 0.6s both" }}>
      <h1 className="gradient-text" style={{ fontSize: "3rem", fontWeight: 800, marginBottom: "8px", letterSpacing: "-0.02em" }}>
        {projectName}
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
        Premium Fullstack Architecture powered by Nexo
      </p>
    </header>
  );
}

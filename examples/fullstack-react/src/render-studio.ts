import React from "react";
import ReactDOMServer from "react-dom/server";
import { NexoStudio } from "./components/NexoStudio.js";
import { todos, dscCollector } from "./app.js";

const STUDIO_CSS = `
:root {
  --nexo-bg: #0b0f19;
  --nexo-panel: rgba(17, 24, 39, 0.7);
  --nexo-border: rgba(255, 255, 255, 0.08);
  --nexo-text-primary: #f8fafc;
  --nexo-text-secondary: #94a3b8;
  --nexo-accent: #38bdf8;
  --nexo-accent-hover: #0284c7;
  --nexo-success: #22c55e;
  --nexo-warning: #fbbf24;
  --nexo-danger: #ef4444;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--nexo-bg);
  color: var(--nexo-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

* {
  box-sizing: border-box;
}

.nexo-panel {
  background: var(--nexo-panel);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--nexo-border);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  margin-bottom: 20px;
}

.nexo-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.nexo-stat-box {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--nexo-border);
  border-radius: 12px;
  padding: 16px;
  text-align: center;
}

.nexo-stat-val {
  font-size: 2rem;
  font-weight: 800;
  color: var(--nexo-accent);
  line-height: 1.2;
}

.nexo-stat-label {
  font-size: 0.82rem;
  color: var(--nexo-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 4px;
}

.nexo-badge {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
}

.nexo-badge-accepted {
  background: rgba(34, 197, 94, 0.15);
  color: var(--nexo-success);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.tab-button {
  background: transparent;
  border: 1px solid transparent;
  color: var(--nexo-text-secondary);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-button:hover {
  color: var(--nexo-text-primary);
  background: rgba(255, 255, 255, 0.04);
}

.tab-button.active {
  color: #ffffff;
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.4);
}

.tab-panel {
  display: none;
}

.tab-panel.active {
  display: block;
}

input, select {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #ffffff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
}

input:focus, select:focus {
  outline: none;
  border-color: var(--nexo-accent);
}
`;

export function renderStudioHtml(serverUri: string): string {
  const metrics = dscCollector.getMetrics();

  const renderedContent = ReactDOMServer.renderToString(
    React.createElement(NexoStudio, {
      todos,
      dscMetrics: metrics,
      serverUri,
      defaultTab: "tasks",
      activeProject: "default"
    })
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nexo Studio — AI Application Framework</title>
  <link rel="icon" type="image/svg+xml" href="https://raw.githubusercontent.com/giribabu22/nexo-alpha/main/logo.svg">
  <style>
    ${STUDIO_CSS}
  </style>
</head>
<body>
  <div id="root">
    ${renderedContent}
  </div>

  <script>
    // Tab switching interactivity
    document.addEventListener("DOMContentLoaded", () => {
      const tabButtons = document.querySelectorAll(".tab-bar button, .nexo-tabs-container button");
      const tabContainers = document.querySelectorAll(".tab-content > div");
      
      tabButtons.forEach((btn, idx) => {
        btn.addEventListener("click", () => {
          tabButtons.forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          if (tabContainers[idx]) {
            tabContainers.forEach(c => c.style.display = "none");
            tabContainers[idx].style.display = "block";
          }
        });
      });
    });
  </script>
</body>
</html>`;
}

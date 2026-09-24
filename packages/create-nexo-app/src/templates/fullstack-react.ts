import { Template, TemplateFile } from "./types.js";

export const fullstackReactTemplate: Template = {
  name: "fullstack-react",
  description: "Full-stack application with Nexo backend (Hapi) and React + Vite frontend",
  getFiles(projectName: string): TemplateFile[] {
    return [
      {
        path: ".gitignore",
        content: `node_modules
dist
.env
*.log
.DS_Store
`
      },
      {
        path: ".dockerignore",
        content: `node_modules
dist
.git
.env
*.log
`
      },
      {
        path: ".env.example",
        content: `PORT=4000
NODE_ENV=development
`
      },
      {
        path: "Dockerfile",
        content: `# Multi-stage Docker build for Nexo Fullstack Application
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm install

COPY . .

RUN npm run build

# Production Runner
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN cd backend && npm install --omit=dev

EXPOSE 4000

CMD ["node", "backend/dist/index.js"]
`
      },
      {
        path: "README.md",
        content: `# ${projectName}

A full-stack application powered by **Nexo** backend and **React (Vite)** frontend.

## Getting Started

### 1. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Start Development Servers
\`\`\`bash
npm run dev
\`\`\`
This concurrently launches:
- **Backend (Nexo + Hapi)** on http://localhost:4000
- **Frontend (React + Vite)** on http://localhost:5173

### 3. Production Build & Docker
\`\`\`bash
# Build locally
npm run build
npm start

# Or run in Docker container
docker build -t ${projectName} .
docker run -p 4000:4000 ${projectName}
\`\`\`

## Architecture

- \`backend/\`: Nexo application model with modules, APIs, services, and lifecycle.
- \`frontend/\`: React 18 + Vite client interacting with Nexo backend APIs.

## Nexo CLI

Run these from \`backend/\` (or via \`npm --workspace=backend run <script>\` from the root):
\`\`\`bash
npx nexo inspect
npm run graph
npx nexo impact <nodeId>
npx nexo freshness --source-root src
\`\`\`
`
      },
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: projectName,
            version: "0.1.0",
            private: true,
            workspaces: [
              "backend",
              "frontend"
            ],
            scripts: {
              dev: "concurrently --kill-others \"npm run dev:backend\" \"npm run dev:frontend\"",
              "dev:backend": "npm --workspace=backend run dev",
              "dev:frontend": "npm --workspace=frontend run dev",
              build: "npm --workspace=backend run build && npm --workspace=frontend run build",
              start: "npm --workspace=backend start",
              inspect: "nexo inspect"
            },
            devDependencies: {
              "@nexo-alpha/cli": "^0.4.1",
              concurrently: "^9.1.0"
            }
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "nexo.config.json",
        content: JSON.stringify(
          {
            app: "./backend/dist/app.js"
          },
          null,
          2
        ) + "\n"
      },
      // Backend files
      {
        path: "backend/package.json",
        content: JSON.stringify(
          {
            name: `${projectName}-backend`,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "tsx watch src/index.ts",
              build: "tsc",
              start: "node dist/index.js",
              typecheck: "tsc --noEmit",
              graph: "nexo graph --source-root src --out .nexo/knowledge-graph.json"
            },
            dependencies: {
              "@nexo-alpha/core": "^0.4.1",
              "@nexo-alpha/context": "^0.4.1",
              "@nexo-alpha/decision": "^0.4.1",
              "@nexo-alpha/behavior": "^0.4.1",
              "@nexo-alpha/agent": "^0.4.1",
              "@nexo-alpha/web": "^0.4.1",
              "@nexo-alpha/hapi": "^0.4.1",
              "@nexo-alpha/scheduler": "^0.4.1",
              "@nexo-alpha/tools": "^0.4.1",
              "@nexo-alpha/cli": "^0.4.1"
            },
            devDependencies: {
              "@types/node": "^20.11.0",
              tsx: "^4.19.0",
              typescript: "^5.4.0"
            }
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "backend/tsconfig.json",
        content: JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              lib: ["ES2022"],
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
              forceConsistentCasingInFileNames: true,
              outDir: "./dist",
              rootDir: "./src",
              declaration: true
            },
            include: ["src/**/*"]
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "backend/nexo.config.json",
        content: JSON.stringify(
          {
            app: "./dist/app.js"
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "backend/src/app.ts",
        content: `import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";
import { registerTodosModule } from "./modules/todos/index.js";
import { registerSystemModule } from "./modules/system/index.js";

export const app = createApplication({
  name: "${projectName}-backend",
  version: "0.1.0",
  description: "Nexo backend service"
});

export const knowledge = createKnowledge();

// 1. Architectural Decisions (ADRs)
knowledge.addDecision({
  title: "Fullstack Architecture",
  reason: "Separation of pure Nexo backend business logic and React frontend layer.",
  status: "accepted"
});

knowledge.addDecision({
  title: "Client-Server Contract",
  reason: "Communicate via typed REST API endpoints under /api with unified JSON envelopes.",
  status: "accepted"
});

// 2. Constraints & Invariants
knowledge.addConstraint({
  description: "Frontend must interact with backend purely through documented REST endpoints under /api",
  reason: "Ensures headless decoupling and clear boundaries between client and server."
});

knowledge.addConstraint({
  description: "No secret keys, tokens, or backend credentials may be bundled into client assets",
  reason: "Prevents leaking sensitive infrastructure and credential data into browser bundles."
});

// 3. Component & Entity Intents (Explains the 'why' of UI components)
knowledge.addIntent({
  entityKind: "component",
  entityName: "Header",
  purpose: "Brand banner displaying application metadata and gradient typography.",
  evidence: { file: "frontend/src/components/Header.tsx", line: 3 }
});

knowledge.addIntent({
  entityKind: "component",
  entityName: "ServerStatus",
  purpose: "Real-time heartbeat monitor displaying backend health, active modules, and uptime.",
  evidence: { file: "frontend/src/components/ServerStatus.tsx", line: 3 }
});

knowledge.addIntent({
  entityKind: "component",
  entityName: "TodoApp",
  purpose: "Interactive fullstack task management demonstrating reactive state and Nexo API calls.",
  evidence: { file: "frontend/src/components/TodoApp.tsx", line: 3 }
});

knowledge.addIntent({
  entityKind: "component",
  entityName: "KnowledgeInspector",
  purpose: "Live browser introspection of Nexo architectural decisions, invariants, and component intents.",
  evidence: { file: "frontend/src/components/KnowledgeInspector.tsx", line: 3 }
});

// 4. Development Work State
knowledge.setDevelopmentState({
  completed: [
    "Core application scaffold",
    "Nexo backend Hapi server integration",
    "React + Vite frontend workspace",
    "Live Nexo Knowledge & Architecture Inspector"
  ],
  inProgress: [
    "Custom business module implementation"
  ]
});

// Each module lives in its own folder under src/modules — see that folder
// for the actual app.module({...}) registration and any services it needs.
registerSystemModule(app, knowledge);
registerTodosModule(app);
`
      },
      {
        path: "backend/src/modules/todos/service.ts",
        content: `import type { NexoService } from "@nexo-alpha/core";

export interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
  createdAt: string;
}

// Example Service: Encapsulates business logic & database/state management
export class TodoService implements NexoService {
  readonly name = "todo-service";
  readonly description = "Todo state and persistence service";

  private items: TodoItem[] = [
    { id: 1, text: "Explore Nexo Core Architecture", completed: true, createdAt: new Date().toISOString() },
    { id: 2, text: "Connect React Frontend to Nexo Backend", completed: true, createdAt: new Date().toISOString() },
    { id: 3, text: "Build your first autonomous Nexo module", completed: false, createdAt: new Date().toISOString() }
  ];

  async getAll(): Promise<TodoItem[]> {
    return [...this.items];
  }

  async add(text: string): Promise<TodoItem> {
    const newItem: TodoItem = {
      id: Date.now(),
      text,
      completed: false,
      createdAt: new Date().toISOString()
    };
    this.items.push(newItem);
    return newItem;
  }

  async toggle(id: number): Promise<TodoItem | null> {
    const item = this.items.find((t) => t.id === id);
    if (!item) return null;
    item.completed = !item.completed;
    return item;
  }
}
`
      },
      {
        path: "backend/src/modules/todos/index.ts",
        content: `import type { NexoApplication } from "@nexo-alpha/core";
import { TodoService } from "./service.js";

export function registerTodosModule(app: NexoApplication): void {
  const todoService = new TodoService();

  app.module({
    name: "todos",
    description: "Todo and Task management module",
    dependencies: ["system"],
    externalDependencies: [],
    services: [todoService],

    apis: [
      {
        name: "getTodos",
        method: "GET",
        path: "/api/todos",
        description: "List all todos",
        handler: async () => todoService.getAll()
      },
      {
        name: "addTodo",
        method: "POST",
        path: "/api/todos",
        description: "Create a new todo",
        handler: async (request: any) => {
          const payload = (request.payload || {}) as { text?: string };
          const text = payload.text?.trim() || "New Task";
          return todoService.add(text);
        }
      },
      {
        name: "toggleTodo",
        method: "POST",
        path: "/api/todos/{id}/toggle",
        description: "Toggle todo completion status",
        handler: async (request: any) => {
          const id = Number(request.params.id);
          const item = await todoService.toggle(id);
          if (item) return item;
          return { error: "Todo not found" };
        }
      }
    ]
  });
}
`
      },
      {
        path: "backend/src/modules/system/index.ts",
        content: `import type { NexoApplication } from "@nexo-alpha/core";
import type { ApplicationKnowledge } from "@nexo-alpha/context";

export function registerSystemModule(app: NexoApplication, knowledge?: ApplicationKnowledge): void {
  app.module({
    name: "system",
    description: "System health and runtime info",

    apis: [
      {
        name: "getHealth",
        method: "GET",
        path: "/api/health",
        description: "Return system and Nexo health status",
        handler: async () => ({
          status: "ok",
          framework: "Nexo",
          uptimeSeconds: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
          modules: app.getModules().map((m) => m.name),
          moduleGraph: app.getModules().map((m) => ({
            name: m.name,
            description: m.description,
            dependencies: app.getDependencies(m.name),
            dependents: app.getDependents(m.name),
            externalDependencies: m.externalDependencies ?? []
          }))
        })
      },
      {
        name: "getKnowledge",
        method: "GET",
        path: "/api/knowledge",
        description: "Return architecture decisions, constraints, and component intents",
        handler: async () => ({
          decisions: knowledge?.getDecisions() ?? [],
          constraints: knowledge?.getConstraints() ?? [],
          intents: knowledge?.getIntents() ?? [],
          developmentState: knowledge?.getDevelopmentState() ?? null
        })
      }
    ]
  });
}
`
      },
      {
        path: "backend/src/index.ts",
        content: `import { app } from "./app.js";
import { startHapiServer } from "@nexo-alpha/hapi";

async function main() {
  await app.start();

  const PORT = Number(process.env.PORT) || 4000;
  const server = await startHapiServer(app, {
    port: PORT,
    cors: true
  });

  console.log(\`✨ Nexo Backend ready at \${server.info.uri}\`);

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(\`\\n\${signal} received. Gracefully stopping Nexo server...\`);
    try {
      await server.stop({ timeout: 5000 });
      await app.stop();
      console.log("Nexo server gracefully stopped.");
      process.exit(0);
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start Nexo backend:", err);
  process.exit(1);
});
`
      },
      // Frontend files
      {
        path: "frontend/package.json",
        content: JSON.stringify(
          {
            name: `${projectName}-frontend`,
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: {
              dev: "vite",
              build: "tsc && vite build",
              preview: "vite preview"
            },
            dependencies: {
              react: "^18.3.1",
              "react-dom": "^18.3.1"
            },
            devDependencies: {
              "@types/react": "^18.3.5",
              "@types/react-dom": "^18.3.0",
              "@vitejs/plugin-react": "^4.3.1",
              typescript: "^5.5.3",
              vite: "^5.4.2"
            }
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "frontend/tsconfig.json",
        content: JSON.stringify(
          {
            compilerOptions: {
              target: "ES2020",
              useDefineForClassFields: true,
              lib: ["ES2020", "DOM", "DOM.Iterable"],
              module: "ESNext",
              skipLibCheck: true,
              moduleResolution: "bundler",
              allowImportingTsExtensions: true,
              resolveJsonModule: true,
              isolatedModules: true,
              noEmit: true,
              jsx: "react-jsx",
              strict: true,
              noUnusedLocals: true,
              noUnusedParameters: true,
              noFallthroughCasesInSwitch: true
            },
            include: ["src"]
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "frontend/vite.config.ts",
        content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
`
      },
      {
        path: "frontend/index.html",
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName} — Powered by Nexo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
      },
      {
        path: "frontend/src/main.tsx",
        content: `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`
      },
      {
        path: "frontend/src/index.css",
        content: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
  --bg-color: #0f172a;
  --surface-color: rgba(30, 41, 59, 0.7);
  --border-color: rgba(255, 255, 255, 0.1);
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --accent-primary: #38bdf8;
  --accent-secondary: #818cf8;
  --success: #22c55e;
  --danger: #ef4444;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Inter', -apple-system, sans-serif;
  background-color: var(--bg-color);
  background-image: 
    radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.15) 0px, transparent 50%),
    radial-gradient(at 100% 100%, rgba(129, 140, 248, 0.15) 0px, transparent 50%);
  color: var(--text-primary);
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 40px 20px;
}

#root {
  width: 100%;
  max-width: 800px;
}

/* Glassmorphism panel */
.glass-panel {
  background: var(--surface-color);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-color);
  border-radius: 24px;
  padding: 32px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  margin-bottom: 24px;
  animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.glass-panel:nth-child(2) { animation-delay: 0.1s; }
.glass-panel:nth-child(3) { animation-delay: 0.2s; }

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.gradient-text {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Tab Navigation */
.tab-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  background: rgba(15, 23, 42, 0.6);
  padding: 6px;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  backdrop-filter: blur(12px);
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 18px;
  border-radius: 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.25s ease;
}

.tab-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.tab-btn.active {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(129, 140, 248, 0.2));
  color: var(--text-primary);
  border: 1px solid rgba(56, 189, 248, 0.35);
  box-shadow: 0 4px 12px rgba(56, 189, 248, 0.15);
}

.tab-counter {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.25);
  color: var(--accent-primary);
  font-weight: 700;
}

/* Knowledge Inspector Elements */
.badge-live-sync {
  font-size: 0.8rem;
  color: var(--success);
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  padding: 4px 12px;
  border-radius: 999px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.k-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 16px;
}

@media (max-width: 640px) {
  .k-stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.k-stat-box {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 14px;
  text-align: center;
}

.k-stat-val {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--accent-primary);
}

.k-stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 4px;
}

.knowledge-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.k-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 16px 20px;
  transition: all 0.2s ease;
}

.k-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(56, 189, 248, 0.3);
}

.k-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.k-badge {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  border-radius: 999px;
}

.badge-accepted {
  background: rgba(34, 197, 94, 0.15);
  color: var(--success);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.badge-constraint {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.badge-intent {
  background: rgba(129, 140, 248, 0.15);
  color: var(--accent-secondary);
  border: 1px solid rgba(129, 140, 248, 0.3);
}

.k-evidence {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--accent-primary);
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.2);
  padding: 4px 10px;
  border-radius: 6px;
  margin-top: 10px;
}

.k-state-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.k-state-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.95rem;
  color: var(--text-primary);
}

.pulse-indicator {
  color: var(--accent-primary);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}
`
      },
      {
        path: "frontend/src/components/Header.tsx",
        content: `export function Header({ projectName }: { projectName: string }) {
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
`
      },
      {
        path: "frontend/src/components/ServerStatus.tsx",
        content: `export function ServerStatus({ health }: { health: any }) {
  const isOk = health?.status === "ok";
  
  return (
    <div className="glass-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ 
          width: "12px", height: "12px", borderRadius: "50%", 
          background: isOk ? "var(--success)" : "var(--danger)",
          boxShadow: \`0 0 10px \${isOk ? "var(--success)" : "var(--danger)"}\`
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
                    \`\${m.name}\\n\` +
                    (m.dependencies?.length ? \`• Depends on: \${m.dependencies.join(", ")}\\n\` : "") +
                    (m.dependents?.length ? \`• Dependents: \${m.dependents.join(", ")}\` : "• Dependents: none")
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
`
      },
      {
        path: "frontend/src/components/TodoApp.tsx",
        content: `import React, { useState } from 'react';

export function TodoApp({ todos, onAdd, onToggle, loading }: any) {
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onAdd(text);
      setText("");
    }
  };

  return (
    <div className="glass-panel">
      <h2 style={{ fontSize: "1.5rem", marginBottom: "24px", fontWeight: 700 }}>Interactive Demo</h2>
      
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "12px", marginBottom: "32px" }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's your next task?"
          style={{ 
            flex: 1, padding: "14px 20px", borderRadius: "12px", 
            border: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", 
            color: "var(--text-primary)", fontSize: "1rem", outline: "none",
            transition: "all 0.2s ease"
          }}
          onFocus={(e) => e.target.style.borderColor = "var(--accent-primary)"}
          onBlur={(e) => e.target.style.borderColor = "var(--border-color)"}
        />
        <button
          type="submit"
          style={{ 
            padding: "14px 28px", borderRadius: "12px", 
            background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))", 
            color: "#fff", border: "none", fontWeight: 600, fontSize: "1rem", cursor: "pointer",
            transition: "transform 0.2s ease",
            boxShadow: "0 4px 14px rgba(56, 189, 248, 0.4)"
          }}
          onMouseOver={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseOut={(e) => e.currentTarget.style.transform = "translateY(0)"}
        >
          Add
        </button>
      </form>

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--text-secondary)", padding: "20px" }}>Loading tasks...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {todos.map((todo: any) => (
            <div
              key={todo.id}
              onClick={() => onToggle(todo.id)}
              style={{
                display: "flex", alignItems: "center", padding: "16px 20px",
                borderRadius: "12px", background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border-color)", cursor: "pointer",
                transition: "all 0.2s ease",
                transform: "translateY(0)"
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.transform = "translateX(4px)"; }}
              onMouseOut={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.transform = "translateX(0)"; }}
            >
              <div style={{ 
                width: "24px", height: "24px", borderRadius: "50%", 
                border: \`2px solid \${todo.completed ? "var(--success)" : "var(--border-color)"}\`,
                background: todo.completed ? "var(--success)" : "transparent",
                marginRight: "16px", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.2s ease"
              }}>
                {todo.completed && <span style={{ color: "#fff", fontSize: "14px" }}>✓</span>}
              </div>
              <span style={{ 
                fontSize: "1.1rem", 
                color: todo.completed ? "var(--text-secondary)" : "var(--text-primary)",
                textDecoration: todo.completed ? "line-through" : "none",
                transition: "all 0.2s ease"
              }}>
                {todo.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
`
      },
      {
        path: "frontend/src/components/KnowledgeInspector.tsx",
        content: `import React from 'react';

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
`
      },
      {
        path: "frontend/src/App.tsx",
        content: `import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { ServerStatus } from "./components/ServerStatus";
import { TodoApp } from "./components/TodoApp";
import { KnowledgeInspector } from "./components/KnowledgeInspector";

interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: string;
}

interface ModuleInfo {
  name: string;
  description?: string;
  dependencies: string[];
  dependents: string[];
  externalDependencies?: string[];
}

interface HealthData {
  status: string;
  framework: string;
  uptimeSeconds: number;
  timestamp: string;
  modules: string[];
  moduleGraph?: ModuleInfo[];
}

interface KnowledgeData {
  decisions: Array<{ title: string; reason?: string; status?: string }>;
  constraints: Array<{ description: string; reason?: string }>;
  intents: Array<{ entityKind: string; entityName: string; purpose: string; evidence?: { file: string; line?: number } }>;
  developmentState: { completed?: string[]; inProgress?: string[] } | null;
}

export function App() {
  const [activeTab, setActiveTab] = useState<"demo" | "knowledge">("demo");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) setHealth(await res.json());
    } catch (e) {
      console.error("Health check failed", e);
    }
  };

  const fetchKnowledge = async () => {
    try {
      const res = await fetch("/api/knowledge");
      if (res.ok) setKnowledge(await res.json());
    } catch (e) {
      console.error("Knowledge fetch failed", e);
    } finally {
      setKnowledgeLoading(false);
    }
  };

  const fetchTodos = async () => {
    try {
      const res = await fetch("/api/todos");
      if (res.ok) setTodos(await res.json());
    } catch (e) {
      console.error("Failed to load todos", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    fetchKnowledge();
    fetchTodos();
    const interval = setInterval(() => {
      fetchHealth();
      fetchKnowledge();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAdd = async (text: string) => {
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (res.ok) {
      const newTodo = (await res.json()) as Todo;
      setTodos((prev) => [...prev, newTodo]);
    }
  };

  const handleToggle = async (id: number) => {
    const res = await fetch(\`/api/todos/\${id}/toggle\`, { method: "POST" });
    if (res.ok) {
      const updated = (await res.json()) as Todo;
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
    }
  };

  return (
    <>
      <Header projectName="${projectName}" />
      <ServerStatus health={health} />
      
      <div className="tab-bar">
        <button
          id="tab-demo-btn"
          className={\`tab-btn \${activeTab === "demo" ? "active" : ""}\`}
          onClick={() => setActiveTab("demo")}
        >
          <span>📋</span> Interactive Demo
        </button>
        <button
          id="tab-knowledge-btn"
          className={\`tab-btn \${activeTab === "knowledge" ? "active" : ""}\`}
          onClick={() => setActiveTab("knowledge")}
        >
          <span>🧠</span> Nexo Knowledge & Architecture
          {knowledge && (
            <span className="tab-counter">
              {(knowledge.decisions?.length || 0) + (knowledge.intents?.length || 0)}
            </span>
          )}
        </button>
      </div>

      {activeTab === "demo" ? (
        <TodoApp todos={todos} onAdd={handleAdd} onToggle={handleToggle} loading={loading} />
      ) : (
        <KnowledgeInspector knowledge={knowledge} moduleGraph={health?.moduleGraph} loading={knowledgeLoading} />
      )}
    </>
  );
}
`
      }
    ];
  }
};

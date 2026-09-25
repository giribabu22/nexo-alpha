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
              "@nexo-alpha/cli": "^0.5.0",
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
              "@nexo-alpha/core": "^0.5.0",
              "@nexo-alpha/context": "^0.5.0",
              "@nexo-alpha/decision": "^0.5.0",
              "@nexo-alpha/behavior": "^0.5.0",
              "@nexo-alpha/agent": "^0.5.0",
              "@nexo-alpha/web": "^0.5.0",
              "@nexo-alpha/hapi": "^0.5.0",
              "@nexo-alpha/scheduler": "^0.5.0",
              "@nexo-alpha/tools": "^0.5.0",
              "@nexo-alpha/cli": "^0.5.0"
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
              "@nexo-alpha/frontend": "^0.5.0",
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
  plugins: [
    react(),
    {
      name: "route-logger",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && (req.url === "/" || (!req.url.includes(".") && !req.url.startsWith("/@")))) {
            console.log(\`🌐 [vite] \${req.method} \${req.url}\`);
          }
          next();
        });
      }
    }
  ],
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
import "@nexo-alpha/frontend/styles.css";
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
        content: `import { nexoComp } from "@nexo-alpha/frontend";

export const HeaderComp = nexoComp({
  name: "Header",
  purpose: "Application banner with branding",
  render: ({ projectName }: { projectName: string }) => {
    return (
      <header style={{ textAlign: "center", marginBottom: "32px", animation: "slideUp 0.6s both" }}>
        <h1 className="gradient-text" style={{ fontSize: "3rem", fontWeight: 800, margin: "0 0 8px 0", letterSpacing: "-0.02em" }}>
          {projectName}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem", margin: 0 }}>
          Premium Fullstack Architecture powered by Nexo & nexoComp
        </p>
      </header>
    );
  }
});

export const Header = HeaderComp;
`
      },
      {
        path: "frontend/src/components/ServerStatus.tsx",
        content: `import { NexoServerStatus, nexoComp } from "@nexo-alpha/frontend";
import type { NexoHealth } from "@nexo-alpha/frontend";

export const ServerStatusComp = nexoComp({
  name: "ServerStatus",
  purpose: "Live backend health and module connectivity monitor",
  render: ({ health }: { health: NexoHealth | null }) => {
    return <NexoServerStatus health={health} />;
  }
});

export const ServerStatus = ServerStatusComp;
`
      },
      {
        path: "frontend/src/components/TodoApp.tsx",
        content: `import React, { useState } from "react";
import { nexoComp, NexoCard, NexoButton, NexoInput, NexoBadge } from "@nexo-alpha/frontend";

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: string;
}

export const TodoAppComp = nexoComp({
  name: "TodoApp",
  purpose: "Interactive tasks manager with DAG reactive tracking",
  render: ({
    todos,
    onAdd,
    onToggle,
    loading
  }: {
    todos: Todo[];
    onAdd: (text: string) => void;
    onToggle: (id: number) => void;
    loading: boolean;
  }) => {
    const [text, setText] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!text.trim()) return;
      onAdd(text.trim());
      setText("");
    };

    return (
      <NexoCard
        title="Interactive Demo"
        subtitle="Fullstack reactive operations connected to backend todos module"
        badge={<NexoBadge variant="cyan">{todos.length} items</NexoBadge>}
        icon="📋"
        variant="glow"
      >
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
          <NexoInput
            placeholder="What's your next task?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
          />
          <NexoButton type="submit" variant="primary" loading={loading} icon="＋">
            Add
          </NexoButton>
        </form>

        {loading && todos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px", color: "var(--nexo-text-secondary, #94a3b8)" }}>
            Loading tasks...
          </div>
        ) : todos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px", color: "var(--nexo-text-secondary, #94a3b8)", fontStyle: "italic" }}>
            No tasks found. Create one above!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {todos.map((todo) => (
              <div
                key={todo.id}
                onClick={() => onToggle(todo.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderRadius: "10px",
                  background: todo.completed ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.05)",
                  border: \`1px solid \${todo.completed ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.08)"}\`,
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => onToggle(todo.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: "pointer", width: "18px", height: "18px", accentColor: "#38bdf8" }}
                  />
                  <span
                    style={{
                      fontSize: "0.95rem",
                      textDecoration: todo.completed ? "line-through" : "none",
                      color: todo.completed ? "var(--nexo-text-secondary, #94a3b8)" : "var(--nexo-text-primary, #f8fafc)",
                      fontWeight: todo.completed ? 400 : 500
                    }}
                  >
                    {todo.text}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <NexoBadge variant={todo.completed ? "success" : "neutral"} size="sm">
                    {todo.completed ? "Completed" : "In Progress"}
                  </NexoBadge>
                  <span style={{ fontSize: "0.75rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>
                    #{todo.id}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </NexoCard>
    );
  }
});

export const TodoApp = TodoAppComp;
`
      },
      {
        path: "frontend/src/components/KnowledgeInspector.tsx",
        content: `import React from "react";
import { NexoKnowledgeInspector, nexoComp } from "@nexo-alpha/frontend";
import type { NexoKnowledge, NexoModuleInfo } from "@nexo-alpha/frontend";

export interface KnowledgeInspectorProps {
  knowledge: NexoKnowledge | null;
  moduleGraph?: readonly NexoModuleInfo[] | undefined;
  loading?: boolean;
}

export const KnowledgeInspectorComp = nexoComp({
  name: "KnowledgeInspector",
  purpose: "Nexo Knowledge Journal introspection for ADR decisions, constraints, and architecture invariants",
  render: ({ knowledge, moduleGraph, loading }: KnowledgeInspectorProps) => {
    return (
      <NexoKnowledgeInspector
        knowledge={knowledge}
        moduleGraph={moduleGraph}
        loading={loading}
      />
    );
  }
});

export const KnowledgeInspector = KnowledgeInspectorComp;
`
      },
      {
        path: "frontend/src/App.tsx",
        content: `import { useEffect, useState } from "react";
import {
  nexoComp,
  NexoPage,
  NexoBadge,
  NexoMetric,
  createNexoClient,
  type NexoHealth,
  type NexoKnowledge
} from "@nexo-alpha/frontend";
import { Header } from "./components/Header";
import { ServerStatus } from "./components/ServerStatus";
import { TodoApp, type Todo } from "./components/TodoApp";
import { KnowledgeInspector } from "./components/KnowledgeInspector";

const client = createNexoClient({ baseUrl: window.location.origin });

export const AppComp = nexoComp({
  name: "App",
  purpose: "Root page coordinating multiple nexoComps with React in the background",
  render: () => {
    const [activeTab, setActiveTab] = useState<"demo" | "knowledge">("demo");
    const [todos, setTodos] = useState<Todo[]>([]);
    const [health, setHealth] = useState<NexoHealth | null>(null);
    const [knowledge, setKnowledge] = useState<NexoKnowledge | null>(null);
    const [loading, setLoading] = useState(true);
    const [knowledgeLoading, setKnowledgeLoading] = useState(true);

    const fetchHealth = async () => {
      try {
        const data = await client.getHealth();
        setHealth(data);
      } catch (e) {
        console.error("Health check failed", e);
      }
    };

    const fetchKnowledge = async () => {
      try {
        const data = await client.getKnowledge();
        setKnowledge(data);
      } catch (e) {
        console.error("Knowledge fetch failed", e);
      } finally {
        setKnowledgeLoading(false);
      }
    };

    const fetchTodos = async () => {
      try {
        const data = await client.get<Todo[]>("/api/todos");
        setTodos(data);
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
      try {
        const newTodo = await client.post<Todo>("/api/todos", { text });
        setTodos((prev) => [...prev, newTodo]);
      } catch (e) {
        console.error("Failed to add todo", e);
      }
    };

    const handleToggle = async (id: number) => {
      try {
        const updated = await client.post<Todo>(\`/api/todos/\${id}/toggle\`);
        setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      } catch (e) {
        console.error("Failed to toggle todo", e);
      }
    };

    const completedCount = todos.filter((t) => t.completed).length;

    return (
      <NexoPage
        title="${projectName}"
        subtitle="Premium Fullstack Architecture powered by Nexo & nexoComp"
        statusBadge={
          <NexoBadge variant="cyan" pulse>
            Live DSA Optimization
          </NexoBadge>
        }
      >
        <Header projectName="${projectName}" />
        <ServerStatus health={health} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
          <NexoMetric
            label="Active Modules"
            value={health?.moduleGraph?.length ?? health?.modules?.length ?? 0}
            icon="🧩"
            accentColor="#38bdf8"
          />
          <NexoMetric
            label="Completed Tasks"
            value={\`\${completedCount}/\${todos.length}\`}
            icon="✅"
            accentColor="#4ade80"
          />
          <NexoMetric
            label="Architecture Invariants"
            value={(knowledge?.decisions?.length ?? 0) + (knowledge?.constraints?.length ?? 0)}
            icon="🧠"
            accentColor="#c084fc"
          />
          <NexoMetric
            label="Server Uptime"
            value={\`\${health?.uptimeSeconds ?? 0}s\`}
            icon="⏱️"
            accentColor="#fbbf24"
          />
        </div>

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
      </NexoPage>
    );
  }
});

export const App = AppComp;
`
      }
    ];
  }
};

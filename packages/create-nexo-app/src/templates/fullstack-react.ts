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

knowledge.addDecision({
  title: "Fullstack Architecture",
  reason: "Separation of pure Nexo backend business logic and React frontend layer.",
  status: "accepted"
});

// Each module lives in its own folder under src/modules — see that folder
// for the actual app.module({...}) registration and any services it needs.
registerTodosModule(app);
registerSystemModule(app);
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

export function registerSystemModule(app: NexoApplication): void {
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
          modules: app.getModules().map((m) => m.name)
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
`
      },
      {
        path: "frontend/src/components/Header.tsx",
        content: `import React from 'react';

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
`
      },
      {
        path: "frontend/src/components/ServerStatus.tsx",
        content: `import React from 'react';

export function ServerStatus({ health }: { health: any }) {
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
        <div style={{ display: "flex", gap: "16px", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
          <span>Modules: <strong style={{ color: "var(--text-primary)" }}>{health.modules.join(", ")}</strong></span>
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
        path: "frontend/src/App.tsx",
        content: `import React, { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { ServerStatus } from "./components/ServerStatus";
import { TodoApp } from "./components/TodoApp";

export function App() {
  const [todos, setTodos] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) setHealth(await res.json());
    } catch (e) {
      console.error("Health check failed", e);
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
    fetchTodos();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAdd = async (text: string) => {
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (res.ok) setTodos((prev) => [...prev, await res.json()] as any);
  };

  const handleToggle = async (id: number) => {
    const res = await fetch(\`/api/todos/\${id}/toggle\`, { method: "POST" });
    if (res.ok) {
      const updated = await res.json();
      setTodos((prev) => prev.map((t: any) => (t.id === id ? updated : t)) as any);
    }
  };

  return (
    <>
      <Header projectName="${projectName}" />
      <ServerStatus health={health} />
      <TodoApp todos={todos} onAdd={handleAdd} onToggle={handleToggle} loading={loading} />
    </>
  );
}
`
      }
    ];
  }
};

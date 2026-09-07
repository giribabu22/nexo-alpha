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
              "@nexo-alpha/cli": "^0.3.0",
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
              "@nexo-alpha/core": "^0.2.0",
              "@nexo-alpha/context": "^0.3.0",
              "@nexo-alpha/hapi": "^0.2.0",
              "@nexo-alpha/scheduler": "^0.2.0",
              "@nexo-alpha/tools": "^0.3.0",
              "@nexo-alpha/cli": "^0.3.0"
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
    port: PORT
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
        content: `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: #0f172a;
  color: #f8fafc;
  min-height: 100vh;
}
`
      },
      {
        path: "frontend/src/App.tsx",
        content: `import React, { useEffect, useState } from "react";

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

interface HealthData {
  status: string;
  framework: string;
  uptimeSeconds: number;
  modules: string[];
}

export function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch (e) {
      console.error("Backend health check failed", e);
    }
  };

  const fetchTodos = async () => {
    try {
      const res = await fetch("/api/todos");
      if (res.ok) {
        setTodos(await res.json());
      }
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

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newText })
      });
      if (res.ok) {
        const created = await res.json();
        setTodos((prev) => [...prev, created]);
        setNewText("");
      }
    } catch (e) {
      console.error("Error adding todo", e);
    }
  };

  const handleToggle = async (id: number) => {
    try {
      const res = await fetch(\`/api/todos/\${id}/toggle\`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      }
    } catch (e) {
      console.error("Error toggling todo", e);
    }
  };

  return (
    <div style={{ maxWidth: "720px", margin: "40px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: "32px", textAlign: "center" }}>
        <h1 style={{ fontSize: "2.4rem", fontWeight: "800", background: "linear-gradient(135deg, #38bdf8, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          ${projectName}
        </h1>
        <p style={{ color: "#94a3b8", marginTop: "8px" }}>
          Nexo Backend + React Frontend Full-stack Application
        </p>
      </header>

      {/* Backend Status Card */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "16px 20px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: health?.status === "ok" ? "#22c55e" : "#ef4444", marginRight: "8px" }} />
          <strong style={{ color: "#e2e8f0" }}>Backend Status:</strong> {health ? "Connected & Online" : "Connecting..."}
        </div>
        {health && (
          <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
            Modules: <strong>{health.modules.join(", ")}</strong> | Uptime: <strong>{health.uptimeSeconds}s</strong>
          </div>
        )}
      </div>

      {/* Todo Section */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "24px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "16px", color: "#f1f5f9" }}>Tasks & API Demo</h2>

        <form onSubmit={handleAddTodo} style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add a new task..."
            style={{ flex: 1, padding: "10px 14px", borderRadius: "8px", border: "1px solid #475569", background: "#0f172a", color: "#fff", outline: "none" }}
          />
          <button
            type="submit"
            style={{ padding: "10px 20px", borderRadius: "8px", background: "#3b82f6", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}
          >
            Add Task
          </button>
        </form>

        {loading ? (
          <p style={{ color: "#94a3b8" }}>Loading tasks from Nexo API...</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {todos.map((todo) => (
              <li
                key={todo.id}
                onClick={() => handleToggle(todo.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  marginBottom: "8px",
                  background: "#0f172a",
                  cursor: "pointer",
                  border: "1px solid #334155"
                }}
              >
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => {}}
                  style={{ marginRight: "12px", cursor: "pointer" }}
                />
                <span style={{ textDecoration: todo.completed ? "line-through" : "none", color: todo.completed ? "#64748b" : "#f8fafc" }}>
                  {todo.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
`
      }
    ];
  }
};

# @nexo-alpha/frontend

> Official client SDK, typed React hooks, and live architecture introspection UI components for Nexo applications.

## Features

- **DSA-Driven Element Hierarchy**: Directed Acyclic Graph (DAG) component graph (`NexoElementGraph`, `<NexoElement>`) with topological dirty-marking to eliminate unneeded parent-child re-renders.
- **$O(k)$ Radix Trie Router & LRU Cache**: Radix Tree router (`NexoRadixTrie`, `NexoRouter`) with Doubly-Linked-List LRU cache (`NexoLruCache`) for instant $O(1)$ page and route resolution.
- **End-to-End Type-Safe RPC Client**: Proxy-based client (`createNexoRpcClient<TContract>()`) inferring APIs, request payloads, and response models directly from backend contracts.
- **Typed Nexo Client SDK**: Full-featured HTTP client with built-in convenience methods for Nexo endpoints (`/api/health`, `/api/knowledge`, `/api/todos`).
- **Reactive Hooks**:
  - `useNexoHealth`: Real-time backend status, uptime, and active module list with polling support.
  - `useNexoKnowledge`: Live introspection of Architectural Decisions (ADRs), System Invariants, Component Intents, and Development State.
  - `useNexoModuleGraph`: Live view of internal module dependencies, downstream dependents, and external npm packages.
  - `useNexoApi`: Generic declarative data-fetching and mutation hook.
  - `useNexoRpcQuery` & `useNexoRpcMutation`: Fully typed React hooks for RPC queries and mutations.
  - `useNexoRoute`, `useNexoParams`, `useNexoNavigate`: Router hooks.
- **Glassmorphic UI Components**:
  - `<NexoServerStatus />`: Real-time status indicator, uptime clock, and module chips with dependent counts.
  - `<NexoKnowledgeInspector />`: Interactive dashboard showing decisions, invariants, component intents, and module dependency graph.
  - `<NexoModuleGraph />`: Direct visualization of upstream dependencies and downstream dependents.
  - `<NexoRouterProvider>`, `<NexoRoutes>`, `<NexoRoute>`, `<NexoLink>`: High-speed page navigation.

## Installation

```bash
npm install @nexo-alpha/frontend
# or
pnpm add @nexo-alpha/frontend
```

## Quick Start (React)

### 1. Setup Provider

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { NexoProvider } from "@nexo-alpha/frontend";
import "@nexo-alpha/frontend/styles.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NexoProvider baseUrl="">
      <App />
    </NexoProvider>
  </React.StrictMode>
);
```

### 2. Use Hooks and Components

```tsx
import { 
  NexoServerStatus, 
  NexoKnowledgeInspector, 
  useNexoHealth,
  useNexoKnowledge 
} from "@nexo-alpha/frontend";

export function App() {
  const { health, isConnected } = useNexoHealth({ pollInterval: 5000 });
  const { knowledge, loading } = useNexoKnowledge();

  return (
    <div className="container">
      {/* Real-time server and module dependency status */}
      <NexoServerStatus health={health} />

      {/* Live Architectural Decision & Module Graph Inspector */}
      <NexoKnowledgeInspector knowledge={knowledge} loading={loading} />
    </div>
  );
}
```

## Vanilla JavaScript / TypeScript (Non-React)

You can use the standalone typed client without React:

```typescript
import { createNexoClient } from "@nexo-alpha/frontend";

const client = createNexoClient({ baseUrl: "http://localhost:3000" });

// Fetch health and module dependency graph
const health = await client.getHealth();
console.log("Modules:", health.modules);
console.log("Module Graph (dependencies & dependents):", health.moduleGraph);

// Fetch architecture journal
const knowledge = await client.getKnowledge();
console.log("ADRs:", knowledge.decisions);

// Perform arbitrary API calls
const orders = await client.get("/api/orders");
const newOrder = await client.post("/api/orders", { item: "Laptop", amount: 1200 });
```

## End-to-End Type-Safe RPC (tRPC / Eden Style)

Nexo supports full end-to-end type safety between backend modules and frontend code without manual fetch calls or route string guessing.

### 1. Define Backend Contract (Shared / Backend)

```typescript
// backend/src/contract.ts (or a shared workspace package)
import type { NexoHealth, NexoKnowledge } from "@nexo-alpha/frontend";

export interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
}

export interface AppContract {
  todos: {
    getTodos: { output: TodoItem[] };
    addTodo: { input: { text: string }; output: TodoItem };
    toggleTodo: { input: { id: number }; output: TodoItem };
  };
  system: {
    getHealth: { output: NexoHealth };
    getKnowledge: { output: NexoKnowledge };
  };
}
```

### 2. Create the Typed RPC Client

```typescript
// frontend/src/rpc.ts
import { createNexoRpcClient } from "@nexo-alpha/frontend";
import type { AppContract } from "../../backend/src/contract.js";

export const rpc = createNexoRpcClient<AppContract>({
  routes: {
    "todos.getTodos": { method: "GET", path: "/api/todos" },
    "todos.addTodo": { method: "POST", path: "/api/todos" },
    "todos.toggleTodo": { method: "POST", path: "/api/todos/{id}/toggle" },
    "system.getHealth": { method: "GET", path: "/api/health" },
    "system.getKnowledge": { method: "GET", path: "/api/knowledge" }
  }
});
```

### 3. Consume with Full Autocompletion and Type Safety

```typescript
// 1. Direct callable syntax:
const todos: TodoItem[] = await rpc.todos.getTodos();
const newTodo: TodoItem = await rpc.todos.addTodo({ text: "Write documentation" });
const toggled: TodoItem = await rpc.todos.toggleTodo({ id: 1 });

// 2. Query / Mutate syntax:
const health = await rpc.system.getHealth.query();
await rpc.todos.addTodo.mutate({ text: "Deploy to production" });
```

### 4. React RPC Hooks

```tsx
import { useNexoRpcQuery, useNexoRpcMutation } from "@nexo-alpha/frontend";
import { rpc } from "./rpc";

export function TodoList() {
  const { data: todos, loading, refetch } = useNexoRpcQuery(() => rpc.todos.getTodos());
  const { mutate: addTodo, loading: adding } = useNexoRpcMutation((text: string) => 
    rpc.todos.addTodo({ text })
  );

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={async () => { await addTodo("New Task"); refetch(); }}>
        Add Task
      </button>
      <ul>
        {todos?.map(t => <li key={t.id}>{t.text}</li>)}
      </ul>
    </div>
  );
}
```

## DSA-Powered Frontend Routing & Component Graph

### 1. $O(k)$ Radix Trie Page Routing

```tsx
import { 
  NexoRouterProvider, 
  NexoRoutes, 
  NexoRoute, 
  NexoLink, 
  useNexoParams 
} from "@nexo-alpha/frontend";

function TodoDetail() {
  const { id } = useNexoParams();
  return <h2>Viewing Todo #{id}</h2>;
}

export function AppRouter() {
  return (
    <NexoRouterProvider>
      <nav>
        <NexoLink to="/">Dashboard</NexoLink>
        <NexoLink to="/todos">Todos</NexoLink>
        <NexoLink to="/todos/42">Task #42</NexoLink>
      </nav>

      <NexoRoutes>
        <NexoRoute path="/" element={<Dashboard />} />
        <NexoRoute path="/todos" element={<TodoList />} />
        <NexoRoute path="/todos/:id" element={<TodoDetail />} />
      </NexoRoutes>
    </NexoRouterProvider>
  );
}
```

### 2. DAG Component Graph for Optimized Parent-Child Rendering

```tsx
import { NexoElementRoot, NexoElement } from "@nexo-alpha/frontend";

export function OptimizedDashboard({ user, stats }) {
  return (
    <NexoElementRoot>
      {/* Root node */}
      <NexoElement id="dashboard-root">
        {/* Child node: only re-renders when `user` changes */}
        <NexoElement id="user-header" data={user}>
          <UserHeader user={user} />
        </NexoElement>

        {/* Sibling node: untainted when `user` changes, avoids cascading re-renders! */}
        <NexoElement id="stats-panel" data={stats}>
          <StatsPanel stats={stats} />
        </NexoElement>
      </NexoElement>
    </NexoElementRoot>
  );
}
```

## License

MIT © prem1999


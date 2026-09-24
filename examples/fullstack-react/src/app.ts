import { createApplication, installDscPlugin } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";
import {
  createDscOrchestrator,
  createDscInterceptor,
  createDscCollector
} from "@nexo-alpha/behavior";
import { createDscJobScheduler } from "@nexo-alpha/scheduler";

export const app = createApplication({
  name: "fullstack-react-backend",
  version: "0.2.0",
  description: "Nexo Fullstack React & DSC Optimized Backend"
});

// Initialize DSC telemetry and execution engine
export const dscCollector = createDscCollector();
export const dscOrchestrator = createDscOrchestrator(dscCollector);
export const dscInterceptor = createDscInterceptor(dscCollector);

installDscPlugin(app, {
  orchestrator: dscOrchestrator,
  interceptor: dscInterceptor,
  collector: dscCollector
});

// Initialize Knowledge Context
export const knowledge = createKnowledge();

knowledge.addDecision({
  title: "Fullstack Architecture with DSC",
  reason: "Separation of pure Nexo backend business logic and React frontend layer powered by Deterministic State & Computation.",
  status: "accepted"
});

knowledge.addDecision({
  title: "NexoComp UI Abstraction",
  reason: "Components are declared as nexoComp with DAG dirty tracking and LRU memoization while React runs rendering in the background.",
  status: "accepted"
});

export interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  category: string;
}

export const todos: TodoItem[] = [
  { id: 1, text: "Explore Nexo Core Architecture", completed: true, priority: "high", category: "core" },
  { id: 2, text: "Connect React Frontend to Nexo Backend via nexoComp", completed: true, priority: "high", category: "frontend" },
  { id: 3, text: "Execute Deterministic State Pipelines with DSC", completed: false, priority: "medium", category: "performance" },
  { id: 4, text: "Schedule Autonomous Background Monitoring", completed: false, priority: "low", category: "agent" }
];

// Todo Management Module (with DSC idempotent caching)
app.module({
  name: "todos",
  description: "Todo and Task management module with DSC execution",

  apis: [
    {
      name: "getTodos",
      method: "GET",
      path: "/api/todos",
      description: "List all todos",
      handler: async () => {
        return dscOrchestrator.run(
          {
            name: "fetch-all-todos",
            idempotent: true,
            ttlMs: 5000,
            execute: async () => todos
          },
          { count: todos.length }
        );
      }
    },
    {
      name: "addTodo",
      method: "POST",
      path: "/api/todos",
      description: "Create a new todo",
      handler: async (request: any) => {
        const payload = (request.payload || {}) as { text?: string; priority?: "low" | "medium" | "high"; category?: string };
        const text = payload.text?.trim() || "New Task";
        const newTodo: TodoItem = {
          id: Date.now(),
          text,
          completed: false,
          priority: payload.priority || "medium",
          category: payload.category || "general"
        };
        todos.push(newTodo);
        dscOrchestrator.clearCache();
        return newTodo;
      }
    },
    {
      name: "toggleTodo",
      method: "POST",
      path: "/api/todos/{id}/toggle",
      description: "Toggle todo completion status",
      handler: async (request: any) => {
        const id = Number(request.params?.id);
        const item = todos.find((t) => t.id === id);
        if (item) {
          item.completed = !item.completed;
          dscOrchestrator.clearCache();
          return item;
        }
        return { error: "Todo not found" };
      }
    }
  ],

  jobs: [
    {
      name: "health-monitor",
      schedule: "*/5 * * * *",
      description: "Periodic health and state check",
      run: async () => {
        const metrics = dscCollector.getMetrics();
        return { checkedAt: new Date().toISOString(), operationsTracked: metrics.totalOperations };
      }
    }
  ]
});

// System & DSC Telemetry Module
app.module({
  name: "system",
  description: "System health and DSC runtime telemetry",

  apis: [
    {
      name: "getHealth",
      method: "GET",
      path: "/api/health",
      description: "Return system and Nexo health status",
      handler: async () => ({
        status: "ok",
        framework: "Nexo",
        version: app.version,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        modules: app.getModules().map((m: { name: string }) => m.name),
        dscMetrics: dscCollector.getMetrics()
      })
    },
    {
      name: "getDscMetrics",
      method: "GET",
      path: "/api/dsc/metrics",
      description: "Return high-resolution DSC execution statistics",
      handler: async () => {
        return dscCollector.getMetrics();
      }
    }
  ]
});

// Background Scheduler Task for Periodic Maintenance
export const scheduler = createDscJobScheduler(app, {
  orchestrator: dscOrchestrator
});

import {
  createApplication,
  installDscPlugin,
  createInMemoryDocumentStore,
  createProjectRegistry,
  createProjectApiModule,
  httpResponse
} from "@nexo-alpha/core";
import { renderStudioHtml } from "./render-studio.js";
import { createKnowledge } from "@nexo-alpha/context";
import {
  createDscOrchestrator,
  createDscInterceptor,
  createDscCollector
} from "@nexo-alpha/behavior";
import { createDscJobScheduler, createJobQueue } from "@nexo-alpha/scheduler";
import {
  createAgent,
  createWorkflow,
  createWorkflowApiModule,
  createInMemoryAgentMemory,
  createMemoryApiModule,
  createInMemoryWorkflowStore,
  type IntentParser
} from "@nexo-alpha/agent";
import { createDecisionEngine, permissionRule } from "@nexo-alpha/decision";
import { createMetricsCollector, createMetricsApiModule } from "@nexo-alpha/tools";

export const app = createApplication({
  name: "fullstack-react-backend",
  version: "0.6.0",
  description: "Nexo Fullstack React, AI Workflow & DSC Optimized Studio Backend"
});

// ---------------------------------------------------------------------------
// 1. DSC Telemetry & Execution Pipeline
// ---------------------------------------------------------------------------
export const dscCollector = createDscCollector();
export const dscOrchestrator = createDscOrchestrator(dscCollector);
export const dscInterceptor = createDscInterceptor(dscCollector);

installDscPlugin(app, {
  orchestrator: dscOrchestrator,
  interceptor: dscInterceptor,
  collector: dscCollector
});

// ---------------------------------------------------------------------------
// 2. Knowledge Context & Journal
// ---------------------------------------------------------------------------
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

knowledge.addDecision({
  title: "Deterministic AI Safety Boundary",
  reason: "All agent workflow steps are validated by the Decision Engine before execution, preventing unconstrained actions.",
  status: "accepted"
});

knowledge.addConstraint({
  description: "All state mutations must invalidate DSC orchestrator cache to prevent stale reads.",
  reason: "Data consistency across HTTP endpoints"
});

knowledge.addConstraint({
  description: "Workflow tools must be declared in ToolRegistry with permission rules in DecisionEngine.",
  reason: "Security and auditable operations"
});

// ---------------------------------------------------------------------------
// 3. Multi-Tenant Project Registry
// ---------------------------------------------------------------------------
export const documentStore = createInMemoryDocumentStore();
export const projectRegistry = createProjectRegistry(documentStore);

// Pre-seed demo workspace tenants
await projectRegistry.create({ id: "default", name: "Default Studio Workspace", owner: "admin" });
await projectRegistry.create({ id: "production-ops", name: "Production Operations", owner: "admin" });

// ---------------------------------------------------------------------------
// 4. Cross-Run Agent Memory
// ---------------------------------------------------------------------------
export const memory = createInMemoryAgentMemory();

await memory.remember(
  "task-triage-policy",
  {
    policy: "Always resolve high priority tasks before general backlog items",
    activeRules: 3,
    updatedBy: "studio-admin"
  },
  { tags: ["policy", "tasks"], scope: "default" }
);

await memory.remember(
  "dsc-cache-optimization",
  {
    ttlMs: 5000,
    targetHitRate: 0.85,
    strategy: "Idempotent DAG deduplication"
  },
  { tags: ["dsc", "optimization"], scope: "default" }
);

// ---------------------------------------------------------------------------
// 5. Todo State & Management
// ---------------------------------------------------------------------------
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
  { id: 3, text: "Execute Deterministic State Pipelines with DSC", completed: true, priority: "medium", category: "performance" },
  { id: 4, text: "Schedule Autonomous Background Monitoring", completed: false, priority: "low", category: "agent" },
  { id: 5, text: "Orchestrate Multi-Step AI Agent Workflows", completed: false, priority: "high", category: "agent" }
];

// Todo Management Module
app.module({
  name: "todos",
  description: "Todo and task management module with DSC execution",
  apis: [
    {
      name: "getTodos",
      method: "GET",
      path: "/api/todos",
      description: "List all todos with DSC caching",
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
  ]
});

// ---------------------------------------------------------------------------
// 6. AI Agent, Tools, Decision Engine & Workflows
// ---------------------------------------------------------------------------
export const decisionEngine = createDecisionEngine({ name: "studio-safety" });
decisionEngine.addRule(
  permissionRule({
    name: "safe-task-actions",
    actions: ["audit_tasks", "triage_priority", "record_insight"],
    check: () => true,
    message: "Action approved by studio-safety decision policy."
  })
);

export const agent = createAgent({
  name: "task-optimizer-agent",
  decisionEngine
});

agent.tools.register({
  action: "audit_tasks",
  description: "Audits current todo items and calculates completion metrics",
  execute: async () => {
    const total = todos.length;
    const completed = todos.filter((t) => t.completed).length;
    const pending = total - completed;
    const highPriority = todos.filter((t) => !t.completed && t.priority === "high").length;
    return {
      success: true,
      durationMs: 4,
      data: {
        total,
        completed,
        pending,
        highPriority,
        recommendation: highPriority > 0 ? "Focus on high-priority tasks first" : "All critical tasks handled"
      }
    };
  }
});

agent.tools.register({
  action: "triage_priority",
  description: "Triages pending tasks and assigns dynamic urgency scores",
  execute: async () => {
    const scored = todos.map((t) => ({
      id: t.id,
      text: t.text,
      score: t.priority === "high" ? 95 : t.priority === "medium" ? 60 : 25
    }));
    return {
      success: true,
      durationMs: 3,
      data: {
        triagedCount: scored.length,
        topPriority: scored.sort((a, b) => b.score - a.score)[0]
      }
    };
  }
});

agent.tools.register({
  action: "record_insight",
  description: "Records task triage and system optimization insight to agent memory",
  execute: async ({ intent }) => {
    const goalText = String(intent.payload?.goal ?? "Tasks triaged successfully.");
    const entry = await memory.remember(
      `optimization-${Date.now()}`,
      {
        goal: goalText,
        timestamp: new Date().toISOString(),
        tasksCount: todos.length,
        status: "completed"
      },
      { tags: ["workflow", "optimization"], scope: "default" }
    );
    return {
      success: true,
      durationMs: 6,
      data: { recorded: true, entryKey: entry.key }
    };
  }
});

export const workflowStore = createInMemoryWorkflowStore();

const taskOptimizerParser: IntentParser = {
  async parse(goal, options) {
    const state = options?.workflowState as { step?: number } | undefined;
    const step = state?.step ?? 1;
    if (step === 1) return { action: "audit_tasks", actor: "studio-agent" };
    if (step === 2) return { action: "triage_priority", actor: "studio-agent" };
    if (step === 3) return { action: "record_insight", actor: "studio-agent", payload: { goal } };
    return { action: "complete", payload: { message: "Task optimization completed successfully." } };
  }
};

// ---------------------------------------------------------------------------
// 7. Runtime Observability & Metrics Collector
// ---------------------------------------------------------------------------
export const metricsCollector = createMetricsCollector(app);

export const taskOptimizerWorkflow = createWorkflow({
  name: "task-optimizer",
  agent,
  store: workflowStore,
  allowedActions: ["audit_tasks", "triage_priority", "record_insight"],
  parser: taskOptimizerParser,
  onEvent: (e) => {
    metricsCollector.workflowListener(e);
  }
});

// ---------------------------------------------------------------------------
// 8. Background Job Queue & Schedulers
// ---------------------------------------------------------------------------
export const jobQueue = createJobQueue({
  store: createInMemoryDocumentStore(),
  pollIntervalMs: 50,
  onEvent: (e) => {
    metricsCollector.queueListener(e);
  }
});

// ---------------------------------------------------------------------------
// 9. Register Framework Extension Modules
// ---------------------------------------------------------------------------

// Workflows HTTP API (/workflows)
app.module(
  createWorkflowApiModule({
    workflows: [taskOptimizerWorkflow],
    queue: jobQueue,
    resolveActor: (ctx) => ctx.headers["x-user"] ?? "studio-user"
  })
);

// Agent Memory HTTP API (/memory)
app.module(
  createMemoryApiModule({
    memory
  })
);

// Metrics HTTP API (/metrics & /metrics/prometheus)
app.module(
  createMetricsApiModule(metricsCollector)
);

// Projects HTTP API (/projects)
app.module(
  createProjectApiModule({
    registry: projectRegistry,
    resolveUser: (ctx) => ctx.headers["x-user"] ?? "admin"
  })
);

// Architectural Knowledge API (/api/knowledge)
app.module({
  name: "knowledge",
  description: "Application context and architectural knowledge manifest",
  apis: [
    {
      name: "getKnowledge",
      method: "GET",
      path: "/api/knowledge",
      description: "Exposes ADR decisions, constraints, development state, and component intents",
      handler: async () => ({
        decisions: knowledge.getDecisions(),
        constraints: knowledge.getConstraints(),
        intents: [
          {
            entityKind: "module",
            entityName: "todos",
            purpose: "Deterministic task management with DSC caching",
            evidence: { file: "src/app.ts", line: 60 }
          },
          {
            entityKind: "workflow",
            entityName: "task-optimizer",
            purpose: "Autonomous triage, priority scoring, and memory recording",
            evidence: { file: "src/app.ts", line: 150 }
          },
          {
            entityKind: "component",
            entityName: "NexoStudio",
            purpose: "Interactive fullstack studio dashboard uniting workflows, memory, metrics, and knowledge",
            evidence: { file: "src/components/NexoStudio.tsx", line: 1 }
          }
        ],
        developmentState: {
          completed: [
            "Core application model",
            "DSC execution pipeline",
            "Fullstack React Studio UI",
            "Multi-tenant Project Registry",
            "Agent Memory and Workflow Engine"
          ],
          inProgress: [
            "Real-time event streaming",
            "Model Context Protocol (MCP) Server"
          ]
        }
      })
    }
  ]
});

// System & Telemetry Module (/api/health)
app.module({
  name: "system",
  description: "System health and DSC runtime telemetry",
  apis: [
    {
      name: "getHealth",
      method: "GET",
      path: "/api/health",
      description: "Return system and Nexo health status",
      handler: async () => {
        const allModules = app.getModules();
        return {
          status: "ok",
          framework: "Nexo",
          version: app.version,
          uptimeSeconds: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
          modules: allModules.map((m: { name: string }) => m.name),
          moduleGraph: allModules.map((m: any) => ({
            name: m.name,
            description: m.description,
            dependencies: m.dependencies ?? [],
            dependents: app.getDependents(m.name)
          })),
          dscMetrics: dscCollector.getMetrics()
        };
      }
    },
    {
      name: "getDscMetrics",
      method: "GET",
      path: "/api/dsc/metrics",
      description: "Return high-resolution DSC execution statistics",
      handler: async () => dscCollector.getMetrics()
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

// Fullstack Studio UI Module (/ and /studio)
app.module({
  name: "studio",
  description: "Interactive visual Studio UI serving dashboard tabs over HTTP",
  apis: [
    {
      name: "getStudio",
      method: "GET",
      path: "/studio",
      description: "Renders the interactive Nexo Studio HTML UI",
      handler: async () => {
        const html = renderStudioHtml("");
        return httpResponse(200, html, { "content-type": "text/html; charset=utf-8" });
      }
    },
    {
      name: "getStudioRoot",
      method: "GET",
      path: "/",
      description: "Renders the interactive Nexo Studio HTML UI on root",
      handler: async () => {
        const html = renderStudioHtml("");
        return httpResponse(200, html, { "content-type": "text/html; charset=utf-8" });
      }
    }
  ]
});

// Background Scheduler Task
export const scheduler = createDscJobScheduler(app, {
  orchestrator: dscOrchestrator
});

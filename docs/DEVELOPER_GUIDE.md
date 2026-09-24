# Nexo Developer Handbook & Guide

Welcome to **Nexo** — the lightweight, modular application framework built for modern TypeScript engineering and AI-driven software development.

---

## Table of Contents
1. [Core Concepts](#1-core-concepts)
2. [Quick Start & Scaffolding](#2-quick-start--scaffolding)
3. [Building APIs & Routing (Hapi.js)](#3-building-apis--routing-hapijs)
4. [Services & State Management](#4-services--state-management)
5. [Scheduling Background Jobs](#5-scheduling-background-jobs)
6. [Architectural Knowledge & Manifests](#6-architectural-knowledge--manifests)
7. [Deterministic AI Decision Engine](#7-deterministic-ai-decision-engine)
8. [AI Agents & Autonomous Workflows](#8-ai-agents--autonomous-workflows)
9. [Bounded Behaviors & Micro-Decisions](#9-bounded-behaviors--micro-decisions)
10. [Web Research & Grounded Evidence](#10-web-research--grounded-evidence)
11. [AI-Era Tooling & Introspection](#11-ai-era-tooling--introspection)
12. [Production Deployment & Docker](#12-production-deployment--docker)

---

## 1. Core Concepts

Nexo organizes applications into clean, decoupled layers:

- **`NexoApplication`**: Root application container managing lifecycle (`start()`, `stop()`), registered modules, and the event bus.
- **`NexoModule`**: Domain-driven feature boundaries (e.g. `users`, `billing`, `orders`).
- **`NexoService`**: Encapsulates stateful logic, database connections (Prisma, Drizzle, MongoDB), and business rules.
- **`NexoApi`**: Declarative HTTP endpoint definitions (`GET`, `POST`, `PUT`, `DELETE`) with auth, validation, and route handlers.
- **`NexoJob`**: Declarative background cron jobs managed by `@nexo-alpha/scheduler`.
- **`Knowledge`**: Captures architectural decisions (`Decisions`), constraints (`Constraints`), and entity intents directly in the codebase.
- **`DecisionEngine`**: Deterministic rule evaluation chain (`APPROVE`, `REJECT`, `ASK_USER`, `ESCALATE`, `DEFER`) keeping AI actions safe.

---

## 2. Quick Start & Scaffolding

### Create a New Project

Use `create-nexo-app` to scaffold a project:

```bash
# Fullstack with React + Vite frontend and Nexo backend (Default)
npx create-nexo-app my-app --template fullstack-react

# Or standalone modular backend service
npx create-nexo-app my-service --template backend-api

# Minimal single-file setup
npx create-nexo-app quick-start --template minimal
```

### Project Structure (Backend API)

```text
my-service/
├── src/
│   ├── modules/
│   │   ├── orders/
│   │   │   ├── index.ts      # Module registration & API definitions
│   │   │   └── service.ts    # Business logic & database operations
│   │   └── health/
│   │       └── index.ts
│   ├── app.ts                # Application & Knowledge initialization
│   └── index.ts              # Starts Hapi server & job scheduler
├── nexo.config.json          # CLI configuration
├── package.json
└── tsconfig.json
```

---

## 3. Building APIs & Routing (Hapi.js)

Define APIs declaratively on any module:

```typescript
import { createApplication } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";

export const app = createApplication({
  name: "order-service",
  version: "1.0.0"
});

app.module({
  name: "orders",
  purpose: "Customer orders module",
  apis: [
    {
      name: "getOrder",
      method: "GET",
      path: "/orders/:id",
      handler: async (ctx) => {
        const orderId = ctx.params.id;
        return { orderId, status: "completed", total: 49.99 };
      }
    },
    {
      name: "createOrder",
      method: "POST",
      path: "/orders",
      auth: { required: true, scopes: ["orders:write"] },
      validate: (ctx) => {
        const payload = ctx.payload as { item?: string; qty?: number };
        if (!payload?.item || typeof payload.qty !== "number") {
          return { valid: false, errors: ["'item' and numeric 'qty' are required."] };
        }
        return { valid: true };
      },
      handler: async (ctx) => {
        const payload = ctx.payload as { item: string; qty: number };
        return { id: Date.now(), item: payload.item, qty: payload.qty, status: "created" };
      }
    }
  ]
});

// Start HTTP server
const server = await startHapiServer(app, {
  port: 4000,
  authenticate: async (ctx) => {
    const token = ctx.headers.authorization;
    return token ? { authenticated: true, scopes: ["orders:write"] } : { authenticated: false };
  }
});
```

---

## 4. Services & State Management

Encapsulate database connections (Prisma, Drizzle, Mongo) and state inside `NexoService` subclasses:

```typescript
import { NexoService } from "@nexo-alpha/core";

export class DatabaseService extends NexoService {
  constructor() {
    super({ name: "database-service" });
  }

  async onStart() {
    console.log("Connecting to Database...");
  }

  async onStop() {
    console.log("Disconnecting from Database...");
  }

  async findOrder(id: string) {
    return { id, total: 49.99, status: "completed" };
  }
}

export const dbService = new DatabaseService();

app.module({
  name: "orders",
  services: [dbService]
});
```

---

## 5. Scheduling Background Jobs

Use `@nexo-alpha/scheduler` for cron-based recurring tasks:

```typescript
import { startJobScheduler } from "@nexo-alpha/scheduler";

app.module({
  name: "analytics",
  jobs: [
    {
      name: "dailyRollup",
      schedule: "0 0 * * *", // Midnight daily
      run: async () => {
        console.log("Running daily metrics calculation...");
      }
    }
  ]
});

// Start scheduler
const scheduler = startJobScheduler(app);

// Stop on process termination
process.on("SIGTERM", () => scheduler.stop());
```

---

## 6. Architectural Knowledge & Manifests

Record *why* design decisions were made so human teammates and AI agents understand the codebase context:

```typescript
import { createKnowledge, buildContext, contextToJson } from "@nexo-alpha/context";

export const knowledge = createKnowledge();

knowledge.addDecision({
  title: "Use Redis for Session Caching",
  reason: "Required sub-millisecond session validation under heavy read traffic.",
  status: "accepted"
});

knowledge.addConstraint({
  description: "All monetary values must be stored as integer cents.",
  reason: "Eliminates IEEE 754 floating point precision errors."
});

knowledge.setDevelopmentState({
  currentObjective: "Integrate Stripe webhooks",
  completed: ["Order API", "Cart Service"],
  inProgress: ["Webhook validation"]
});

// Build unified manifest
const manifest = buildContext(app, { knowledge });
console.log(contextToJson(manifest));
```

---

## 7. Deterministic AI Decision Engine

Prevent unauthorized actions and hallucinations by enforcing deterministic safety rules before any tool executes:

```typescript
import { createDecisionEngine, permissionRule, stateRule } from "@nexo-alpha/decision";

export const decisionEngine = createDecisionEngine({ name: "order-rules" });

decisionEngine
  .addRule(permissionRule({
    name: "owner-only",
    actions: ["cancel_order"],
    check: ({ intent }) => intent.actor === intent.payload?.ownerId,
    message: "You can only cancel your own orders."
  }))
  .addRule(stateRule({
    name: "cancellable-state",
    actions: ["cancel_order"],
    allowedStates: ["pending", "processing"],
    resolveState: async ({ intent }) => {
      const order = await dbService.findOrder(intent.target!);
      return order?.status;
    }
  }));
```

---

## 8. AI Agents & Autonomous Workflows

Wire the 5-layer intelligence stack (`UNDERSTAND → KNOW → DECIDE → ACT → VERIFY`) and run multi-step workflows:

```typescript
import { createAgent, createWorkflow } from "@nexo-alpha/agent";
import { decisionEngine } from "./decision.js";
import { knowledge } from "./knowledge.js";

export const agent = createAgent({
  name: "support-agent",
  decisionEngine,
  knowledge
});

// Register actionable tools
agent.tools.register({
  name: "cancel_order",
  description: "Cancels an order",
  execute: async ({ intent }) => {
    return { cancelled: true, orderId: intent.target };
  }
});

// Register post-execution verifiers
agent.verifiers.register({
  action: "cancel_order",
  verify: async ({ toolResult }) => {
    return { status: "PASS", message: "Cancellation verified." };
  }
});

// Create autonomous multi-step workflow
const workflow = createWorkflow({
  name: "support-flow",
  agent,
  maxSteps: 5,
  allowedActions: ["cancel_order"]
});

const outcome = await workflow.run({
  goal: "Cancel order ord_999 for user_123",
  initialContext: { orderId: "ord_999", userId: "user_123" }
});
```

---

## 9. Bounded Behaviors & Micro-Decisions

Eliminate expensive open-ended LLM calls by replacing them with constrained atomic primitives (`choice`, `score`, `boolean`) and policies:

```typescript
import { BehaviorEngine, choice } from "@nexo-alpha/behavior";

const behavior = new BehaviorEngine();

// Select optimal candidate branch with minimal tokens & latency
const route = await behavior.routePolicy({
  candidates: ["support_queue", "finance_queue", "fraud_review"],
  state: { amount: 1500, riskScore: 0.1 }
});

console.log("Selected route:", route.selected);
```

---

## 10. Web Research & Grounded Evidence

Equip agents with grounded, verified evidence from the web before making decisions:

```typescript
import { research } from "@nexo-alpha/web";

const researchResult = await research({
  query: "TypeScript 5.6 release highlights",
  maxSources: 5,
  knowledge
});

console.log("Verified sources:", researchResult.totalVerified);
```

---

## 11. AI-Era Tooling & Introspection

Use the Nexo CLI (`@nexo-alpha/cli`) to inspect applications, trace impacts, and generate knowledge graphs:

```bash
# High-level architecture inspection
npx nexo inspect

# Check active development roadmap
npx nexo status

# Validate architecture (detect cycles, missing dependencies)
npx nexo validate

# Generate unified architecture and source code knowledge graph
npx nexo graph --source-root src

# Calculate transitive blast radius of modifying a module or function
npx nexo impact "module:orders"

# Check which source files have changed since the graph was generated
npx nexo freshness --source-root src
```

---

## 12. Production Deployment & Docker

Every generated Nexo application includes a production-ready `Dockerfile`:

```bash
# Build the container image
docker build -t my-nexo-app .

# Run the container
docker run -p 4000:4000 -e NODE_ENV=production my-nexo-app
```

---

## License

MIT © Nexo Contributors

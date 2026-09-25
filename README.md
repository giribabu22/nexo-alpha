# Nexo

> A lightweight, modular application framework and runtime for the AI era.

Nexo bridges the gap between software development and AI intelligence. It provides a pure, dependency-free application model for your code and surrounds it with structured context, deterministic decision boundaries, bounded behaviors, autonomous workflows, and deep introspection tooling.

```
       ┌────────────────────────────────────────────────────────┐
       │                       AI WORLD                         │
       │     LLM / Intent Parser proposes an action / workflow   │
       └───────────────────────────┬────────────────────────────┘
                                   │  DecisionIntent
       ┌───────────────────────────▼────────────────────────────┐
       │                   CONTROLLED WORLD                     │
       │  Decision Engine evaluates deterministic safety rules  │
       │  APPROVE │ REJECT │ ASK_USER │ ESCALATE │ DEFER        │
       └───────────────────────────┬────────────────────────────┘
                                   │  (Only if APPROVED)
       ┌───────────────────────────▼────────────────────────────┐
       │               NEXO APPLICATION RUNTIME                 │
       │  Modules ──► Services ──► APIs (Hapi) ──► Jobs (Cron)  │
       │  Knowledge Context ──► Audit Trails ──► Verifications  │
       └────────────────────────────────────────────────────────┘
```

---

## Quick Start: Scaffold in Seconds

The fastest way to start a new Nexo project is using `create-nexo-app`:

```bash
# Fullstack React (Vite) + Nexo backend (Default)
npx create-nexo-app my-app

# Standalone modular backend API service
npx create-nexo-app my-service --template backend-api

# Minimal single-file setup
npx create-nexo-app quick-start --template minimal
```

Then cd into your project, install dependencies, and run:

```bash
cd my-app
npm install
npm run dev
```

---

## Monorepo Packages

Nexo is built as a set of modular, composable packages published under the `@nexo-alpha` scope on npm:

| Package | npm | Description |
|---|---|---|
| [`@nexo-alpha/core`](./packages/core/README.md) | `0.4.1` | Core runtime: applications, modules, services, declarative APIs, jobs, lifecycle, and event bus. |
| [`@nexo-alpha/context`](./packages/context/README.md) | `0.4.1` | Application context manifest, knowledge journal (decisions, constraints, state, intents), and structure hashing. |
| [`@nexo-alpha/decision`](./packages/decision/README.md) | `0.4.1` | Deterministic AI decision engine. Rule chains (`permission`, `state`, `constraint`, `confirmation`, `escalation`, `rateLimit`). |
| [`@nexo-alpha/agent`](./packages/agent/README.md) | `0.4.1` | AI agent orchestration layer wiring `UNDERSTAND → KNOW → DECIDE → ACT → VERIFY`, tool registries, and autonomous workflows. |
| [`@nexo-alpha/behavior`](./packages/behavior/README.md) | `0.4.1` | Typed bounded behavior layer: micro-decision primitives (`choice`, `boolean`, `score`), policies, and telemetry. |
| [`@nexo-alpha/web`](./packages/web/README.md) | `0.4.1` | Web search, evidence extraction, and claim verification pipeline for AI research. |
| [`@nexo-alpha/tools`](./packages/tools/README.md) | `0.4.1` | AI & developer introspection: read/write interfaces, verification, live metrics, source scanning, and knowledge graph. |
| [`@nexo-alpha/scheduler`](./packages/scheduler/README.md) | `0.4.1` | Dependency-free cron scheduler for `NexoJob`s, plus a persistent background job queue with retries. |
| [`@nexo-alpha/webhooks`](./packages/webhooks/README.md) | `0.5.0` | Signed, retried webhook delivery with subscription management and receiver-side verification. |
| [`@nexo-alpha/integrations`](./packages/integrations/README.md) | `0.5.0` | Agent toolkits for GitHub and Slack, gated by RBAC like any other tool. |
| [`@nexo-alpha/hapi`](./packages/hapi/README.md) | `0.4.1` | HTTP adapter turning declared `NexoApi`s into running Hapi.js servers with auth, validation, and lifecycle hooks. |
| [`@nexo-alpha/cli`](./packages/cli/README.md) | `0.4.1` | Terminal CLI for architecture inspection, dependency impact tracing, health checks, and knowledge graphs. |
| [`create-nexo-app`](./packages/create-nexo-app/README.md) | `0.4.1` | Scaffolding CLI for generating starter templates. |

---

## How to Use Nexo: Core Walkthrough

### 1. Build an Application (`@nexo-alpha/core`)

Nexo applications are built around declarative modules, services, and APIs:

```ts
import { createApplication, NexoService } from "@nexo-alpha/core";

export const app = createApplication({
  name: "storefront",
  version: "1.0.0",
  description: "E-commerce platform"
});

class CartService extends NexoService {
  constructor() {
    super({ name: "cart-service" });
  }
  async getCart(userId: string) {
    return { userId, items: [] };
  }
}

const cartService = new CartService();

app.module({
  name: "cart",
  purpose: "Manage user shopping carts",
  status: "in-progress",
  services: [cartService],
  apis: [
    {
      name: "getCart",
      method: "GET",
      path: "/cart/:userId",
      handler: async (ctx) => cartService.getCart(ctx.params.userId)
    }
  ]
});

await app.start();
```

### 2. Serve APIs over HTTP (`@nexo-alpha/hapi`)

Turn your declared module APIs into an HTTP server with validation and authentication:

```ts
import { startHapiServer } from "@nexo-alpha/hapi";
import { app } from "./app.js";

const server = await startHapiServer(app, {
  port: 3000,
  authenticate: async (ctx) => {
    const token = ctx.headers.authorization;
    return token ? { authenticated: true } : { authenticated: false };
  }
});

console.log(`Server listening at ${server.info.uri}`);
```

### 3. Schedule Background Cron Jobs (`@nexo-alpha/scheduler`)

Declare recurring cron jobs right inside your modules:

```ts
import { startJobScheduler } from "@nexo-alpha/scheduler";

app.module({
  name: "cleanup",
  jobs: [
    {
      name: "purgeExpiredCarts",
      schedule: "0 * * * *", // every hour
      run: async () => {
        console.log("Cleaning up expired carts...");
      }
    }
  ]
});

const scheduler = startJobScheduler(app);
```

### 4. Deterministic AI Safety Boundary (`@nexo-alpha/decision`)

Prevent AI hallucinations and unauthorized actions using explicit deterministic rule chains:

```ts
import { createDecisionEngine, permissionRule, stateRule } from "@nexo-alpha/decision";

const engine = createDecisionEngine({ name: "order-safety" });

engine
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
    resolveState: async ({ intent }) => fetchOrderStatus(intent.target)
  }));

const outcome = await engine.evaluate({
  action: "cancel_order",
  actor: "user_123",
  target: "order_999",
  payload: { ownerId: "user_123" }
});

if (outcome.result === "APPROVE") {
  // Safe to execute!
} else if (outcome.result === "REJECT") {
  console.error("Blocked:", outcome.reason);
}
```

### 5. Orchestrate AI Agents & Workflows (`@nexo-alpha/agent`)

Wire the full `UNDERSTAND → KNOW → DECIDE → ACT → VERIFY` pipeline:

```ts
import { createAgent, createWorkflow } from "@nexo-alpha/agent";
import { createKnowledge } from "@nexo-alpha/context";
import { engine } from "./decision-engine.js";

const knowledge = createKnowledge();

const agent = createAgent({
  name: "support-agent",
  decisionEngine: engine,
  knowledge
});

// Register tools
agent.tools.register({
  name: "cancel_order",
  description: "Cancels an open order",
  execute: async ({ intent }) => cancelOrderInDatabase(intent.target)
});

// Run with automatic intent parsing, decision verification, and execution
const record = await agent.run("Please cancel order order_999 for user_123");
console.log(record.status); // "SUCCESS", "REJECTED", "ESCALATED", etc.
```

### 6. Inspect & Query Architecture with Nexo CLI (`@nexo-alpha/cli`)

Inspect your architecture and trace impact directly in your terminal:

```bash
# Inspect application modules and APIs
npx nexo inspect

# Check decisions and development status
npx nexo status

# Generate full architecture knowledge graph
npx nexo graph --source-root src --out .nexo/knowledge-graph.json

# Trace the blast radius of changes to a function or module
npx nexo impact "module:cart"

# Check which files have changed since the graph was generated
npx nexo freshness --source-root src
```

---

## Development & Monorepo Workflows

Clone and build the entire monorepo:

```bash
# Clone the repository
git clone https://github.com/nexo-framework/nexo.git
cd nexo

# Install dependencies across all packages
pnpm install

# Build all packages
pnpm build

# Run typechecks across all packages
pnpm typecheck

# Run test suites across all packages
pnpm test
```

`build`, `typecheck` and `test` run through [Turborepo](https://turborepo.com), which caches results per package: unchanged packages are skipped on later runs.

---

## Documentation

- [Developer Handbook & Guide](./docs/DEVELOPER_GUIDE.md) — Comprehensive guide on architecture, routing, services, and AI, plus the production runtime: workflows over HTTP, auth & RBAC, persistence, job queues, webhooks, observability, frontend dashboards, generators and testing (sections 13–22, including multi-tenant projects).
- [Architecture Notes](./docs/architecture/README.md) — Detailed design rationale and milestone log.
- [Product Requirements Document (PRD)](./PRD%20-%20AI-Era%20Software%20Development%20Framework.md) — The founding design principles of Nexo.

---

## License

MIT © Nexo Contributors

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
13. [Workflows over HTTP](#13-workflows-over-http)
14. [Authentication & Role-Based Access](#14-authentication--role-based-access)
15. [Persistence](#15-persistence)
16. [Background Job Queue](#16-background-job-queue)
17. [Webhooks](#17-webhooks)
18. [Observability](#18-observability)
19. [Frontend Client, Hooks & Dashboards](#19-frontend-client-hooks--dashboards)
20. [Generators, Doctor & Testing](#20-generators-doctor--testing)
21. [Production Hardening & Integrations](#21-production-hardening--integrations)
22. [Projects (Multi-Tenancy)](#22-projects-multi-tenancy)

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
import { createAgent, createWorkflow, createStepIntentParser } from "@nexo-alpha/agent";
import { decisionEngine } from "./decision.js";
import { knowledge } from "./knowledge.js";

export const agent = createAgent({
  name: "support-agent",
  decisionEngine,
  knowledge
});

// Register tools (the ACT layer). A tool only runs after the Decision Engine approves the intent.
agent.tools.register({
  action: "cancel_order",
  description: "Cancels an order",
  permissions: ["orders:cancel"], // enforced by toolPermissionRule (section 14)
  execute: async ({ intent }) => ({
    success: true,
    data: { cancelled: true, orderId: intent.target },
    durationMs: 0
  })
});

// Register verifiers (the VERIFY layer). Without one, a result counts as verified when `success` is true.
agent.verifiers.register({
  action: "cancel_order",
  verify: async ({ result }) =>
    result.success ? { status: "COMPLETE" } : { status: "FAILURE", reason: result.error, recovery: "RETRY" }
});

// A bounded, resumable multi-step workflow
const workflow = createWorkflow({
  name: "support-flow",
  agent,
  maxSteps: 5,
  allowedActions: ["cancel_order"],
  // Plans the next step from the goal. Plug in an LLM-backed IntentParser here.
  parser: createStepIntentParser([{ action: "cancel_order", target: "ord_999" }])
});

const outcome = await workflow.run("Cancel order ord_999 for user_123", {
  initialContext: { orderId: "ord_999", userId: "user_123" },
  actor: "user_123" // authoritative: a parsed intent cannot claim another actor
});
// outcome.status: "COMPLETED" | "FAILED" | "WAITING" | "ESCALATED" | "CANCELLED"
```

A run pauses with `WAITING` (the engine returned `ASK_USER`) or `ESCALATED`, and continues with `workflow.resume(runId, response)`. Useful workflow options:

| Option | Purpose |
|---|---|
| `onEvent` | Step-lifecycle events: `workflow.started`, `step.started`, `step.completed`, `step.failed`, `workflow.paused`, `workflow.completed`, `workflow.failed`, `workflow.cancelled`. |
| `store` | Where runs are saved: in memory, a file, or a document store (see section 15). |
| `memory` | An `AgentMemory` for facts that later runs can recall. Matching entries are loaded into `context.memory`, and tools receive it as `extras.memory`. |
| `run(goal, { signal })` | An `AbortSignal` that cancels the run before its next step. |

`workflow.start()` + `workflow.execute(id)` split a run into "create" and "execute". That's how the API runs workflows in a background queue (section 13).

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

## 13. Workflows over HTTP

`createWorkflowApiModule()` exposes workflows as a regular Nexo module, so any HTTP adapter can serve it:

```typescript
import { createApplication } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { createWorkflowApiModule } from "@nexo-alpha/agent";

const app = createApplication({ name: "support" });
app.module(createWorkflowApiModule({
  workflows: [workflow],
  auth: { required: true, scopes: ["workflows:run"] },
  // Take the actor from the authenticated request, never from the request body.
  resolveActor: (ctx) => ctx.headers["x-user-id"]
}));
await startHapiServer(app, { port: 4000, authenticate });
```

| Route | Result |
|---|---|
| `GET /workflows` | Names of the exposed workflows |
| `GET /workflows/:name` | Step limit, allowed actions, and the tools a run can call (with their permissions) |
| `POST /workflows/:name/runs` `{ goal, initialContext?, actor? }` | Starts a run |
| `GET /workflows/:name/runs[?status=]` | Saved runs |
| `GET /workflows/:name/runs/:id` | One run (404 if unknown) |
| `POST /workflows/:name/runs/:id/resume` `{ response? }` | Resumes a paused run (409 if it isn't paused) |

A handler can answer with a specific 4xx status by throwing `new NexoHttpError(status, code, message)` from `@nexo-alpha/core`. The adapter responds with `{ error, code }`.

**Background execution.** By default, `POST .../runs` answers when the run stops. If you pass a job queue (section 16), it answers immediately with the run in `RUNNING` state, and clients poll it (`client.workflows.waitForRun()`, section 19):

```typescript
app.module(createWorkflowApiModule({ workflows, queue }));
```

If the process crashes mid-run, the queued job is retried after restart and the run continues from its last saved step.

---

## 14. Authentication & Role-Based Access

Authenticators live in `@nexo-alpha/core` and work with both `app.setAuthenticator()` and `createHapiServer({ authenticate })`:

```typescript
import { anyAuthenticator, apiKeyAuthenticator, jwtAuthenticator, signToken } from "@nexo-alpha/core";

const authenticate = anyAuthenticator(
  // HS256 JWTs. Only HS256 is accepted, `exp` is required, and the secret must be at least 32 bytes.
  jwtAuthenticator({
    secret: process.env.JWT_SECRET!,
    issuer: "my-app",
    resolve: (claims) => ({ identity: claims.sub, scopes: [...access.permissionsFor(rolesOf(claims.sub))] })
  }),
  // Service-to-service API keys (compared in constant time).
  apiKeyAuthenticator({ keys: [{ key: process.env.BILLING_KEY!, identity: "billing", scopes: ["orders:*"] }] })
);

const token = signToken({ sub: "user_123" }, process.env.JWT_SECRET!, { expiresInSeconds: 3600 });
```

Scopes and permissions use one matching rule everywhere: an exact match, `"*"`, or `"prefix:*"` (`"orders:*"` covers `"orders:refund"`).

**RBAC for agent actions** (`@nexo-alpha/decision` + `@nexo-alpha/agent`):

```typescript
import { createAccessControl } from "@nexo-alpha/decision";
import { toolPermissionRule } from "@nexo-alpha/agent";

const access = createAccessControl([
  { name: "viewer", permissions: ["orders:read"] },
  { name: "support", permissions: ["orders:refund", "orders:cancel"], inherits: ["viewer"] },
  { name: "admin", permissions: ["*"] }
]);

// Rejects (PERMISSION_DENIED) any tool call whose declared `permissions` the actor's roles don't grant.
decisionEngine.addRule(toolPermissionRule({
  access,
  tools: agent.tools,
  resolveRoles: ({ intent }) => rolesOf(intent.actor) // from a trusted source, never the intent payload
}));
```

`rbacRule({ access, resolveRoles, permissions: { action: "perm" } })` does the same for actions without tools.

---

## 15. Persistence

`@nexo-alpha/core` provides a small document store: JSON documents addressed by `(collection, id)`.

```typescript
import { createSqliteDocumentStore } from "@nexo-alpha/core";
import { createDocumentWorkflowStore, createDocumentAgentMemory } from "@nexo-alpha/agent";

const store = await createSqliteDocumentStore("data/nexo.sqlite"); // Node >= 22.5, no dependency

const workflow = createWorkflow({
  name: "support-flow",
  agent,
  store: createDocumentWorkflowStore(store),   // runs survive restarts
  memory: createDocumentAgentMemory(store)     // cross-run agent memory
});
```

| Backend | Use for |
|---|---|
| `createInMemoryDocumentStore()` | Tests, short-lived processes |
| `createFileDocumentStore(path)` | One process; cached in memory, writes grouped and atomic |
| `createSqliteDocumentStore(path)` | Production; WAL mode, so several processes can share one database |

---

## 16. Background Job Queue

`createJobQueue()` in `@nexo-alpha/scheduler` stores jobs in a document store. It retries failures with backoff, and after a crash it re-queues jobs that were mid-run:

```typescript
import { createJobQueue } from "@nexo-alpha/scheduler";

const queue = createJobQueue({ store, concurrency: 4, maxAttempts: 5 });
queue.define("send-receipt", async ({ orderId }) => mailer.sendReceipt(orderId));
await queue.start();

await queue.enqueue("send-receipt", { orderId: "ord_1" }, { delayMs: 60_000 });
```

Delivery is at-least-once, so write handlers that can safely run twice.

Several worker processes can share one SQLite store. Each job is claimed atomically, so only one worker runs it. A running job holds a lease (`leaseMs`, default 5 minutes) that its worker renews while the handler runs. If a worker dies, another worker re-queues its jobs once the lease expires. Give each worker a stable `workerId` (such as the pod name) and it re-queues its own interrupted jobs immediately on restart.

---

## 17. Webhooks

`@nexo-alpha/webhooks` delivers signed events to subscribers through the job queue:

```typescript
import { createWebhookDispatcher, verifyWebhookSignature } from "@nexo-alpha/webhooks";

const webhooks = createWebhookDispatcher({ store, queue, allowUrl: (url) => url.protocol === "https:" });
const { secret } = await webhooks.subscribe({ url: "https://example.com/hooks", events: ["workflow.*"] });

createWorkflow({ name: "support-flow", agent, onEvent: webhooks.forward });

// Receiver side: verify against the raw body before parsing it.
verifyWebhookSignature({ body: rawBody, signature: req.headers["x-nexo-signature"], secret });
```

Each delivery is signed with `X-Nexo-Signature: t=<unix>,v1=<hmac>`. Retries reuse the same `X-Nexo-Delivery` ID, so receivers can drop duplicates.

---

## 18. Observability

```typescript
import { createLogger } from "@nexo-alpha/core";
import { createMetricsCollector, createMetricsApiModule } from "@nexo-alpha/tools";

// Structured JSON-line logs. Each request gets an x-request-id (an incoming one is reused if well-formed).
const logger = createLogger({ level: "info", fields: { service: "support" } });
await startHapiServer(app, { logger });

// Metrics for APIs, cron jobs, workflows and queues.
const metrics = createMetricsCollector(app);
createWorkflow({ name: "support-flow", agent, onEvent: metrics.workflowListener });
createJobQueue({ store, onEvent: metrics.queueListener });

app.module(createMetricsApiModule(metrics)); // GET /metrics -> JSON snapshot for dashboards
metrics.toPrometheus();                      // Prometheus text format for scraping
```

---

## 19. Frontend Client, Hooks & Dashboards

`@nexo-alpha/frontend` includes typed clients and React components for the APIs above. `@nexo-alpha/frontend/client` is a React-free entry point for Node scripts.

```tsx
import {
  NexoProvider, NexoWorkflowDashboard, NexoWorkflowCatalog,
  NexoMetricsDashboard, NexoMemoryBrowser, createNexoClient
} from "@nexo-alpha/frontend";

<NexoProvider baseUrl="https://api.example.com" headers={{ Authorization: `Bearer ${token}` }}>
  <NexoWorkflowDashboard workflow="support-flow" />   {/* start, list, inspect, resume runs */}
  <NexoWorkflowCatalog />                            {/* workflows, tools and required permissions */}
  <NexoMetricsDashboard />                           {/* needs createMetricsApiModule */}
  <NexoMemoryBrowser allowForget />                  {/* needs createMemoryApiModule */}
</NexoProvider>

// Imperative client
const client = createNexoClient({ baseUrl: "https://api.example.com" });
const run = await client.workflows.startRun("support-flow", { goal: "Refund order 9" });
const done = await client.workflows.waitForRun("support-flow", run.id);
```

The hooks are `useWorkflowRuns`, `useWorkflowRun` (polls while the run is `RUNNING`), `useWorkflowActions`, `useWorkflowCatalog`, `useNexoMetrics` and `useAgentMemory`.

---

## 20. Generators, Doctor & Testing

```bash
nexo generate tool refund-order      # src/tools/refund-order.ts + a test
nexo generate workflow support-flow  # src/workflows/support-flow.ts
nexo generate module billing         # src/modules/billing/index.ts
nexo doctor                          # checks Node version, ESM setup, nexo.config.json, package versions, tsconfig
```

Test helpers live in `@nexo-alpha/agent/testing`:

```typescript
import { createToolStub, createTestAgent, runSteps, collectEvents } from "@nexo-alpha/agent/testing";

const refund = createToolStub("refund_order", { data: { refunded: true } });
const { agent } = createTestAgent({ tools: [refund] });
const events = collectEvents();

const run = await runSteps(agent, [{ action: "refund_order", target: "ord_1" }], {
  actor: "sam",
  workflow: { onEvent: events.listener }
});

assert.equal(run.status, "COMPLETED");
assert.equal(refund.calls[0].intent.actor, "sam");
```

To call an API directly in a test: `app.dispatch("getOrder", createRequestContext({ params: { id: "o-1" } }))` (`createRequestContext` is from `@nexo-alpha/core`).

---

## 21. Production Hardening & Integrations

**Rate limiting.** Limits are per client IP by default. Return an API key or user ID from `key` for per-identity quotas, or `undefined` to exempt a route:

```typescript
await startHapiServer(app, {
  rateLimit: { windowMs: 60_000, max: 300, key: (req) => (req.path === "/health" ? undefined : req.remoteAddress) }
});
// 429 + Retry-After once exceeded; RateLimit-* headers on every response.
// createRateLimiter() from @nexo-alpha/core applies the same limits anywhere, e.g. per tenant in a handler.
```

**Resilience.** `@nexo-alpha/core` exports `withTimeout`, `retry` and `createCircuitBreaker`. Tools accept `timeoutMs`, so a hung dependency fails its step instead of stalling the workflow:

```typescript
const breaker = createCircuitBreaker({ failureThreshold: 5, resetMs: 30_000 });
agent.tools.register({
  action: "charge_card",
  timeoutMs: 5_000,
  execute: async ({ intent }) => breaker.run(() => retry(() => payments.charge(intent.payload), { attempts: 3 }))
});
```

**Audit trail.** Every agent execution record (actor, intent, decision, tool result, verification) can be persisted and queried:

```typescript
const audit = createDocumentAuditTrail(store);
const agent = createAgent({ decisionEngine, auditSink: audit.sink }); // in-memory auditLog keeps the newest 10,000
await audit.query({ status: "BLOCKED", since: "2026-09-01T00:00:00Z" });
```

**Log redaction.** `createLogger()` replaces credential fields at any depth with `"[REDACTED]"`: `authorization`, `cookie`, `password`, `secret`, `token`, `apiKey` and similar. Pass `redact` to change the list.

**Integrations.** `@nexo-alpha/integrations` provides GitHub and Slack toolkits (see its README). Install them with `installToolkit(agent, toolkit)`; their tools declare permissions and go through RBAC.

**Deployment.** `examples/support-desk/Dockerfile` is a production image built from the repo root. It runs as a non-root user, keeps data on a volume, and has a `/health` check. The app refuses to start in production without `JWT_SECRET`.

**Build caching.** `pnpm build`, `pnpm test` and `pnpm typecheck` run through Turborepo (`turbo.json`). Packages whose inputs haven't changed are skipped, both locally and in CI (the `.turbo` cache is kept between runs).

**Benchmarks.** After `pnpm build`, run `pnpm bench` (or `pnpm bench -- --quick`) to measure store, workflow and queue throughput. The JSON-file store serves reads from memory and groups concurrent writes into one file write, but each write still rewrites the whole file and it is single-process. Use it for development and small single-process deployments; use SQLite in production.

---

## 22. Projects (Multi-Tenancy)

A project is a tenant. Each project's workflow runs, agent memory, audit trail and webhook subscriptions are isolated from every other project's, and each user has roles per project.

```typescript
import { createProjectRegistry, createProjectApiModule, scopeByProject, runInProject } from "@nexo-alpha/core";

const projects = createProjectRegistry(store);                   // global: projects + members
const tenantStore = scopeByProject(store, { required: true });   // per-project collections

const workflow = createWorkflow({
  name: "refunds",
  agent,
  store: createDocumentWorkflowStore(tenantStore),
  memory: createDocumentAgentMemory(tenantStore)
});
const queue = createJobQueue({ store }); // unscoped: jobs remember their project and run inside it

app.module(createProjectApiModule({ registry: projects, resolveUser }));
await startHapiServer(app, {
  authenticate,
  project: {
    // x-project-id picks the project; only members get in.
    resolve: async (ctx) => {
      const id = ctx.headers["x-project-id"];
      if (id !== undefined && (await projects.rolesOf(id, userOf(ctx))).length === 0) {
        throw new NexoHttpError(404, "PROJECT_NOT_FOUND", "Not found.");
      }
      return id;
    },
    skip: (api) => api.name === "health"
  }
});

// Outside HTTP (scripts, tests), enter a project explicitly:
await runInProject("acme", () => workflow.run("Refund order 9"));
```

- **How the project is carried.** `runInProject` puts the project ID into Node's `AsyncLocalStorage`, so it follows every `await` without being passed around. With `required: true`, a store operation made outside a project fails instead of quietly reading or writing shared data.
- **Per-project roles.** Look up the user's roles for the request's project with `projects.rolesOf(projectId, user)`, both in the authenticator (HTTP scopes) and in `resolveRoles` (tool RBAC). A user can then be a manager in one project and a viewer in another.
- **Projects API.**
  - `GET /projects` lists the user's projects.
  - `POST /projects` creates one; the creator becomes owner.
  - `GET /projects/:id` is for members only; everyone else gets 404.
  - `PUT /projects/:id/members/:user` sets a member's roles; owners only.
- **Frontend.**
  - `createNexoClient({ projectId })` (or `<NexoProvider projectId=…>`) sends `x-project-id` on every request.
  - `client.forProject(id)` switches project.
  - `client.projects` manages projects.
  - `<NexoProjectSwitcher onChange={…} allowCreate />` is a ready-made picker.
- **Metrics are platform-wide,** across all projects. Keep `/metrics` for platform operators rather than tenants.

`examples/support-desk` is fully multi-tenant: two demo projects with different members, and tests that prove isolation.

---

## License

MIT © Nexo Contributors

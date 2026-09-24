# @nexo-alpha/core

> Pure, dependency-free core runtime for the Nexo application framework.

`@nexo-alpha/core` defines the foundational application model for Nexo: **Applications, Modules, Services, declarative APIs, background Jobs, Dependency Injection, Middleware, Plugins, and Lifecycle management**. It has **zero external runtime dependencies** — it does not depend on HTTP frameworks, databases, or AI providers.

---

## Installation

```bash
npm install @nexo-alpha/core
```

Or using pnpm:

```bash
pnpm add @nexo-alpha/core
```

---

## Key Features

- **Hierarchical Modular Architecture**: Group APIs, services, and background jobs into isolated, cohesive domain boundaries.
- **Dependency Injection Container**: Built-in, lightweight DI container supporting singleton, transient, and scoped lifetimes with circular dependency detection.
- **Middleware Pipeline**: Onion-style async request interceptors for logging, metrics, authentication, and transformation.
- **Extensible Plugin System**: Install and compose modular plugins with built-in dependency ordering and validation.
- **Fine-Grained Lifecycle Hooks**: Hook into `beforeInit`, `afterInit`, `beforeStart`, `afterStart`, `beforeStop`, and `afterStop` transitions.
- **Direct API Dispatch**: Execute and test declared APIs directly in core with validation and authentication without spinning up a live network port.
- **Architectural Knowledge Tracking**: Declare decisions and system constraints directly in code for human developers and AI coding agents.

---

## How to Use

### 1. Creating an Application & Defining Modules

An application is composed of modular feature boundaries:

```ts
import { createApplication } from "@nexo-alpha/core";

export const app = createApplication({
  name: "ecommerce-api",
  version: "1.0.0",
  description: "E-commerce core service",
  config: {
    maxCartItems: 25,
    currency: "USD"
  }
});
```

### 2. Creating State-Managed Services (`NexoService`)

Services encapsulate state, external connections (databases, message brokers), and domain logic. Extend `NexoService` to hook directly into application lifecycle:

```ts
import { NexoService } from "@nexo-alpha/core";

export class InventoryService extends NexoService {
  private stock: Map<string, number> = new Map();

  constructor() {
    super({
      name: "inventory-service",
      purpose: "Track physical and warehouse stock availability"
    });
  }

  // Called automatically when the application starts
  async onStart() {
    console.log("Initializing inventory database connection...");
    this.stock.set("item_101", 42);
  }

  // Called automatically when the application stops
  async onStop() {
    console.log("Closing inventory connections...");
    this.stock.clear();
  }

  hasStock(sku: string, qty: number): boolean {
    return (this.stock.get(sku) ?? 0) >= qty;
  }

  deductStock(sku: string, qty: number): boolean {
    const current = this.stock.get(sku) ?? 0;
    if (current < qty) return false;
    this.stock.set(sku, current - qty);
    return true;
  }
}

export const inventoryService = new InventoryService();
```

### 3. Registering Modules with APIs and Services

Attach your services, APIs, and background jobs to a module:

```ts
app.module({
  name: "inventory",
  purpose: "Manage warehouse stock and availability",
  status: "active",
  dependencies: [], // list of module names this depends on
  services: [inventoryService],
  apis: [
    {
      name: "checkStock",
      method: "GET",
      path: "/inventory/:sku",
      handler: async (ctx) => {
        const sku = ctx.params.sku;
        const available = inventoryService.hasStock(sku, 1);
        return { sku, inStock: available };
      }
    },
    {
      name: "deductStock",
      method: "POST",
      path: "/inventory/deduct",
      validate: (ctx) => {
        const payload = ctx.payload as { sku?: string; qty?: number };
        if (!payload?.sku || !payload?.qty) {
          return { valid: false, errors: ["'sku' and 'qty' are required."] };
        }
        return { valid: true };
      },
      handler: async (ctx) => {
        const { sku, qty } = ctx.payload as { sku: string; qty: number };
        const ok = inventoryService.deductStock(sku, qty);
        return { success: ok };
      }
    }
  ],
  jobs: [
    {
      name: "dailyStockAudit",
      schedule: "0 0 * * *", // midnight daily
      run: async () => {
        console.log("Auditing warehouse stock levels...");
      }
    }
  ]
});
```

### 4. Dependency Injection & Service Container

Nexo includes a typed DI container with support for values, factories, singleton/transient/scoped lifetimes, and child containers:

```ts
import { NexoContainer } from "@nexo-alpha/core";

// Direct registration on the application
app.provide("db.url", "postgres://localhost:5432/main");
app.provide("logger", () => console, { singleton: true });

// Resolving dependencies
const dbUrl = app.resolve<string>("db.url");

// Child scoping for isolated request contexts
const scopedContainer = app.container.createChild();
scopedContainer.bind("requestId", () => crypto.randomUUID(), { lifetime: "scoped" });
```

### 5. Middleware Pipeline

Add global or per-request middleware using the onion execution pattern:

```ts
app.useMiddleware(async (ctx, next) => {
  const start = Date.now();
  console.log(`[REQ] ${JSON.stringify(ctx.params)}`);

  // Invoke subsequent middlewares and the API handler
  const result = await next();

  console.log(`[RES] completed in ${Date.now() - start}ms`);
  return result;
});
```

### 6. Extensible Plugins (`app.use()`)

Extend Nexo applications using modular plugins with dependency validation:

```ts
import { NexoPlugin, NexoApplication } from "@nexo-alpha/core";

const auditPlugin: NexoPlugin<{ retentionDays: number }> = {
  name: "audit-logger",
  version: "1.0.0",
  install(application: NexoApplication, options) {
    application.onBeforeStart(() => {
      console.log(`Audit logger active with ${options?.retentionDays} days retention.`);
    });
  }
};

await app.use(auditPlugin, { retentionDays: 90 });
```

### 7. Lifecycle Hooks

Hook into each phase of the application lifecycle with synchronous or asynchronous functions:

```ts
app.onBeforeInit((app) => console.log("Initializing modules..."));
app.onAfterInit((app) => console.log("All modules initialized."));
app.onBeforeStart((app) => console.log("Starting services..."));
app.onAfterStart((app) => console.log("Application is running."));
app.onBeforeStop((app) => console.log("Stopping services..."));
app.onAfterStop((app) => console.log("Application cleanly stopped."));

await app.start();
console.log("App state:", app.state); // "running"
```

### 8. Direct API Dispatching & Testing

Invoke declared APIs directly without spinning up an HTTP server. Nexo automatically executes authentication, validation, and middleware:

```ts
app.setAuthenticator(async (req) => {
  if (req.headers["authorization"] === "Bearer valid-token") {
    return { authenticated: true, scopes: ["read"] };
  }
  return { authenticated: false };
});

const result = await app.dispatch("checkStock", {
  params: { sku: "item_101" },
  query: {},
  headers: { authorization: "Bearer valid-token" },
  payload: null
});

console.log(result); // { sku: "item_101", inStock: true }
```

### 9. Architectural Decisions & Constraints

Document architectural decisions directly in code so human engineers and AI coding assistants understand the design rationale:

```ts
app.addDecision({
  title: "Inventory updates are synchronized in memory",
  reason: "Required sub-millisecond stock validation before checkout.",
  status: "accepted"
});

app.addConstraint({
  description: "Do not expose internal warehouse location IDs via public APIs.",
  reason: "Security and vendor privacy policy."
});

const decisions = app.getDecisions();
const constraints = app.getConstraints();
```

---

## Related Packages

- [`@nexo-alpha/hapi`](https://www.npmjs.com/package/@nexo-alpha/hapi) — Mount your declared `NexoApi`s onto a live Hapi.js HTTP server.
- [`@nexo-alpha/scheduler`](https://www.npmjs.com/package/@nexo-alpha/scheduler) — Run your declared `NexoJob`s using cron schedules.
- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — Turn your `NexoApplication` into a structured JSON manifest.
- [`@nexo-alpha/decision`](https://www.npmjs.com/package/@nexo-alpha/decision) — Deterministic AI safety and rule evaluation layer.
- [`@nexo-alpha/agent`](https://www.npmjs.com/package/@nexo-alpha/agent) — AI agent and multi-step workflow orchestration.
- [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools) — Introspection, verification, and code scanning interface.

---

## License

MIT © Nexo Contributors

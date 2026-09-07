# @nexo-alpha/core

Core application runtime for **Nexo** — a lightweight Node.js framework designed to make software projects understandable, navigable, and safely operable by both human developers and AI development tools.

`@nexo/core` has **zero runtime dependencies** and never depends on an HTTP framework, a database, or an AI provider. It only defines the application model: applications, modules, services, APIs, lifecycle, and the application-level knowledge (decisions, constraints, development state) that keeps a project's intent alongside its code.

## Install

```bash
npm install @nexo-alpha/core
```

## Why

Most frameworks help you build an application but don't give an AI tool (or a new teammate) a structured way to understand it without reading the entire codebase. `@nexo/core` gives an application a place to declare *what it is*, not just *what it does* — module purpose, ownership of APIs/services, dependencies between modules, and the current state of development.

## Usage

```ts
import { createApplication } from "@nexo-alpha/core";

const app = createApplication({
  name: "shop",
  version: "0.1.0",
  description: "A commerce platform"
});

app.module({
  name: "payments",
  purpose: "Handle customer payments",
  status: "in-progress",
  dependencies: ["stripe", "orders"],
  apis: [{ name: "createPayment", method: "POST", path: "/payments" }],
  services: [{ name: "PaymentService" }]
});

app.addDecision({
  title: "Payment records are immutable",
  reason: "Auditability of financial history.",
  status: "accepted"
});

app.setDevelopmentState({
  currentObjective: "Implement payment recovery",
  completed: ["Retry API"],
  inProgress: ["Retry worker"]
});

await app.start();

app.getDependents("orders"); // -> ["payments"]
```

## What's here

- **Application lifecycle** — `createApplication`, `start()`/`stop()`, module `initialize`/`start`/`stop` hooks
- **Module model** — `purpose`, `status`, `dependencies`, `apis`, `services`, `events`, `jobs`
- **Dependency graph** — `getDependencies(name)` / `getDependents(name)`
- **Events** — a plain `NexoEventBus` (wraps `node:events`) via `app.events`
- **Configuration** — `getConfig(key)` / `getAllConfig()` / `updateConfig(patch)`
- **Knowledge records** — `addDecision`/`getDecisions`, `addConstraint`/`getConstraints`, `setDevelopmentState`/`getDevelopmentState`
- **Structural mutators** — `addApiToModule`/`updateApi`, `addServiceToModule`/`updateService`, `addModuleDependency` (raw, unguarded operations; permissions/validation/audit live in `@nexo-alpha/tools`'s write interface, not here)
- **Audit trail** — `addHistoryEntry`/`getHistory` — an append-only, timestamped log of operations (`success`/`denied`/`failed`)

## Related packages

- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — turns a running application into a JSON manifest
- [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools) — a structured, read-only interface for AI development tools

## Status

**v0.1-alpha.** No CLI, no HTTP adapter yet. Write/mutation AI operations exist as raw core mutators (`addApiToModule`, `updateApi`, `addModuleDependency`, etc.) — the permission/validation/audit pipeline that makes them safe for an AI tool to call lives in `@nexo-alpha/tools`'s `createWriteInterface`.

## License

MIT

# @nexo-alpha/context

> Generates a rich, JSON-serializable application manifest and architectural knowledge journal from a Nexo application.

`@nexo-alpha/context` turns a [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) application and its repository context into a structured snapshot. This delivers Nexo's founding design goal: **"Software that can explain itself"** to human engineers, AI coding agents, and CI tools without grepping source code.

---

## Installation

```bash
npm install @nexo-alpha/context @nexo-alpha/core
```

Or using pnpm:

```bash
pnpm add @nexo-alpha/context @nexo-alpha/core
```

---

## How to Use

### 1. Generating an Application Context Manifest

Build a complete snapshot of modules, APIs, services, and dependency graphs:

```ts
import { createApplication } from "@nexo-alpha/core";
import { buildContext, contextToJson } from "@nexo-alpha/context";

const app = createApplication({
  name: "ecommerce-service",
  version: "1.0.0",
  description: "Core commerce platform"
});

app.module({
  name: "orders",
  purpose: "Manage order placement and history",
  dependencies: ["inventory", "payments"],
  apis: [
    { name: "createOrder", method: "POST", path: "/orders" },
    { name: "getOrder", method: "GET", path: "/orders/:id" }
  ],
  services: [{ name: "OrderRepository" }]
});

// Build the manifest object
const context = buildContext(app);

// Convert to formatted JSON
console.log(contextToJson(context));
```

The resulting JSON manifest provides a clean representation of the entire application:

```json
{
  "application": {
    "name": "ecommerce-service",
    "version": "1.0.0",
    "description": "Core commerce platform",
    "state": "created"
  },
  "modules": [
    {
      "name": "orders",
      "purpose": "Manage order placement and history",
      "dependencies": ["inventory", "payments"],
      "dependents": [],
      "apis": [
        { "name": "createOrder", "method": "POST", "path": "/orders" },
        { "name": "getOrder", "method": "GET", "path": "/orders/:id" }
      ],
      "services": [{ "name": "OrderRepository" }],
      "events": [],
      "jobs": []
    }
  ]
}
```

### 2. Managing Architectural Knowledge (`createKnowledge`)

Capture the *why* behind your code — decisions, constraints, development status, and entity intents:

```ts
import { createKnowledge, knowledgeToJson, knowledgeFromJson } from "@nexo-alpha/context";

export const knowledge = createKnowledge();

// 1. Record architectural decisions (ADRs)
knowledge.addDecision({
  title: "Use PostgreSQL for Order Persistence",
  reason: "ACID compliance is critical for financial transaction records.",
  status: "accepted",
  alternatives: ["MongoDB", "DynamoDB"]
});

// 2. Record engineering constraints
knowledge.addConstraint({
  description: "All monetary values must be stored as integer cents.",
  reason: "Avoid floating point precision issues across currency calculations."
});

// 3. Track active development status
knowledge.setDevelopmentState({
  currentObjective: "Implement Stripe webhooks for payment confirmation",
  completed: ["Cart API", "Initial order schema"],
  inProgress: ["Stripe webhook signature validation"],
  blocked: [],
  knownIssues: ["Stripe sandbox rate limits during integration tests"]
});

// 4. Record entity intent ("why this specific component exists")
knowledge.addIntent({
  entityKind: "component",
  entityName: "StripeWebhookHandler",
  intent: "Idempotently processes asynchronous payment capture events from Stripe",
  evidence: {
    sourceFile: "src/modules/payments/webhook.ts",
    recordedAt: new Date().toISOString()
  }
});
```

### 3. Fusing Context and Knowledge

Pass your `knowledge` container directly to `buildContext` so the combined manifest includes both structural metadata and architectural intent:

```ts
const fullManifest = buildContext(app, { knowledge });

console.log(contextToJson(fullManifest));
```

### 4. Detecting Architectural Drift & Staleness

`@nexo-alpha/context` provides deterministic SHA-256 fingerprinting for structural changes:

```ts
import { hashStructure, describeStructure } from "@nexo-alpha/context";

const context = buildContext(app);

// Get a stable hash of modules, apis, services, and dependencies
const structureHash = hashStructure(context);
console.log("Structure hash:", structureHash);

// Get a human-readable structural signature
const description = describeStructure(context);
console.log(description);
```

You can also hash source code trees and individual files to detect code changes:

```ts
import { hashSourceTree, hashSourceFile } from "@nexo-alpha/context";

// Hashes a source tree scan to track file/symbol changes
const treeHash = hashSourceTree(sourceTree);
```

---

## What's Included

- **`buildContext(app, options?)`** — Creates a serializable `ApplicationContext`.
- **`contextToJson(context)`** — Stringifies manifest without undefined fields.
- **`createKnowledge()`** — Creates a knowledge journal for decisions, constraints, development state, and intents.
- **`knowledgeToJson(knowledge)` / `knowledgeFromJson(json)`** — Serializes and hydrates knowledge journals.
- **`hashStructure(context)`** — Generates a SHA-256 fingerprint of the application structure.
- **`describeStructure(context)`** — Summarizes modules, APIs, and services into a human-readable digest.
- **`hashSourceTree(tree)` / `hashSourceFile(file)`** — Computes deterministic fingerprints for source files and exports.

---

## Related Packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — The application model that this package inspects.
- [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools) — AI read/write tooling interface built on this manifest.
- [`@nexo-alpha/cli`](https://www.npmjs.com/package/@nexo-alpha/cli) — Terminal commands for viewing context manifests (`nexo context`).

---

## License

MIT © Nexo Contributors

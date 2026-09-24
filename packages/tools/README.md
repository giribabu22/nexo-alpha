# @nexo-alpha/tools

> Structured read, write, verification, metrics, and source-code analysis interfaces for human developers and AI coding agents.

`@nexo-alpha/tools` provides programmatic tool interfaces to inspect, safely modify, measure, and verify [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) applications.

---

## Installation

```bash
npm install @nexo-alpha/tools @nexo-alpha/core @nexo-alpha/context
```

Or using pnpm:

```bash
pnpm add @nexo-alpha/tools @nexo-alpha/core @nexo-alpha/context
```

---

## How to Use

### 1. Read Interface (`createReadInterface`)

Inspect application structure, modules, services, APIs, and dependencies without grepping source files:

```ts
import { createApplication } from "@nexo-alpha/core";
import { createReadInterface } from "@nexo-alpha/tools";

const app = createApplication({ name: "storefront" });
const tools = createReadInterface(app);

// Query high-level application info
const application = tools.getApplication();
console.log(application.name); // "storefront"

// Inspect a specific module
const moduleInfo = tools.getModule("payments");

// Query dependencies
const dependencies = tools.getDependencies("orders");
const dependents = tools.getDependents("payments");

// Retrieve architectural decisions and constraints
const decisions = tools.getDecisions();
const status = tools.getStatus();
```

---

### 2. Permission-Gated Write Interface (`createWriteInterface`)

Safely perform structural modifications. Every mutation enforces:
`Permission Check ──► Input Validation ──► Operation Execution ──► Audit Logging`

```ts
import { createWriteInterface } from "@nexo-alpha/tools";

// Define explicit permission scopes
const writes = createWriteInterface(app, {
  scopes: new Set(["modify-source"])
});

// Create a new API on a module
const result = writes.createApi("payments", {
  name: "refundPayment",
  method: "POST",
  path: "/payments/:id/refund"
});

if (result.success) {
  console.log("Created API:", result.data);
} else {
  console.error("Mutation failed:", result.error);
}

// Check the audit trail of modifications
const auditTrail = tools.getHistory();
console.log("Audit log:", auditTrail);
```

Supported permission scopes:
- `"modify-source"` — Allows adding/modifying modules, APIs, services, jobs, and dependencies.
- `"modify-configuration"` — Allows updating application configuration.

---

### 3. Architecture Verification Interface (`createVerificationInterface`)

Detect architectural flaws, cycles, unresolved dependencies, and health issues:

```ts
import { createVerificationInterface } from "@nexo-alpha/tools";

const verifier = createVerificationInterface(app);

// 1. Detect cycles, self-dependencies, and missing modules
const architectureValidation = verifier.validateArchitecture();
if (!architectureValidation.valid) {
  console.warn("Architecture issues found:", architectureValidation.issues);
}

// 2. Validate configuration objects (e.g. JSON serialization safety)
const configValidation = verifier.validateConfiguration();

// 3. Inspect high-level application health metrics
const health = verifier.checkApplicationHealth();
console.log(`Modules: ${health.moduleCount}, APIs: ${health.apiCount}`);
```

---

### 4. Real-time Metrics Collector (`createMetricsCollector`)

Collect execution metrics from `@nexo-alpha/hapi` and `@nexo-alpha/scheduler` via `app.events`:

```ts
import { createMetricsCollector } from "@nexo-alpha/tools";

const metrics = createMetricsCollector(app);

// Later, after traffic runs:
const snapshot = metrics.getMetrics();
console.log("API Performance:", snapshot.apis);
// {
//   createOrder: { calls: 142, errors: 1, averageDurationMs: 14.2 }
// }

// Stop collector when finished to clean up event listeners
metrics.stop();
```

---

### 5. Source Code Scanning Interface (`createSourceInterface`)

Scan source files to extract symbols, exports, imports, and function call graphs:

```ts
import { createSourceInterface } from "@nexo-alpha/tools";

const scanner = createSourceInterface({
  projectRoot: process.cwd(),
  sourceRoot: "src"
});

const tree = await scanner.scan();
console.log(`Scanned ${tree.files.length} source files.`);
```

---

### 6. Knowledge Graph & Impact Tracing

Build, search, and trace dependencies across both registered modules and source code symbols:

```ts
import {
  buildKnowledgeGraph,
  searchKnowledgeGraph,
  traceImpact,
  saveKnowledgeGraph,
  loadKnowledgeGraph,
  diffKnowledgeGraphFreshness
} from "@nexo-alpha/tools";

// 1. Build unified knowledge graph
const graph = await buildKnowledgeGraph(app, {
  sourceRoot: "src"
});

// 2. Search graph nodes
const matches = searchKnowledgeGraph(graph, "refund");

// 3. Trace the blast radius (impact) of changing a node
const impact = traceImpact(graph, "module:payments", {
  direction: "dependents",
  maxDepth: 3
});

console.log("Blast radius nodes:", impact.hits.map(h => h.nodeId));

// 4. Save and diff freshness
await saveKnowledgeGraph(graph, ".nexo/knowledge-graph.json");
const diff = await diffKnowledgeGraphFreshness(".nexo/knowledge-graph.json", "src");
console.log(`Added: ${diff.added.length}, Changed: ${diff.changed.length}`);
```

---

## Related Packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — The application model inspected by tools.
- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — Structured manifest representation.
- [`@nexo-alpha/cli`](https://www.npmjs.com/package/@nexo-alpha/cli) — Terminal interface exposing these capabilities.

---

## License

MIT © Nexo Contributors

# @nexo-alpha/cli

> Command-line interface for the Nexo framework: inspect, trace, graph, and query your application architecture from your terminal.

`@nexo-alpha/cli` (the `nexo` executable) lets developers and AI agents explore an application's structural model — modules, APIs, services, dependencies, architectural decisions, and source code impact — without manually reading the entire codebase.

---

## Installation

Install globally:

```bash
npm install -g @nexo-alpha/cli
```

Or run directly via `npx`:

```bash
npx @nexo-alpha/cli <command>
# or simply:
npx nexo <command>
```

---

## Finding Your Application

The CLI resolves your Nexo application in one of two ways:

1. **Via `nexo.config.json` (Recommended)**:
   Place a `nexo.config.json` in your project root pointing to your compiled application file:
   ```json
   {
     "app": "./dist/app.js"
   }
   ```
   Now you can run any `nexo` command without providing the app path.

2. **Explicit file path**:
   Pass the path to your compiled application module as an argument:
   ```bash
   nexo inspect ./dist/app.js
   ```

---

## Command Reference

### 1. `nexo init`
Scaffold a new Nexo project using `create-nexo-app`:

```bash
nexo init my-new-app
```

---

### 2. `nexo inspect`
View a summary of the entire application, or inspect a specific module's APIs, services, and dependencies:

```bash
# View all modules, APIs, and services
nexo inspect

# Inspect a specific module in detail
nexo inspect payments
# or
nexo inspect --module payments
```

**Example output:**
```text
payments

Purpose: Handle customer payments
Status: active

Dependencies:
  stripe
  orders

Dependents:
  checkout

APIs:
  POST /payments/charge  createCharge
  POST /payments/refund  refundCharge

Services:
  PaymentGateway
```

---

### 3. `nexo status`
Display active development objectives, completed milestones, in-progress items, and known blockers:

```bash
nexo status
```

---

### 4. `nexo context`
Output the full serialized `ApplicationContext` JSON manifest. Useful for piping directly into AI prompts, LLMs, or documentation generators:

```bash
# Output JSON manifest
nexo context

# Fold real source file code scanning into the manifest
nexo context --source-root src > context.json
```

---

### 5. `nexo knowledge` & `nexo intents`
View recorded architectural decisions, constraints, history, and component intents:

```bash
# Display decisions and constraints
nexo knowledge

# View recorded entity intents (why components exist)
nexo intents

# View intent for a specific entity
nexo intents --entity-kind component --entity-name PaymentGateway
```

---

### 6. `nexo source`
Scan project source files directly from the filesystem (independent of whether they are registered with `NexoApplication`):

```bash
nexo source src
```

---

### 7. `nexo graph`
Generate a unified architectural and source-code knowledge graph linking modules, APIs, services, files, imports, and function calls:

```bash
# Build knowledge graph and save to .nexo/knowledge-graph.json
nexo graph --source-root src

# Specify custom output path
nexo graph --source-root src --out .nexo/my-graph.json

# Force rebuild bypassing cached hashes
nexo graph --source-root src --force

# Provide an LLM summarizer for nodes
nexo graph --source-root src --summarize ./summarizer.js
```

---

### 8. `nexo freshness`
Check which source files have been added, modified, or deleted since the knowledge graph was last built:

```bash
nexo freshness --source-root src
```

---

### 9. `nexo search`
Perform live, case-insensitive keyword searches over modules, APIs, and source symbols in your architecture:

```bash
nexo search "payment" --source-root src
```

---

### 10. `nexo trace`
Trace inbound edges to determine what connects to or affects a specific node:

```bash
# Trace everything that points to the payments module
nexo trace "module:payments"

# Trace only function callers
nexo trace "symbol:src/orders.ts#createOrder" --source-root src --callers
```

---

### 11. `nexo impact`
Calculate the transitive **blast radius** of changing a node. Walks the full multi-hop dependency graph:

```bash
# Find everything affected if payments changes
nexo impact "module:payments"

# Trace upward dependencies instead of dependents
nexo impact "module:orders" --dependencies

# Cap the traversal depth
nexo impact "module:orders" --max-depth 2

# Filter by specific edge kinds
nexo impact "module:orders" --edge-kinds calls,imports
```

---

### 12. `nexo validate` & `nexo health`
Run structural validation and health checks on your application:

```bash
# Validate architecture (checks for circular dependencies, missing modules, self-deps)
nexo validate

# High-level application health summary
nexo health
```

---

## Related Packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — Core application runtime.
- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — Underlying context manifest and knowledge records.
- [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools) — Programmatic read/write/verification interface powering this CLI.

---

## License

MIT © Nexo Contributors

# @nexo-alpha/context

Turns a running [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) `NexoApplication` into a plain, JSON-serializable **application context manifest** — the structured snapshot Nexo's product vision calls "software that can explain itself."

## Install

```bash
npm install @nexo-alpha/context
```

(You'll also need `@nexo-alpha/core` to build an application to snapshot.)

## Why

Source code alone doesn't tell an AI tool or a new developer *why* something exists, what depends on it, or where development currently stands. `@nexo/context` collects everything already declared on a `NexoApplication` — identity, modules, APIs, services, the dependency graph, decisions, constraints, and development state — into one JSON object that a CLI, an AI tool, or documentation generator can consume without reading the whole repository.

## Usage

```ts
import { createApplication } from "@nexo-alpha/core";
import { buildContext, contextToJson } from "@nexo-alpha/context";

const app = createApplication({ name: "shop" });

app.module({
  name: "orders",
  apis: [{ name: "createOrder", method: "POST", path: "/orders" }]
});

const context = buildContext(app);
console.log(contextToJson(context));
```

```json
{
  "application": { "name": "shop", "version": "0.1.0", "state": "created" },
  "modules": [
    {
      "name": "orders",
      "dependencies": [],
      "dependents": [],
      "apis": [{ "name": "createOrder", "method": "POST", "path": "/orders" }],
      "services": [],
      "events": [],
      "jobs": []
    }
  ],
  "decisions": [],
  "constraints": [],
  "developmentState": { "completed": [], "inProgress": [], "blocked": [], "knownIssues": [] }
}
```

Optional fields (e.g. a module with no `status`) are omitted entirely rather than included as `undefined`, so the manifest round-trips cleanly through `JSON.stringify`/`JSON.parse`.

## Related packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — the application/module model this package reads from
- [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools) — a read-only interface for AI tools, built on this manifest

## Status

**v0.1-alpha.** No CLI or AI-provider integration — this package produces data, it doesn't talk to anything.

## License

MIT

# @nexo-alpha/tools

A structured, provider-neutral **read interface** an AI development tool (or a CLI, or a script) can call to understand a [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) application — instead of grepping source code or hand-walking the application object.

## Install

```bash
npm install @nexo-alpha/tools
```

(You'll also need `@nexo-alpha/core`, and this package depends on `@nexo-alpha/context` internally.)

## Why

An AI coding agent shouldn't have to rediscover a project's structure from scratch every session. `@nexo/tools` exposes exactly the questions an AI tool needs to ask — "what is this project," "what is the Payments module," "what depends on Orders," "what's currently being worked on" — as plain function calls over the application's declared model.

## Usage

```ts
import { createApplication } from "@nexo-alpha/core";
import { createReadInterface } from "@nexo-alpha/tools";

const app = createApplication({ name: "shop" });

app.module({
  name: "payments",
  purpose: "Handle customer payments",
  dependencies: ["orders"]
});

const tools = createReadInterface(app);

tools.getApplication();      // { name, version, description, state }
tools.getModule("payments"); // full module metadata, or undefined
tools.getDependents("orders"); // -> ["payments"]
tools.getStatus();           // { state, developmentState }
```

## What's here

`createReadInterface(app)` returns a `NexoReadInterface` with:

`getApplication`, `getModules`, `getModule`, `getApi`, `getService`, `getDependencies`, `getDependents`, `getConfiguration`, `getArchitecture`, `getDecisions`, `getConstraints`, `getCurrentWork`, `getStatus`.

Name lookups (`getModule`, `getApi`, `getService`) return `undefined` when nothing matches rather than throwing — a tool probing an unfamiliar application should degrade gracefully, not crash.

## Design notes

- **Read-only.** There are no `createModule()`/`modifyApi()`-style write operations yet — those need a permissions/validation/audit layer that doesn't exist in Nexo yet.
- **camelCase**, consistent with the rest of Nexo's API, even though early product docs sketched these as snake_case (`get_application()`) — that was pseudocode-level, not a literal contract.

## Related packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — the application/module model
- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — the JSON manifest this package wraps

## Status

**v0.1-alpha.** No MCP server or CLI wiring yet — this is the interface those will eventually sit on top of.

## License

MIT

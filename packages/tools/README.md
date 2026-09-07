# @nexo-alpha/tools

A structured, provider-neutral **read and write interface** an AI development tool (or a CLI, or a script) can call to understand — and safely change — a [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) application, instead of grepping source code or hand-walking the application object.

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
tools.getHistory();          // audit trail of write operations

import { createWriteInterface } from "@nexo-alpha/tools";

const writes = createWriteInterface(app, {
  scopes: new Set(["modify-source"])
});

writes.createApi("payments", { name: "refundPayment", method: "POST", path: "/payments/:id/refund" });
// -> { success: true, data: { name: "refundPayment", ... } }

writes.updateConfiguration({ debug: true });
// -> { success: false, error: 'Permission required: "modify-configuration" is not granted...' }

import { createVerificationInterface } from "@nexo-alpha/tools";

const verify = createVerificationInterface(app);

verify.validateArchitecture();
// -> { valid: true, issues: [] } (or issues for cycles / self-deps / unresolved dependency names)
verify.checkApplicationHealth();
// -> { state, moduleCount, apiCount, serviceCount, architecture }
```

## What's here

`createReadInterface(app)` returns a `NexoReadInterface` with:

`getApplication`, `getModules`, `getModule`, `getApi`, `getService`, `getDependencies`, `getDependents`, `getConfiguration`, `getArchitecture`, `getDecisions`, `getConstraints`, `getCurrentWork`, `getStatus`, `getHistory`.

Name lookups (`getModule`, `getApi`, `getService`) return `undefined` when nothing matches rather than throwing — a tool probing an unfamiliar application should degrade gracefully, not crash.

`createWriteInterface(app, grants)` returns a `NexoWriteInterface` with:

`createModule`, `createApi`, `modifyApi`, `createService`, `modifyService`, `updateConfiguration`, `addDependency`.

Each call is a `{ success, data?, error? }` result — never a throw — and runs through **Permission Check → Validation → Operation → Audit** (PRD section 18/20). `grants` is a `PermissionGrants` (`{ scopes: Set<"modify-source" | "modify-configuration"> }`) the caller constructs explicitly; there is no ambient or default-allow permission. Every call, whether denied, failed validation, or successful, is recorded via `app.addHistoryEntry()` and readable back through `getHistory()`.

`createVerificationInterface(app)` returns a `NexoVerificationInterface` with:

`validateConfiguration`, `validateArchitecture`, `inspectDependencies`, `checkApplicationHealth` — the in-memory subset of PRD section 19's "Verification Capabilities." `validateArchitecture` detects dependency cycles and self-dependencies (errors) and dependency names that don't resolve to a registered module (a warning, not an error — it may be an external system like `"stripe"`). `validateConfiguration` flags config values that won't survive `JSON.stringify` cleanly (functions, circular references). These are read-only diagnostics and are not audited to history, unlike the write interface. `run_tests`/`run_typecheck`/`run_lint`/`run_build` from PRD section 19 are **not implemented** — they'd need to shell out to an external target application's own toolchain via an explicit project-root argument, and this repo has no lint tooling configured to call yet; left for a future pass once that's needed.

## Design notes

- **Explicit, bounded, auditable.** Per PRD section 20, write operations never bypass a permission check, and every attempt — granted or not — is audited. Actually running tests/lint/build (PRD section 19, "Verification Capabilities") is out of scope here; it's a separate tooling concern layered on top of a successful write.
- **camelCase**, consistent with the rest of Nexo's API, even though early product docs sketched these as snake_case (`get_application()`) — that was pseudocode-level, not a literal contract.

## Related packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — the application/module model
- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — the JSON manifest this package wraps

## Status

**v0.1-alpha.** No MCP server or CLI wiring yet — this is the interface those will eventually sit on top of. `create_test()` and the verification ops (`run_tests`, `run_lint`, etc.) from the PRD are not implemented yet.

## License

MIT

# Architecture Notes — v0.3

## Current model

```text
Application
   |
   +-- Modules
        +-- APIs
        +-- Services
        +-- Jobs (declaration only)
        +-- Events (declared names)
        +-- Dependencies (declared names)
```

`NexoApplication` registers `NexoModule`s and drives their lifecycle
(`initialize` -> `start`, then `stop` in reverse registration order).

Each `NexoModule` may optionally declare `purpose`, `status`,
`dependencies` (names of other modules or external systems),
`apis`, `services`, `events`, and `jobs`. `NexoApplication` exposes
query methods over this metadata:

- `getDependencies(name)` / `getDependents(name)` — the dependency
  graph in both directions. Dependencies are informational only in
  this milestone; a name doesn't have to resolve to a registered
  module (it may be an external system like `"stripe"`).
- `getApis()` / `getServices()` — flattened across all modules.
- `getConfig(key)` — reads from the plain config object passed to
  `createApplication({ config })`.
- `events` — a `NexoEventBus` (thin wrapper over Node's built-in
  `node:events.EventEmitter`) for `on`/`off`/`emit`. No automatic
  wiring — modules must call it explicitly.

Jobs (`NexoJob`) are declaration-only in this milestone: `name`,
`description`, `schedule`. There is no scheduler or executor yet —
that belongs to a later Scalability phase.

## Context manifest

`@nexo/context` is the first package built *on* `@nexo/core` rather than
inside it. Its `buildContext(app)` reads only `@nexo/core`'s existing
public surface (identity, `getModules()`, `getDependents()`) and produces
a plain, JSON-serializable `ApplicationContext`: application identity +
per-module metadata (`purpose`, `status`, `dependencies`, `dependents`,
`apis`, `services`, `events`, `jobs`), with `dependents` computed rather
than stored. `contextToJson()` renders it to formatted JSON. Optional
fields absent on the source module (e.g. no `status`) are omitted from
the context object entirely, not included as `undefined`, so the object
round-trips cleanly through `JSON.stringify`/`JSON.parse`.

This is the manifest a future CLI (`nexo inspect`/`nexo status`) or AI
interface will read — it does not itself talk to a CLI, HTTP, or AI
provider.

## Dependency direction rule

`@nexo/core` must depend only on the Node.js runtime. It must never depend on:

- an AI provider or SDK
- Hapi (or any HTTP framework)
- the CLI
- a database
- cloud services

Later packages depend **on** core, never the reverse:

```text
@nexo/hapi  --> @nexo/core
@nexo/cli   --> @nexo/core
@nexo/tools --> @nexo/core
```

## v0.3 boundary

In scope: everything from v0.2, plus `@nexo/context`'s application
context manifest (derived facts only: identity, architecture,
dependency graph).

Not yet: Hapi adapter, CLI, dependency injection, job
scheduler/executor, config validation/env loading, AI/MCP interface,
database, cloud, autonomous agent operations, the "Components" concept
from the PRD (undefined in the docs for a backend-first framework, so
deferred rather than guessed at), and — deliberately split out of the
Context milestone — **decisions, constraints, and development state**.
Those are human-authored intent/state records (PRD section 42: FACT vs
INTENT), not derivable from registered module objects; they need their
own data model and a place to live on `NexoApplication` and are planned
as v0.4. See `plan.txt` and `phase.txt` for the full phased roadmap.

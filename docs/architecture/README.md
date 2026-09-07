# Architecture Notes — v0.2

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

## v0.2 boundary

In scope: Application, Module, Service, API, Job, Lifecycle, Errors,
Events (plain pub/sub), dependency graph queries, basic configuration.

Not yet: Hapi adapter, CLI, Context system, dependency injection,
job scheduler/executor, config validation/env loading, AI/MCP
interface, database, cloud, autonomous agent operations, and the
"Components" concept from the PRD (undefined in the docs for a
backend-first framework, so deferred rather than guessed at). See
`plan.txt` and `phase.txt` for the full phased roadmap.

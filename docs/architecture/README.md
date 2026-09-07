# Architecture Notes — v0.5

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

## Decisions, constraints, development state

Alongside modules, `NexoApplication` now holds application-level (not
per-module) knowledge records: `addDecision()`/`getDecisions()`
(`NexoDecision`: `title`, `reason?`, `alternatives?`, `status?`),
`addConstraint()`/`getConstraints()` (`NexoConstraint`: `description`,
`reason?`), and `setDevelopmentState()`/`getDevelopmentState()`
(`DevelopmentState`: `currentObjective?`, `completed`, `inProgress`,
`blocked`, `knownIssues`, `nextStep?`). `setDevelopmentState` shallow-merges
a partial patch into the current snapshot — array fields are replaced
wholesale by the caller, not appended to, since this models "where
development currently stands," not an append-only log.

These complete Phase 3 (Context) as scoped in `plan.txt`: `@nexo/context`'s
`buildContext()` now also surfaces `decisions`, `constraints`, and
`developmentState` in the manifest, using the same
omit-rather-than-`undefined` discipline as module metadata.

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

## AI/tooling read interface

`@nexo/tools` is the second package built *on* `@nexo/core`/`@nexo/context`
(`@nexo/tools → @nexo/context → @nexo/core`, plus `@nexo/tools → @nexo/core`
directly for types). `createReadInterface(app)` returns a `NexoReadInterface`
— the structured, provider-neutral "Understand" capability set from PRD
section 17: `getApplication`, `getModules`, `getModule`, `getApi`,
`getService`, `getDependencies`, `getDependents`, `getConfiguration`,
`getArchitecture`, `getDecisions`, `getConstraints`, `getCurrentWork`,
`getStatus`. Every method is thin wiring over existing `NexoApplication`/
`@nexo/context` calls — no new business logic. Lookups by name
(`getModule`, `getApi`, `getService`) return `undefined` when not found
rather than throwing, since a tool probing an unfamiliar application
should degrade gracefully.

**Naming:** the PRD writes these as snake_case (`get_application()`);
this implementation uses camelCase to stay consistent with the rest of
Nexo's API surface. The PRD's names are pseudocode-level, not a literal
contract.

**Read-only, by design:** matching `phase.txt`'s "read-only first"
guidance, there are no `createModule()`/`modifyApi()`-style write
operations here — those need permissions/validation/audit (Phase 5,
"Safe Development Operations") that don't exist yet.

**Known gap:** `get_history()` from PRD section 17 is not implemented —
there is no History/changelog data model anywhere in Nexo yet. Left for
a future milestone once such a model exists, rather than inventing one
just to fill this method.

`getAllConfig()` was added to `NexoApplication` (alongside the existing
`getConfig(key)`) so `getConfiguration()` has a full config bag to read.

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

## v0.5 boundary

In scope: everything from v0.4, plus `@nexo/tools`'s read-only AI/tooling
interface. This is Phase 4 (AI Interface) from `plan.txt`, read-side only.

Not yet: Hapi adapter, CLI, dependency injection, job
scheduler/executor, config validation/env loading, write/mutation AI
operations (`createModule`/`modifyApi`/etc. — Phase 5, "Safe Development
Operations," needs permissions/validation/audit that don't exist),
`get_history()` (no History data model yet), database, cloud,
autonomous agent operations, and the "Components" concept from the PRD
(undefined in the docs for a backend-first framework, so deferred
rather than guessed at). Next up per `plan.txt`/`phase.txt` is the CLI
(`nexo inspect`/`nexo status`) that will consume this same manifest for
human developers.

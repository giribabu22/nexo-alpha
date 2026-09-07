# Architecture Notes — v0.7

**npm scope note:** packages publish under `@nexo-alpha` (an npm Organization), not `@nexo` — the unscoped `@nexo` scope required an org that wasn't set up in time; `nexo-alpha` was used instead and is treated as the project's real published identity going forward. All package names below reflect this.

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

These complete Phase 3 (Context) as scoped in `plan.txt`: `@nexo-alpha/context`'s
`buildContext()` now also surfaces `decisions`, `constraints`, and
`developmentState` in the manifest, using the same
omit-rather-than-`undefined` discipline as module metadata.

## Context manifest

`@nexo-alpha/context` is the first package built *on* `@nexo-alpha/core` rather than
inside it. Its `buildContext(app)` reads only `@nexo-alpha/core`'s existing
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

`@nexo-alpha/tools` is the second package built *on* `@nexo-alpha/core`/`@nexo-alpha/context`
(`@nexo-alpha/tools → @nexo-alpha/context → @nexo-alpha/core`, plus `@nexo-alpha/tools → @nexo-alpha/core`
directly for types). `createReadInterface(app)` returns a `NexoReadInterface`
— the structured, provider-neutral "Understand" capability set from PRD
section 17: `getApplication`, `getModules`, `getModule`, `getApi`,
`getService`, `getDependencies`, `getDependents`, `getConfiguration`,
`getArchitecture`, `getDecisions`, `getConstraints`, `getCurrentWork`,
`getStatus`. Every method is thin wiring over existing `NexoApplication`/
`@nexo-alpha/context` calls — no new business logic. Lookups by name
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

## CLI

`@nexo-alpha/cli` is the human-facing counterpart to `@nexo-alpha/tools`
— both read the same `buildContext()` manifest, `@nexo-alpha/tools` shaped
for an AI tool's structured calls, `@nexo-alpha/cli` rendering it as
readable terminal text. It depends on `@nexo-alpha/core` and
`@nexo-alpha/context` directly (not `@nexo-alpha/tools`), since it needs
the manifest, not the AI-shaped wrapper around it.

**How it finds an application:** Nexo has no project scaffold or
config-file convention yet, so the CLI takes an explicit path to a
compiled JS module that exports a `NexoApplication` as `app` (or
`default`) and dynamically `import()`s it — `nexo inspect ./dist/app.js`.
A config-file convention (so `nexo inspect` alone works from a project
root) can layer on top later without changing the render/command logic.

Commands: `nexo inspect <app-path> [moduleName]` (application summary,
or one module's full detail), `nexo status <app-path>` (development
state), `nexo context <app-path>` (raw JSON manifest dump). All argument
parsing is hand-rolled (`process.argv`) rather than a CLI-argument
library, since there are no flags to parse — keeping `@nexo-alpha/cli`
at zero runtime dependencies beyond the two workspace packages.

The render (`render.ts`) and command (`commands.ts`) layers are pure
functions returning strings — no direct `console.log`/`process.exit` —
so they're testable without capturing stdout; only `cli.ts` (the actual
bin entry) touches process-level I/O.

`examples/hello-world` was split into `src/app.ts` (declares and exports
`app`, no side effects) and `src/index.ts` (imports it, calls `start()`,
logs — same runtime behavior as before) so the CLI has a side-effect-free
target to inspect; importing `app.js` for inspection no longer
accidentally starts the application or prints its lifecycle logs.

## Hapi adapter

`@nexo-alpha/hapi` is the **first package with a real external runtime
dependency** (`@hapi/hapi`) — everything before it (including
`@nexo-alpha/core`) stayed dependency-free by design. This is the
intended split: `@nexo-alpha/core` gained one small, Hapi-agnostic
addition — `NexoRequestContext` (`params`/`query`/`payload`/`headers`)
and an optional `NexoApi.handler: (context) => unknown | Promise<unknown>`
— so an API can describe *how* to handle a request without core
knowing anything about Hapi. `@nexo-alpha/hapi` is what actually turns
that into a running server.

`createHapiServer(app, options?)` builds a `Hapi.server(...)` and, for
every API returned by `app.getApis()` **that has a `handler`**,
registers a route: method, path (converted from `:param` to Hapi's
`{param}` syntax via `toHapiPath()`), and a wrapper that builds a
`NexoRequestContext` from the Hapi request and calls the handler,
returning its result directly (Hapi serializes plain objects to JSON)
or a `204` for `undefined`. APIs with no `handler` are skipped — they
stay purely descriptive, same as in the context manifest and CLI.
`HEAD` is also skipped: Hapi auto-generates HEAD responses from GET
routes and rejects HEAD as an explicit route method.
`startHapiServer(app, options?)` is `createHapiServer` + `server.start()`.

This closes Nexo's biggest functional gap up to this point — before
this milestone, nothing in the framework could actually serve an HTTP
request despite Hapi being named as the framework's HTTP foundation in
the PRD. Verified with a real listening server and a live `fetch()`
against it (not just Hapi's `server.inject()` in tests), using
`examples/hello-world`'s new `GET /hello` API.

## Dependency direction rule

`@nexo-alpha/core` must depend only on the Node.js runtime. It must never depend on:

- an AI provider or SDK
- Hapi (or any HTTP framework)
- the CLI
- a database
- cloud services

Later packages depend **on** core, never the reverse:

```text
@nexo-alpha/hapi  --> @nexo-alpha/core
@nexo-alpha/cli   --> @nexo-alpha/core
@nexo-alpha/tools --> @nexo-alpha/core
```

## v0.7 boundary

In scope: everything from v0.6, plus `@nexo-alpha/hapi` — real HTTP
routes wired from `NexoApi.handler`s.

Not yet: a project-level config convention (so the CLI/Hapi adapter can
find an app without an explicit path), dependency injection, job
scheduler/executor, config validation/env loading, write/mutation AI
operations (`createModule`/`modifyApi`/etc. — Phase 5, "Safe Development
Operations," needs permissions/validation/audit that don't exist),
`get_history()` (no History data model yet), request validation/auth
on Hapi routes (currently every handler-backed API is wired with no
input validation or auth — that's Phase 5/PRD section 32 territory,
not this milestone), database, cloud, autonomous agent operations, and
the "Components" concept from the PRD (undefined in the docs for a
backend-first framework, so deferred rather than guessed at).

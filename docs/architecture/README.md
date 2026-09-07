# Architecture Notes — v0.17

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

Jobs (`NexoJob`): `name`, `description`, `schedule`, and an optional
`run` behavior hook — mirroring `NexoApi.handler`. `NexoApplication`
also gained `getJobs()`, flattening jobs across modules the same way
`getApis()`/`getServices()` already do. Actually executing jobs is
`@nexo-alpha/scheduler`'s job (below), not core's — core only declares.

## Decisions, constraints, development state (superseded — see v0.17 boundary)

> **This section describes the Phase 3 design, when these records lived on
> `NexoApplication` itself.** As of the v0.17 boundary below, they were
> extracted out of `@nexo-alpha/core` entirely and now live in
> `@nexo-alpha/context`'s `createKnowledge()` container. The API shapes
> described here are unchanged — only their package/owner moved. Read this
> section for the *shape*, and "Knowledge extraction and serialization"
> under the v0.17 boundary for *where it lives now*.

Alongside modules, application-level (not per-module) knowledge records
were tracked: `addDecision()`/`getDecisions()` (`NexoDecision`: `title`,
`reason?`, `alternatives?`, `status?`), `addConstraint()`/`getConstraints()`
(`NexoConstraint`: `description`, `reason?`), and
`setDevelopmentState()`/`getDevelopmentState()` (`DevelopmentState`:
`currentObjective?`, `completed`, `inProgress`, `blocked`, `knownIssues`,
`nextStep?`). `setDevelopmentState` shallow-merges a partial patch into the
current snapshot — array fields are replaced wholesale by the caller, not
appended to, since this models "where development currently stands," not
an append-only log.

These completed Phase 3 (Context) as scoped in `plan.txt`: `@nexo-alpha/context`'s
`buildContext()` surfaces `decisions`, `constraints`, and `developmentState`
in the manifest (when a `knowledge` instance is passed to it), using the
same omit-rather-than-`undefined` discipline as module metadata.

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

`getAllConfig()` was added to `NexoApplication` (alongside the existing
`getConfig(key)`) so `getConfiguration()` has a full config bag to read.

## Safe write operations (Phase 5)

Phase 5, "Safe Development Operations," closes the biggest structural
gap from `phase.txt`: PRD section 18's write ops (`create_module`,
`create_api`, `modify_api`, `create_service`, `modify_service`,
`update_configuration`, `add_dependency`) now exist, gated by the
pipeline PRD section 18 specifies — `Request → Permission Check →
Validation → Operation → Audit`.

The split follows the existing core/tools boundary:

- **`@nexo-alpha/core`** gained raw, unguarded mutators on
  `NexoApplication` — `addApiToModule`/`updateApi`,
  `addServiceToModule`/`updateService`, `updateConfig`,
  `addModuleDependency` — plus, at the time, a `History` data model
  (`NexoHistoryEntry`: `timestamp`, `operation`, `target?`, `actor?`,
  `result: "success" | "denied" | "failed"`, `detail?`) with
  `addHistoryEntry()`/`getHistory()`, living directly on `NexoApplication`.
  **This is now superseded** — as of the v0.17 boundary, `NexoHistoryEntry`
  and its accessors moved to `@nexo-alpha/context`'s `createKnowledge()`,
  alongside decisions/constraints/development state, for the same reason:
  core stays a dumb, trusted structural model, and doesn't know what a
  "permission," a "decision," or an audit trail is.
  `create_module()` needed no new core method — the existing
  `.module()` registration call already covers it.
- **`@nexo-alpha/tools`** gained `createWriteInterface(app, grants)`,
  parallel to `createReadInterface`. Each of its seven methods runs
  Permission Check (against a caller-supplied `PermissionGrants` —
  `{ scopes: Set<"modify-source" | "modify-configuration"> }`, no
  ambient/default-allow) → Validation → the matching core mutator →
  an `addHistoryEntry()` audit call, for every outcome (denied, failed
  validation, or success) — not just successes. Results are a plain
  `{ success, data?, error? }` object, never a throw, so an agent loop
  can branch on the outcome without try/catch. `getHistory()` was also
  added to `NexoReadInterface` so the audit trail PRD section 17 asks
  for is actually readable.

**Still out of scope:** PRD section 18's `create_test()` and section 19's
verification ops (`run_tests`, `run_typecheck`, `run_lint`, `run_build`,
etc.) — running actual project tooling is a distinct concern from
structural mutation and is left for the Phase 6/7 tooling work. No CLI
subcommands or Hapi routes were added for the write interface either —
it's a library API at the same level as the read interface today.

## Verification capabilities (in-memory subset)

PRD section 19 lists eight ops. Four of them are pure, in-memory checks
over the `NexoApplication` model and are now implemented as a third
`@nexo-alpha/tools` factory, `createVerificationInterface(app)`, parallel
to the read/write interfaces: `validateConfiguration`,
`validateArchitecture`, `inspectDependencies`, `checkApplicationHealth`
(`packages/tools/src/verification-interface.ts`). No `@nexo-alpha/core`
changes were needed — everything is built from existing
`NexoApplication` methods (`getModules`, `getDependencies`,
`getDependents`, `getAllConfig`, `getApis`, `getServices`, `state`).

`validateArchitecture` walks the dependency graph with a standard
visiting/done DFS to detect cycles, flags a module depending on itself
as an error, and flags a dependency name that doesn't resolve to a
registered module as a **warning** (not an error — the existing model
already allows a dependency to name an external system like `"stripe"`,
so this surfaces the fact without treating it as invalid). Once a cycle
is found, its member nodes are marked `"done"` in the traversal state so
the same cycle isn't reported once per node it passes through when the
outer loop later visits them as a fresh starting point.
`validateConfiguration` checks `getAllConfig()` for JSON-serialization
hazards: a circular value is an error (`JSON.stringify` would throw), a
function-valued key is a warning (it silently disappears under
`JSON.stringify` rather than erroring, which could hide a real value
from anything reading config as JSON, like `@nexo-alpha/context`'s
manifest). These are read-only diagnostics and do not call
`addHistoryEntry()` — auditing applies to state-changing operations, not
to running a check.

**Deliberately deferred, and why:** `run_tests`/`run_typecheck`/
`run_lint`/`run_build` need to shell out to an **external target
application's** own toolchain (the app being built with Nexo — same
target the read/write interfaces and `@nexo-alpha/cli`'s
`loadApplication` operate on), which needs an explicit project-root
argument and command-detection. This repo also has **no lint tooling
configured anywhere** (no ESLint config in any package) to call as a
reference implementation. Building this now, ahead of the still-pending
project-config-convention work, risks plumbing that gets thrown away
once that convention exists.

## CLI

`@nexo-alpha/cli` is the human-facing counterpart to `@nexo-alpha/tools`
— both read the same `buildContext()` manifest, `@nexo-alpha/tools` shaped
for an AI tool's structured calls, `@nexo-alpha/cli` rendering it as
readable terminal text. It depends on `@nexo-alpha/core` and
`@nexo-alpha/context` directly (not `@nexo-alpha/tools`), since it needs
the manifest, not the AI-shaped wrapper around it.

**How it finds an application:** the CLI takes an explicit path to a
compiled JS module that exports a `NexoApplication` as `app` (or
`default`) and dynamically `import()`s it — `nexo inspect ./dist/app.js`
(`load-application.ts`) — or, if no path is given, discovers one via the
`nexo.config.json` project config convention (below). Adding the
convention required no changes to the render/command logic, as
anticipated when the CLI first shipped.

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

## Project config convention

`packages/cli/src/config.ts` adds `nexo.config.json` as a project-root
config file, closing the gap `docs/architecture/README.md` had flagged
since the CLI first shipped. Shape: `{ "app": "./dist/app.js" }`.
`findNexoConfig(startDir)` walks upward from `startDir` (`existsSync`
per directory) until it finds the file or reaches the filesystem root;
`resolveConfiguredAppPath(startDir)` reads and `JSON.parse`s it, then
resolves `app` **relative to the config file's own directory** (not
`process.cwd()`), so the same config works no matter which subdirectory
`nexo` is invoked from. JSON rather than a JS config file, deliberately
— discovery stays a plain read + parse with no dynamic-import/ESM-CJS
interop concerns, consistent with Nexo's existing preference for plain
declarative data (the application model, the context manifest) over
executable config.

Making the CLI's app-path argument optional created a real parsing
ambiguity for `inspect`, which also takes an optional module name: is a
single trailing argument a path or a module name? Resolved by only
falling back to config when **no positional path-shaped argument is
given at all**, and moving `inspect`'s module name behind a `--module`
flag in that case — `nexo inspect ./dist/app.js payments` (explicit
path + module, unchanged) vs. `nexo inspect --module payments` (config
+ module). This keeps every existing positional form in
`cli.ts`/`test/cli-bin.test.js` working exactly as before; the new
behavior only triggers when the first argument after the command is
either absent or starts with `--`.

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

## Request validation and auth

Closes the gap flagged since the Hapi adapter shipped: every
handler-backed route ran with zero input validation and no
authentication. PRD section 32 ("Security Requirements") specifies a
request pipeline of `Identity → Permission → Context Boundary →
Validation → Operation → Audit`; this implements the Identity,
Permission, and Validation steps.

`@nexo-alpha/core` stays dependency-free (no Joi, no JWT library), so
both concerns are modeled as plain function hooks on `NexoApi`
(`packages/core/src/api.ts`) — the same pattern already used for
`handler`, not a framework-specific schema: `auth?: NexoApiAuth`
(`{ required, scopes? }`, declarative) and `validate?:
NexoRequestValidator` (a function, since arbitrary validation logic —
not just a static shape check — needs to run, returning
`NexoValidationOutcome`). The actual verification (decode a JWT, check
an API key, run a Joi schema, whatever) is supplied by the caller, not
by Nexo — `createHapiServer`'s new `options.authenticate:
NexoAuthenticator` is where that plugs in, once per server.

If any API declares `auth.required` but no `authenticate` option was
passed, `createHapiServer` rejects immediately, before registering any
routes — the same "explicit, bounded" principle as Phase 5's permission
checks: a route that silently ships with no way to enforce its declared
auth requirement is worse than a loud failure at startup. Per request,
the route wrapper in `packages/hapi/src/create-server.ts` runs
Identity/Permission (`authenticate` → `401` if unauthenticated, `403`
if any of `auth.scopes` is missing — all required, not any) **before**
Validation (`validate` → `400` with `errors` if invalid) before the
existing handler call. Auth before validation matches both the PRD's
ordering and standard security practice: an unauthenticated caller
shouldn't learn anything about payload shape from a `400`.

**Deliberately not doing:** no Joi/JWT dependency was added; no wiring
of these HTTP requests into `NexoApplication.addHistoryEntry()` — Phase
5's History model tracks AI *development* mutations
(`create_module`/`modify_api`/etc.), and mixing in live HTTP traffic
would blur that meaning. A separate request-audit feature could reuse
the same `History` type later without conflating the two.

## Job execution (Phase 7)

Closes another long-flagged gap: `NexoJob` was declaration-only, with
no scheduler or executor anywhere. `packages/core/src/job.ts` gained
one optional behavior hook, `run?: NexoJobRunner`, mirroring
`NexoApi.handler`'s "declarative metadata + optional function" pattern
exactly; `NexoApplication.getJobs()` flattens jobs across modules the
same way `getApis()`/`getServices()` already do.

Actual execution is a new package, `@nexo-alpha/scheduler` — the same
reason `@nexo-alpha/hapi` exists as a separate package from core: core
must never import timer/scheduling logic. Unlike Hapi, this package
needed zero *new* dependencies to justify a split; the split exists
purely to keep the dependency direction rule intact (below). `schedule`
is standard 5-field cron syntax — already a de facto assumption in one
existing test fixture (`*/5 * * * *`) — parsed by a small hand-rolled
engine in `packages/scheduler/src/cron.ts` (`parseCronExpression`,
`getNextRunTime`) rather than a dependency, consistent with how the CLI
already hand-rolls argv parsing and config discovery instead of pulling
in libraries. It supports the practical subset of cron (`*`, exact
values, `*/step`, comma lists, `a-b` ranges with an optional `/step`)
with standard day-of-month/day-of-week OR semantics, not the full POSIX
spec.

`createJobScheduler(app, options?).start()` parses every job with both
`schedule` and `run` up front — if any is malformed, `start()` throws
immediately, before scheduling *any* job, same "explicit, bounded"
fail-fast principle as Phase 5's permission checks and the Hapi
adapter's auth-configuration check. Each job then gets a single
`setTimeout` computed from `getNextRunTime`; on fire, `run()` is called
and immediately rescheduled for its next occurrence regardless of
outcome — a thrown/rejected `run()` is routed to an optional
`onError(job, error)` rather than ever crashing the scheduler. `stop()`
clears every pending timer. The one non-default seam is an injectable
`clock` (`now`/`setTimeout`/`clearTimeout`), used only so the package's
own tests can drive time deterministically instead of waiting on real
minute boundaries — not a production feature. As with the Hapi server,
there's no wiring into `NexoApplication.start()`/`stop()`; creating and
starting the scheduler is a separate, explicit step.

**Deliberately not doing:** no persistence, retry-on-crash, or
distributed/multi-process coordination — a fresh process starts every
schedule clean, consistent with how the rest of Nexo keeps declared
state in code rather than a database. (`createJob`/`modifyJob` job
mutators followed in a later pass — see "Job mutators" below.)

## Job mutators

Closes the one asymmetry left after job execution shipped: `@nexo-alpha/
core` had `addApiToModule`/`updateApi` and `addServiceToModule`/
`updateService`, but no job equivalent. `NexoApplication` gained
`addJobToModule`/`updateJob`, mirroring those two pairs exactly (same
duplicate-name/missing-module errors, same "replace the module's array"
approach to updates), and `@nexo-alpha/tools`'s write interface gained
`createJob`/`modifyJob` (operations `create_job`/`modify_job`), mirroring
`createService`/`modifyService` exactly — same `modify-source` permission
requirement, same Permission Check → Validation → Operation → Audit
pipeline, same `{ success, data?, error? }` result shape. No new design
decisions were needed; this was purely applying an already-established
pattern to the one place it hadn't reached yet.

## Observability

Scopes "Phase 8 — Observability" down to what's concretely useful now:
event emission plus in-process counters, reusing `NexoEventBus`
(`app.events`, `packages/core/src/events.ts`) — which existed since
early on but nothing ever emitted or listened on it until this pass.
Tracing/spans/correlation IDs are out of scope; no tracing library
exists anywhere in the workspace and it's a materially bigger feature.

The event contract itself is pure data declared in core — `NexoEvent`
name constants plus `ApiCalledEvent`/`ApiErrorEvent`/`JobRanEvent`/
`JobFailedEvent` payload types (`packages/core/src/events.ts`) — the
same "declare the shape in core, behave in the adapter" split as
`NexoApiHandler`/`NexoJobRunner`. `NexoEventBus` itself didn't need to
change; it's still a plain string-keyed emitter.

`@nexo-alpha/hapi`'s route handler now measures elapsed time and routes
every outcome (401/403/400, and the final handler result) through one
`respond()` helper that emits `api.called` with the real status code —
so even auth/validation denials are visible traffic, not silent. The
handler call itself is now wrapped in try/catch: on throw, it emits
`api.error` with the message and **rethrows**, so Hapi's own default
`500` handling is unchanged from before this pass (nothing previously
wrapped the handler call at all). `@nexo-alpha/scheduler`'s `runJob`
emits `job.ran`/`job.failed` around each execution, additively — the
existing `onError` callback still fires exactly as before.

`@nexo-alpha/tools` gained a fourth interface, `createMetricsCollector
(app)`, alongside read/write/verification. Unlike those three (stateless,
computed fresh from `app` on every call), this one is necessarily
**stateful**: it subscribes to `app.events` at creation time and
accumulates per-API/per-job call counts, error/failure counts, and
average durations in a closure, computed on `getMetrics()`. `stop()`
unsubscribes every listener it registered — the event bus has no other
consumer that ever unsubscribes today, so a leaked collector (e.g. in a
test) would otherwise accumulate listeners forever.

**Deliberately not doing:** tracing/spans; wiring `checkApplicationHealth()`
together with metrics (kept as two independent concerns — static
structural health vs. live runtime counters — rather than overloading
one method's return shape); metrics persistence across restarts
(in-memory only, same stance as the scheduler's own no-persistence
design); a CLI command to display metrics.

## Lifecycle failure semantics

Closes a long-standing gap in `NexoApplication.start()`/`stop()`: until now,
a module throwing mid-lifecycle (e.g. `initialize()` rejects) left `_state`
stuck at an in-transit value (`"initializing"`/`"stopping"`) forever, since
both methods only guard entry (`start()` requires `"created"`/`"stopped"`;
`stop()` requires `"running"`) and neither wrapped its loop in a `try/catch`.
The application became permanently unstartable/unstoppable with no signal
of *why* beyond the original thrown error, and no observable difference
between "still working" and "died mid-initialize."

`ApplicationState` gained a fifth value, `"failed"`. Both `start()`'s
initialize/start loops and `stop()`'s stop loop are now wrapped in
`try/catch`: on a thrown/rejected error, `_state` is set to `"failed"`
before rethrowing the original error unchanged (not wrapped in
`NexoLifecycleError` — the failure is the module's, not a lifecycle-API
misuse). No new guard code was needed to keep the application from being
restarted or stopped again from `"failed"` — the existing entry guards
already reject any state other than their required one, so `"failed"`
falls through to the same `NexoLifecycleError` path as `"initializing"`
or `"stopping"` would. `state`/`checkApplicationHealth()` (verification
interface) and the context manifest all just pass `app.state` through
with no exhaustive switch anywhere in the workspace, so `"failed"` needed
no changes outside `application.ts` to surface correctly.

**Deliberately not doing:** no automatic rollback of modules already
initialized/started before the failure (no `initialize`/`start` symmetry
with a defined "undo" — a module doesn't declare how to undo its own
`initialize()`). A recovery path out of `"failed"` was deferred at first
per `phase.txt`'s guidance to only add what's justified by a strong
reason — see "Lifecycle recovery (`reset()`)" below for why one was
added shortly after.

New tests: `packages/core/test/lifecycle.test.js` — invalid transitions
(`stop()` from `"created"`, `start()` while `"initializing"`/`"stopping"`,
idempotent no-ops from `"running"`/`"stopped"`), failure semantics (a
throw during `initialize()`/`start()`/`stop()` each land on `"failed"`,
with the partial-progress event log asserted; the application then
rejects further `start()`/`stop()` calls), and multi-module ordering
(initialize/start in registration order, stop in reverse) — the last of
these was previously only exercised with a single module.

## Lifecycle recovery (`reset()`)

Once `"failed"` shipped, the application had no way back to a usable
state short of the caller constructing a brand new `NexoApplication` and
re-registering every module — a real gap for anything long-running (a
server process, a scheduler host) where a single module's transient
`initialize()`/`start()`/`stop()` failure shouldn't require a full
process restart. That's the "strong reason" the earlier section deferred
on.

`NexoApplication.reset()` is only valid from `"failed"` (any other state
throws `NexoLifecycleError`, consistent with every other lifecycle
guard). It does **not** attempt a rollback — since core doesn't know
which modules completed `initialize()`/`start()` before the failure, it
instead does the same best-effort cleanup a normal `stop()` would: call
`stop()` on every registered module, in reverse registration order,
tolerating each one throwing or being a no-op for a module that never
actually started. Errors encountered during that cleanup are collected
and **returned**, not thrown — `Promise<readonly Error[]>` — since a
caller recovering from a failure needs to see every cleanup problem, not
just the first, and a `reset()` that itself throws would leave the
application back in `"failed"` with no way out. On success (with or
without cleanup errors) the state becomes `"stopped"`, so `start()` can
be called again immediately.

**Deliberately not doing:** no automatic retry of `start()` after
`reset()` (the caller decides whether/when to retry — Nexo doesn't
assume the failure was transient), and no `addHistoryEntry()` call from
`reset()` itself — same reasoning as `start()`/`stop()` not auditing
themselves: `History` tracks AI-driven structural mutations made through
`@nexo-alpha/tools`'s write interface, not core's own lifecycle
operations. A tools-level wrapper that audits `reset()` calls can be
added later if an operational use case needs it.

New tests (`packages/core/test/lifecycle.test.js`): `reset()` rejected
from every non-`"failed"` state; a failed application resets to
`"stopped"` and can be started again (and can fail and be reset again);
cleanup errors from a module's `stop()` during `reset()` are collected
and returned rather than thrown.

## Process-shelling verification ops (run_tests/run_typecheck/run_build)

Closes the second half of PRD section 19's verification ops. The
in-memory four (`validateConfiguration`, `validateArchitecture`,
`inspectDependencies`, `checkApplicationHealth`) shipped earlier; the
other four — `run_tests`, `run_typecheck`, `run_lint`, `run_build` —
were explicitly deferred at the time because they need a project-root
argument and command-detection, "ahead of the still-pending
project-config-convention work." That convention (`nexo.config.json`,
`packages/cli/src/config.ts`) has since shipped, so the stated reason to
wait no longer applies.

A new `@nexo-alpha/tools` factory, `createRunInterface(projectRoot)`
(`packages/tools/src/run-interface.ts`), implements three of the four:
`runTests()`, `runTypecheck()`, `runBuild()`. Each shells out
(`node:child_process.spawn`, `shell: true`) to the target project's own
`test`/`typecheck`/`build` npm script, detecting the package manager
from the lockfile present in `projectRoot` (`pnpm-lock.yaml` -> pnpm,
`yarn.lock` -> yarn, otherwise npm) — the same lockfile-sniffing
approach used nowhere else in the codebase yet, but the only
dependency-free way to pick a package manager without asking the caller
to specify one. Before spawning anything, the target's `package.json`
`scripts` are read and checked for the requested script name; a missing
script returns a failed `RunResult` immediately (`exitCode: null`,
descriptive `stderr`) rather than letting `npm run <missing>` produce
its own, less useful "Missing script" error — same "explicit, bounded
failure" principle used elsewhere (the Hapi adapter's auth-configuration
check, the scheduler's up-front cron parse). `RunResult` never throws
for a failing/missing script — `{ success, command, exitCode, stdout,
stderr, durationMs }` — only a genuinely missing `package.json` in
`projectRoot` rejects, since that's a caller error (wrong path), not a
target-project failure the caller is asking to observe.

**`run_lint()` is deliberately not implemented** — same reasoning as
when the other three were first deferred: there is no lint tooling
configured anywhere in this repo to use as a reference convention (no
ESLint config in any package), so building it now would mean guessing
at a convention rather than following one that already exists.

**`projectRoot` is a caller-supplied argument, not discovered by
`@nexo-alpha/tools` itself** — the package stays decoupled from the
CLI's `nexo.config.json` convention; a caller that already knows the
project root (the CLI, or an AI tool given an explicit path) passes it
directly. This mirrors `createWriteInterface(app, grants)` taking its
permission grants as an explicit argument rather than discovering them
ambiently.

**Deliberately not doing:** no CLI subcommand wiring (`nexo test`,
`nexo build`, etc.) — same stance the write interface shipped with:
"it's a library API at the same level as the read interface today." No
streaming output (stdout/stderr are buffered and returned whole once the
process exits, not surfaced incrementally) — a streaming variant is a
different interface shape (callback or async-iterable) better designed
against a real long-running-build use case than speculatively built now. No
timeout/cancellation — a caller that needs to bound run time can layer
`AbortController`/`Promise.race` externally; `NexoRunInterface` doesn't
yet have a documented cancellation contract to guess at.

New tests: `packages/tools/test/run-interface.test.js`, against two
fixture projects (`packages/tools/fixtures/run-passing`,
`run-failing`) with real `test`/`build` npm scripts — a passing script
exit, a failing script exit with captured `stderr`, a missing script
(`runTypecheck` against a fixture with no `typecheck` script), and a
missing `package.json` rejecting. These spawn real child processes
(`npm run <script>`), not mocked child-process calls, so they verify the
actual detection/spawn/capture path end to end.

## Dependency direction rule

`@nexo-alpha/core` must depend only on the Node.js runtime. It must never depend on:

- an AI provider or SDK
- Hapi (or any HTTP framework)
- the CLI
- a database
- cloud services

Later packages depend **on** core, never the reverse:

```text
@nexo-alpha/context   --> @nexo-alpha/core
@nexo-alpha/hapi      --> @nexo-alpha/core
@nexo-alpha/scheduler --> @nexo-alpha/core
@nexo-alpha/tools     --> @nexo-alpha/core, @nexo-alpha/context
@nexo-alpha/cli       --> @nexo-alpha/core, @nexo-alpha/context, @nexo-alpha/tools
```

## v0.17 boundary

In scope:
- **Core Decoupling**: Extracted `NexoDecision`, `NexoConstraint`, `DevelopmentState`, and `NexoHistoryEntry` out of `@nexo-alpha/core` and into `@nexo-alpha/context` under the `createKnowledge()` container.
- **Application Mutation Lifecycle Gating**: Enforced `assertModifiable()` on `NexoApplication` (`module`, `addApiToModule`, `updateApi`, `addServiceToModule`, `updateService`, `addJobToModule`, `updateJob`, `updateConfig`, `addModuleDependency`) to reject modifications when running.
- **Lifecycle Events**: Core `NexoApplication` emits lifecycle events (`application.initializing`, `application.started`, `application.stopping`, `application.stopped`, `application.failed`, `application.reset`).
- **Adapter Lifecycle Binding**: `@nexo-alpha/hapi` (`startHapiServer`) and `@nexo-alpha/scheduler` (`startJobScheduler`) automatically stop when `app.stop()` is invoked.
- **Scheduler Domain Errors**: Added typed `NexoCronError` extending `NexoError`.
- **API-to-Service Links & Verification**: Added optional `service?: string` to `NexoApi` and architecture validation in `@nexo-alpha/tools`.
- **CLI Commands Expansion**: Added `nexo validate` and `nexo health` to `@nexo-alpha/cli`.
- **Knowledge Serialization**: `@nexo-alpha/context/knowledge.ts` gained `knowledgeToJson(knowledge)`/`knowledgeFromJson(json)` plus a `SerializedKnowledge` type (`decisions`, `constraints`, `developmentState`, `history`, `generatedAt`, `schemaVersion`) so a knowledge journal can round-trip through a plain JSON string. Serialization is caller-driven — the functions don't touch the filesystem themselves. `nexo knowledge [app-module-path]` (added to `@nexo-alpha/cli`) is the first caller: it prints `knowledgeToJson()`'s output to stdout, the same way `nexo context` does for the full manifest, so a project can persist its decision journal with `nexo knowledge > .nexo/knowledge.json` and reload it into a fresh `createKnowledge()` with `knowledgeFromJson` in its own app module. Round-trip is lossy only by design: history entries are re-stamped with a fresh `timestamp` on `addHistoryEntry`, matching that method's existing contract, not a serialization bug.
- **Registry-Derived Structure**: `@nexo-alpha/context/context.ts` gained `describeStructure(app)` / `hashStructure(structure)` and a new `ApplicationStructure` shape (`moduleCount`, `apiCount`, `serviceCount`, `jobCount`, `dependencyEdges` — sorted, so the hash doesn't depend on module registration order). This is the "what does the registry currently look like" half of knowledge, derived entirely from `NexoApplication`'s existing public surface — no source parsing. `buildContext()` now always includes `structure` and a `structureHash` in its output (no `knowledge` argument required), `createReadInterface()` exposes the same pair via `getStructure()`, and `nexo knowledge`'s JSON snapshot embeds both alongside the manual journal, so a saved snapshot carries a way to detect whether the application's registered structure has since changed (`structureHash` no longer matches a freshly computed one) — the first piece of the staleness-detection story the decisions/constraints/history journal alone couldn't provide.

- **Source-Text Extraction (first slice)**: `@nexo-alpha/tools` gained `createSourceInterface(projectRoot)` (`source-interface.ts`), which walks a project's actual source tree (default extensions `.ts`/`.tsx`/`.js`/`.jsx`, skipping `node_modules`/`dist`/`build`/`coverage`/`.git`/`.turbo`/dotfiles) and, per file, extracts a best-effort list of top-level exported symbol names via regex — `export function/class/interface/type/enum/const/let/var`, `export { a, b as c }` lists, and bare `export default`. `sourceTreeHash()` hashes the result deterministically for the same staleness-detection purpose as `hashStructure()`. `nexo source [project-root]` (default: cwd) is the CLI surface — the one command that doesn't load a Nexo application at all, since it reads files directly rather than the registry.

  This closes the gap the "not yet" note below used to describe, but only partially, on purpose: it is a regex scan, not a real parser — it can't resolve `export * from "./x"` re-exports to their underlying names, doesn't understand comments or string literals well enough to avoid rare false positives, and (at this point) extracts no call graph or cross-file symbol resolution. A first-slice import graph was added next (below). A real AST-based, fully module-resolved code graph, possibly with embeddings for semantic search, remains future, larger-scoped work.

- **Source Tree Folded into Context**: `SourceFile`/`SourceTree` and `hashSourceTree()` moved to live in `@nexo-alpha/context` (not `@nexo-alpha/tools`, which only re-exports them) so `ApplicationContext` can carry an optional `sourceTree`/`sourceTreeHash` without `@nexo-alpha/context` ever depending on `@nexo-alpha/tools` — dependencies still only point one way. `buildContext(app, knowledge?, sourceTree?)` takes the scan as a plain value rather than doing its own file I/O, keeping the function synchronous and pure; the caller (today, the CLI) does the actual async scan and hands the result in. `nexo context [app-module-path] --source-root <path>` is the first caller: passing `--source-root` folds a live source-tree scan into the same manifest `nexo context` already produces, so one command answers both "what's registered with the application" and "what's actually in the files." Omitting the flag skips the scan entirely — unlike `structure`, which is free, reading files is real I/O, so it stays opt-in. `nexo source` remains available on its own for scanning a directory that isn't a Nexo application at all.

- **First-Slice Import Graph**: `SourceFile` gained `imports` (raw specifiers as written — `"./widget.js"`, `"node:fs"`, `"@nexo-alpha/core"` — unresolved), and `SourceTree` gained `importEdges`: relative imports resolved to another file within the same scan. Resolution tries the specifier as written, then strips any extension it already has and retries against every tracked extension — which is what makes `"./widget.js"` resolve to an actual `widget.ts` file, the exact `.js`-specifier/`.ts`-source convention this repo uses everywhere under `NodeNext` module resolution — then finally tries it as a directory `index` file. A bare package specifier is recorded per-file but never turned into an edge, since resolving it fully would mean replicating Node's `node_modules` resolution algorithm; this is a literal, file-level import graph, not a symbol-level one (a re-export chain shows as separate edges, not the transitive origin). `hashSourceTree()` now covers `imports`/`importEdges` too. No CLI surface changed — `imports`/`importEdges` ride along automatically wherever a `SourceTree` already appeared (`nexo source`, `nexo context --source-root`).

- **Test Fixtures Moved Out From Under `test/`**: `packages/cli/test/fixtures` and `packages/tools/test/fixtures` moved to `packages/cli/fixtures` and `packages/tools/fixtures` (siblings of `test/`, not nested inside it). Node's test runner treats *any* `.js`/`.ts` file under a directory literally named `test` as a test file to execute, regardless of its own name — so raw fixture files like `fixtures/app.js` and the source-interface sample files were silently being run as phantom passing tests all along. It surfaced as a real failure once `nested/gadget.js`'s fixture content (added for the import-graph work above) contained a relative import Node's own module loader couldn't resolve when executing the fixture directly. Moving fixtures out of any `test/`-named directory is the durable fix — it doesn't depend on shell glob behavior in each package's `test` script, which would otherwise need to differ (and be gotten right) per platform.

### v0.16 boundary (superseded)

In scope: everything from v0.14, plus lifecycle failure semantics (the
`"failed"` `ApplicationState`, `start()`/`stop()` failure handling),
lifecycle recovery (`reset()`), the new `lifecycle.test.js` suite
covering invalid transitions, failure semantics, multi-module ordering,
and `reset()`, a GitHub Actions CI workflow
(`.github/workflows/ci.yml`, running `pnpm install --frozen-lockfile` ->
`build` -> `typecheck` -> `test` on every push/PR to `main` — previously
nothing gated merges), and bringing the root `README.md` up to date with
the actual package set and `@nexo-alpha` scope (it had been left at its
original `@nexo/core`-only, v0.1-alpha description since the repository's
first commit).

### v0.14 boundary (superseded)

In scope: everything from v0.13, plus observability (`api.called`/
`api.error`/`job.ran`/`job.failed` events through `NexoEventBus`,
`@nexo-alpha/tools`'s `createMetricsCollector`) and job mutators
(`addJobToModule`/`updateJob` in core, `createJob`/`modifyJob` on
`@nexo-alpha/tools`'s write interface).

Not yet: tracing/spans/correlation IDs, the same config convention for
the Hapi adapter (it still takes explicit `createHapiServer(app,
options?)` options — could reuse `resolveConfiguredAppPath` later),
dependency injection, job persistence/distributed coordination, config
validation/env loading, `create_test()` and the process-shelling
verification ops (`run_tests`/`run_typecheck`/`run_lint`/`run_build` —
need a project-root argument and, for lint, tooling this repo doesn't
have configured yet), an HTTP-request audit trail (Phase 5's `History`
model covers development mutations, not live traffic — separate from
the new observability events, which are ephemeral, not persisted),
database, cloud, autonomous agent operations, and the "Components"
concept from the PRD (undefined in the docs for a
backend-first framework, so deferred rather than guessed at).

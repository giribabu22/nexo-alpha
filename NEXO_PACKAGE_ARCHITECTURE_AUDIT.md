# Nexo-Alpha Package Architecture Audit

- **Date:** 2026-10-07
- **Branch / version:** `feat/full-stack-0.7`, all packages at `0.7.0`
- **Scope:** all 15 packages in `packages/`, the 4 examples, the `create-nexo-app` templates and the code-to-intent benchmark.
- **Method:** I read every `package.json` and grepped every `import` in `src/` and `test/`. I counted runtime exports by importing each built `dist/index.js`. I read the source behind each claim below; the links point at it. No code was changed.

---

## 1. Executive Summary

**Verdict.** Nexo is not yet one framework. It is two frameworks that share a monorepo, plus some experiments spread across several packages.

| Part | Packages | State |
|---|---|---|
| **A. A full stack built on resources** | `core` (model, resource, auth, files, storage), `hapi`, `frontend` (+ `data`, a re-export) | **Coherent and real.** One `model()` drives TypeScript types, validation, storage, REST, a typed client, forms and tables. The benchmark measures **731 → 90 LOC (−88%)** across 7 features ([RESULTS.md](benchmarks/code-to-intent/RESULTS.md)). |
| **B. The AI layer** | `context`, `tools`, `behavior`, `decision`, `agent`, `web`, `integrations` | **Some pieces are sound** (`decision`, the agent's tool/verifier loop, `context`'s manifest). But the layer **cannot see Part A**. No file in `context`, `tools`, `agent`, `decision`, `cli` or `hapi` references `NexoModel` or `NexoResource`. |
| **C. Experiments that cut across packages** | DSC in 7 packages; token optimisation; `web` | Little use, or none, outside examples. Some of them **report capabilities they do not have.** |

So the question "is this a new kind of full-stack, AI-native framework?" gets two answers today:

- **Full stack: yes.** The Resource is already the centre, and it works.
- **AI-native: not yet.** An AI connected to a Nexo app can see modules, APIs and a journal of decisions. It cannot ask "what resources exist, what fields do they have, which operations can I call, and with what permissions?" `resource()` already knows every one of those answers.

**The single most important recommendation:** do not add packages. Connect Part B to the Resource the way Part A already is:

- `context` describes resources;
- `agent` derives typed tools from resources;
- `decision` gates those tools with the resources' existing scopes;
- the CLI and the frontend's introspection views read the same manifest.

### Critical findings (P0)

1. **The built-in AI judgments are made up.**
   - `LocalBehaviorProvider` always returns the first option, `true`, or 85% of the maximum, each with 0.88–0.95 confidence ([local-provider.ts:23-37](packages/behavior/src/provider/local-provider.ts#L23-L37)).
   - `JevBehaviorProvider` swallows network errors and returns the same canned answers ([jev-provider.ts:41-62](packages/behavior/src/provider/jev-provider.ts#L41-L62)).
   - Result: `agent.research("anything")` with defaults returns hard-coded "React 20" mock search results marked **verified** with status `SUCCESS` ([pipeline.ts:11](packages/web/src/research/pipeline.ts#L11)).
   - The repo has no real model provider.
2. **There are two request pipelines, and they disagree.**
   - `app.dispatch()` runs authenticator → scopes → `validate` → **middleware** → handler ([application.ts:494](packages/core/src/application.ts#L494)).
   - `@nexo-alpha/hapi` runs its own auth → scopes → validate/**schema** → project → rate limit → handler, and **never calls `app.useMiddleware()` middleware**.
   - The core README presents middleware as general request logging ([core/README.md:209](packages/core/README.md#L209)).
   - Any future adapter would have to re-implement about 300 lines of that logic.
3. **The AI layer cannot see resources** (above). `ModuleContext` has no model or fields ([context.ts:17-30](packages/context/src/context.ts#L17-L30)), and `NexoTool` has no input schema ([tool-registry.ts:48](packages/agent/src/tool-registry.ts#L48)).
4. **Decisions are allowed by default.** A `DecisionEngine` with no rules returns `APPROVE` ([engine.ts:172](packages/decision/src/engine.ts#L172)). The agent will run any registered tool unless someone adds rules. Tool `permissions` only take effect if `toolPermissionRule` is installed.

**Other high-impact findings:**

- New projects install 11 packages, 6 of which they never import.
- "Knowledge" means four different things in four packages.
- Four different things are called "verify".
- `@nexo-alpha/tools` puts `typescript` into every production app that only wants metrics.
- The frontend's introspection hooks call `/api/health` and `/api/knowledge`, which no package provides.

**Package-level dependency cycles: none.** Conceptual cycles (types copied between packages): 5. See §17.

---

## 2. Nexo-Alpha Architectural Philosophy

These are the principles the code actually follows. They are inferred from the implementation, not from the README.

| Principle | Where the code honours it | Where it breaks |
|---|---|---|
| **Declare as data, so everything can be inspected.** | `NexoModule` metadata, `NexoApi.schema`, `NexoFieldSchema`, `model()` fields, `resource()` options | The inspection side (`context`) reads modules but not models or resources. |
| **One declaration, many uses.** | `model()` is used by the server, the browser (`core/model`), forms, tables and the resource client. | Agent tools, the context manifest and frontend dashboards each re-declare shapes. |
| **The LLM proposes, deterministic rules decide.** | `agent`: parser → `decision` → tool → verifier ([agent.ts](packages/agent/src/agent.ts)) | Rules allow by default; the `behavior` providers make up the "LLM" side. |
| **Return results instead of throwing at the AI.** | `ToolResult`, `WriteOperationResult` | Fine. |
| **Core knows nothing about AI.** | `core` has no runtime dependencies. | `core` exports DSC mirror interfaces copied from `behavior` ([dsc-plugin.ts:22](packages/core/src/dsc-plugin.ts#L22)), plus `NexoDecision`/`NexoConstraint` (an AI "knowledge" concept). |
| **Adapters point inward.** | `hapi → core`; paths use the neutral `:param` syntax (`toHapiPath`) | The request semantics live inside the adapter (finding 2). |

**The problem Nexo is uniquely positioned to solve** (§6 of the brief): a domain object is declared once. From that one declaration, the code already derives the database, API, validation, client and UI. The missing step is to derive, from the same declaration, a **machine-readable, permission-gated capability that an AI can discover, call and verify**.

Other frameworks do one half:

- Rails, Django, Prisma and tRPC do the first half.
- Agent frameworks such as LangChain do the second half, but against hand-written tools.

Nexo's opening is the **join between them**. Today the join is missing.

---

## 3. Current Package Inventory

Columns: src = lines of source; tests = lines of tests; runtime exports = names exported by `dist/index.js`.

| Package | src | tests | runtime exports | Runtime deps (declared) | Dev deps on `@nexo-alpha/*` | Peer |
|---|---:|---:|---:|---|---|---|
| core | 5,957 | 3,058 | 82 | — | — | — |
| data | 94 | 43 | 28 | core | — | — |
| context | 933 | 574 | 14 | core | — | — |
| tools | 2,723 | 1,682 | 20 | core, context, **typescript** | hapi | — |
| hapi | 424 | 982 | 5 | core, @hapi/hapi | — | — |
| scheduler | 1,019 | 707 | 8 | core | — | — |
| webhooks | 334 | 202 | 7 | core, scheduler | — | — |
| behavior | 2,590 | **344** | 31 | — | — | — |
| decision | 1,233 | 640 | 11 | core, context | — | — |
| web | **208** | **45** | 4 | core, context, behavior | — | — |
| agent | 2,903 | 2,273 | 22 | core, context, decision, behavior, web | hapi, scheduler | — |
| integrations | 229 | 162 | 2 | agent | decision | — |
| frontend | 7,496 | 1,756 | 112 | core | agent, decision, hapi, scheduler | react, react-dom (optional) |
| cli | 1,358 | 915 | 15 | core, context, tools | — | — |
| create-nexo-app | 2,476 | 256 | 4 | — | — | — |
| **Total** | **~30k** | **~13.6k** | **~371** | | | |

Public surface: about 371 runtime exports, plus many types. `frontend` (112) and `core` (82) account for 52% of them.

---

## 4. Actual Dependency Graph

### 4.1 Runtime dependencies (from manifests, checked against imports)

```text
                                   @hapi/hapi          typescript
                                       │                   │
 behavior (no deps)          ┌──────── hapi          tools ┤
     ▲   ▲                   │                        │  │  │
     │   └──────── web ──────┼─(context)              │  │  │
     │              ▲        │                        │  │  │
     │              │        ▼                        ▼  │  │
     └──────────── agent ──► core ◄── context ◄───────┘  │  │
                    │  ▲      ▲  ▲       ▲  ▲             │  │
     integrations ──┘  │      │  │       │  └── decision ◄┘? │
                       │      │  │       │        ▲          │
                       └──────┼──┼───────┼────────┘          │
                              │  │       └──────── cli ──────┘
          data ───────────────┘  │                  │
          scheduler ─────────────┤        cli ──► tools, context, core
          webhooks ──► scheduler ┘
          frontend ──► core (types + /model entry only)
          create-nexo-app ──► (none)
```

The same graph as a table, which is easier to check:

| Package | → runtime deps | Actually imported? |
|---|---|---|
| core | — | (`node:*` only) |
| behavior | — | (`node:crypto`) |
| context | core | yes |
| data | core | yes (re-exports only) |
| hapi | core, @hapi/hapi | yes |
| scheduler | core | yes |
| webhooks | core, scheduler | yes (type-only) |
| frontend | core | yes (**type-only** plus `core/model`) |
| tools | core, context, typescript | yes |
| cli | core, context, tools | yes |
| decision | core, **context** | core yes (`scopeMatches`); **context never imported**. `DecisionContext.context` is typed `Record<string, unknown>` ([types.ts:103-106](packages/decision/src/types.ts#L103-L106)). |
| web | **core**, context, behavior | **core never imported**; context and behavior are type-only, plus `createBehaviorEngine` |
| agent | core, context, decision, behavior, web | yes. **web** is pulled in only for `agent.research()`. |
| integrations | agent | **type-only** (`import type { AgentToolkit, NexoTool }`) |
| create-nexo-app | — | the templates are strings |

Layers by depth:

- **0:** core, behavior, create-nexo-app
- **1:** context, data, hapi, scheduler, frontend
- **2:** tools, decision, web, webhooks
- **3:** cli, agent
- **4:** integrations

### 4.2 Development dependencies (tests only)

`agent → hapi, scheduler` · `frontend → agent, decision, hapi, scheduler` · `tools → hapi` · `integrations → decision`.

These are integration tests that cross packages. They are fine, and none of them forms a cycle.

### 4.3 Peer and optional dependencies

- `frontend` has `react` and `react-dom` as optional peers. This is correct: `@nexo-alpha/frontend/client` works without React.
- No other package uses peers.
- **Should become peers or type-only:**
  - `integrations → agent`: it only needs types.
  - `agent → web`: it is only needed for one method.

### 4.4 Conceptual dependencies (no manifest entry; copied types or URL contracts)

| From | To | Mechanism | Evidence |
|---|---|---|---|
| core, context, scheduler, agent, hapi (via core) | behavior (DSC) | "Minimal interface mirror" | [dsc-plugin.ts:22](packages/core/src/dsc-plugin.ts#L22), [dsc-context.ts:20](packages/context/src/dsc-context.ts#L20), [dsc-scheduler.ts:30](packages/scheduler/src/dsc-scheduler.ts#L30) |
| agent | scheduler | `WorkflowJobQueue` mirrors `NexoJobQueue` | [workflow-api.ts:60](packages/agent/src/workflow-api.ts#L60) |
| tools (metrics) | agent, scheduler | `WorkflowEventLike`, `JobQueueEventLike` | [metrics-interface.ts:59-70](packages/tools/src/metrics-interface.ts#L59-L70) |
| frontend | agent, tools | `WorkflowRun`, `MemoryEntry`, `NexoMetricsSnapshot` re-declared by hand | [frontend/memory.ts:8](packages/frontend/src/memory.ts#L8) vs [agent/memory.ts:16](packages/agent/src/memory.ts#L16) |
| frontend | *nobody* | calls `/api/health` and `/api/knowledge`, which only templates and examples write by hand | [client.ts:229-233](packages/frontend/src/client.ts#L229-L233) |
| context | tools | `SourceTree`/`CallEdge` types live in context but exist for tools | [context.ts:60-67](packages/context/src/context.ts#L60-L67) |
| core ↔ context | — | `NexoDecision` and `NexoConstraint` are defined **twice**, with different fields | [core/knowledge.ts](packages/core/src/knowledge.ts) (4 fields) vs [context/knowledge.ts:1](packages/context/src/knowledge.ts#L1) (6 fields) |

---

## 5. Package Responsibility Matrix

| Package | Layer (actual) | Primary responsibility | Problem solved | Depends on | Used by (runtime) | User-facing? | Required? |
|---|---|---|---|---|---|---|---|
| core | Kernel + Data + Auth + Infra utilities | App and module registry, lifecycle, DI, events. **Also** model, resource, storage, files, accounts, JWT, tenancy, rate limits, resilience, logger, DSA, DSC mirrors | Structure plus the whole CRUD data path | — | everything except behavior and create-nexo-app | **Yes** (heavily) | **Yes** |
| data | Facade | Re-exports core's data layer | Gives the data layer one name | core | — (no template or example uses it) | Optional | No |
| context | Understanding | JSON manifest of the registry, plus a journal of decisions, constraints, intents and history | Gives an AI or a person the app's shape without reading files | core | decision (declared), tools, web, agent, cli | Tooling-facing | AI tier |
| tools | Developer tooling | Read, write, verify, run, scan source, knowledge graph, **metrics** | Introspection, code graph, impact analysis | core, context, typescript | cli | Mostly via the CLI; metrics are imported by apps | No |
| hapi | HTTP adapter **plus the request pipeline** | Serves `NexoApi`s; auth, validation, tenancy, rate limits, error mapping | Running an HTTP server | core | — | Yes (one call) | Yes, to serve HTTP |
| scheduler | Jobs | Cron executor and a persistent at-least-once queue | Background work | core | webhooks | Yes | Optional |
| webhooks | Outbound events | Subscriptions, HMAC signing, retried delivery | Notifying external systems | core, scheduler | — | Yes | Optional |
| behavior | AI judgment, **plus** DSC, **plus** token utilities | Bounded `choice`/`score`/`boolean` questions sent to a provider | Cheap, typed LLM micro-decisions (in intent) | — | web, agent | Low | No |
| decision | AI policy | Deterministic rules → APPROVE / REJECT / ASK_USER / ESCALATE / DEFER; RBAC | Deterministic gate on actions | core | agent | Yes (rules) | AI tier |
| agent | AI runtime | Intent → decision → tool → verify; workflows, memory, audit, toolkits | Running AI actions safely | core, context, decision, behavior, web | integrations | Yes | AI tier |
| web | AI knowledge source | Search → evidence → "verify" | Web research | context, behavior | agent | Low | No |
| integrations | Toolkits for external services | GitHub and Slack as `AgentToolkit` | Giving the agent outside capabilities | agent (types) | — | Yes | Optional |
| frontend | Client and UI | HTTP and resource client, hooks, forms and tables, auth UI, router, components, **AI/dev dashboards**, **DSA** | Removes client-side plumbing | core (types, model) | — | **Yes** | For full stack |
| cli | Developer tooling | `nexo inspect / graph / impact / generate / doctor …` | Inspecting and scaffolding from the terminal | core, context, tools | — | Yes (binary) | Recommended |
| create-nexo-app | Scaffolding | Project templates | Starting a project | — | — | Yes (npx) | Once |

---

## 6. Package-by-Package Analysis ("Why does this exist?")

### core

- **Purpose:** application kernel, and in practice also the data layer.
- **Problem:** structure, lifecycle and DI, plus model → validation → storage → REST.
- **Why separate:** it is the foundation and has no dependencies.
- **Consumers:** every package and every app.
- **Dependencies:** none. **Dependents:** 12 of 14.
- **Boilerplate it removes:**
  - Declaring entity shapes 3–4 times (TS interface, schema, frontend interface): `model()` replaces this.
  - Hand-written CRUD routes, 404 and 409 handling, pagination and search: `resource()` replaces this.
  - Auth flows: `createAuth`, which the benchmark measures at 181 → 10 LOC.
  - Upload plumbing.
- **What breaks if removed:** everything.
- **Could it merge?** No.
- **Is it doing more than one job?** Yes. It does about 12, among them:
  - kernel;
  - data;
  - accounts;
  - token auth;
  - tenancy;
  - files;
  - rate limiting;
  - resilience;
  - logging;
  - DSA utilities (`topoSort`, `memoize`, `CountingMap`);
  - DSC mirror interfaces;
  - a **dead** decisions/constraints store: `app.addDecision()` has no callers other than a duck-type check in [load-application.ts:23](packages/cli/src/load-application.ts#L23), and `context` owns the real one.
- **Recommended status:**
  - Keep the implementation in core. This matches the standing decision that `data` stays a re-export.
  - Remove the dead knowledge store.
  - Make DSA and DSC internal.
  - Absorb the request pipeline from `hapi` (P0).

### data

- **Purpose:** gives the data layer its own name.
- **Problem:** discoverability ("where is the data layer?").
- **Why separate:** naming only; it holds 94 lines of re-exports.
- **Consumers:** none yet. No template, example or benchmark imports it.
- **Boilerplate it removes:** none of its own.
- **What breaks if removed:** nothing internal.
- **Could it merge?** It already is core.
- **Recommended status:** keep it as decided, but treat it as **the first facade**. Decide on the facade strategy (§27/§36) before promoting it. Until then the docs show AI agents two import paths for the same symbols, which costs tokens and causes confusion.

### context

- **Purpose:** a machine-readable application manifest, plus a journal (decisions, constraints, intents, history, development state).
- **Why separate:** it is pure data shapes and builders, with no I/O. That makes it the stable contract between the app and AI or tooling.
- **Consumers:** cli, tools, agent, web, and decision (declared but unused).
- **Boilerplate it removes:** hand-written architecture docs and ad-hoc "describe the app" prompts.
- **Gap:** the manifest describes **modules and APIs**, not **resources, models, events, tools or permissions** (§26).
- **Could it merge with tools?** No. The boundary is pure manifest versus I/O-heavy analysis, and it is justified.
- **Recommended status:** keep it. Make it the **single application description** (§26).

### tools

- **Purpose:** a set of interfaces for developer tooling and coding agents:
  - read (13 getters wrapping app + context);
  - write (structural mutations plus journal writes);
  - verify (architecture lint);
  - run (`pnpm test/typecheck/build`);
  - source scan (TypeScript AST);
  - knowledge graph, trace and impact;
  - **metrics** (Prometheus).
- **Problems:**
  1. **The name collides** with the agent's `NexoTool` and `ToolRegistry`. They are a different concept with the same word.
  2. **The structural write interface acts on the in-memory registry.** That registry only accepts changes while the app is `created` or `stopped` ([application.ts:89](packages/core/src/application.ts#L89)), and changes are never saved to source. So a coding agent's `createApi()` does not survive a restart, and a runtime agent cannot use it on a running app. Only the journal writes (`recordDecision`, `recordIntent`) are durable and useful.
  3. **Metrics is runtime observability** in a package whose runtime dependency on `typescript` is there for source scanning. Production apps import `@nexo-alpha/tools` only for metrics ([support-desk/app.ts:46](examples/support-desk/src/app.ts#L46), the agent-service template) and pay for the TypeScript install.
- **Recommended status:**
  - Move metrics out to core (no deps).
  - Deprecate the structural write operations; the CLI generators write real files instead.
  - Consider renaming to `devtools` (P2).

### hapi

- **Purpose:** the HTTP adapter.
- **Problem it should solve:** mapping Nexo APIs onto a Hapi server.
- **What it also does:** owns the request semantics (finding 2).
- **What breaks if removed:** HTTP serving.
- **Recommended status:** keep it, but thin it to roughly 120 lines once core owns the pipeline (§12).

### scheduler

- **Purpose:** a cron executor for `NexoJob.schedule`, plus a persistent queue with leases, CAS claims, retries and backoff.
- **Why separate:** optional infrastructure with its own failure semantics. Not every app has background work.
- **Boilerplate it removes:** home-grown cron, retry and lease logic.
- **Recommended status:** keep it as optional. Its `dsc-scheduler` variant should go with the DSC clean-up.

### webhooks

- **Purpose:** outbound webhook delivery: subscriptions in a document store, HMAC `t=…,v1=…` signatures with a ±300 s tolerance, stable delivery IDs, retries through the scheduler's queue.
- **Gaps:**
  - Nothing connects it to resource changes or the app event bus automatically; you wire `onChange` → `dispatch` by hand.
  - On the inbound side there is only `verifyWebhookSignature`. There is no receiver module.
- **Recommended status:** keep it; add the event bridge and an inbound receiver (§14).

### behavior

- **Purpose:** bounded LLM micro-decisions. You define `choice`, `score` and `boolean` questions; a provider answers them; policies (`route`, `verify`, `retry`, `complete`, `escalate`) build on them.
- **It also bundles two unrelated things:**
  - **DSC**: a plan/resolve/execute/verify/write operation pipeline with an LRU cache and dedupe. This is general memoisation and instrumentation, not "behavior".
  - **Token optimisation**: compressor, prompt cache, budget guard, selective injector. It is used only inside `BehaviorEngine`, which never reaches a real LLM.
- **Critical:** both shipped providers make up their answers (finding 1). Test coverage is 344 lines for 2,590 lines of source.
- **Recommended status:**
  - Keep the concept: an "LLM judgment" layer, deliberately separate from `decision`.
  - Ship one real, SDK-free provider adapter.
  - Make the default provider refuse rather than invent answers.
  - Move DSC out (§24).

### decision

- **Purpose:** a deterministic policy engine and RBAC.
- **Why separate:** usable without the agent, e.g. for HTTP actions or approvals. It is also the trust boundary.
- **Boilerplate it removes:** hand-rolled permission and state checks before each action.
- **Problems:**
  - Allows everything by default.
  - An unused dependency on `context`.
  - Context and knowledge are typed `Record<string, unknown>`.
- **Recommended status:** keep it. Deny by default when used by the agent, and drop the `context` dependency.

### agent

- **Purpose:** the AI runtime. It runs `IntentParser` → `DecisionEngine` → `ToolRegistry` → `VerifierRegistry`, with retries, audit, workflows (stored, served over HTTP, queued), memory and toolkits.
- **Why separate:** it is the only package that sequences AI steps.
- **Boilerplate it removes:** writing the agent loop, audit trail and workflow persistence by hand.
- **Gaps:**
  - The KNOW step is not wired: `run()` passes the parser only `availableActions` ([agent.ts:264](packages/agent/src/agent.ts#L264)), not the app context, memory or resources.
  - Tools have no input schema.
  - There is no link from resources to tools.
  - It has a runtime dependency on `web`.
- **Recommended status:** keep it. Make it **resource-aware** (§25).

### web

- **Purpose:** search → evidence → verification.
- **Reality:** 208 lines.
  - The default provider is a mock.
  - Relevance and credibility scores are constants (`0.85`, and `0.9` for `https`).
  - Verification goes through the made-up behavior provider.
  - The `sufficient` result is computed and then ignored.
- **Recommended status:** **quarantine.**
  - Require a provider and remove the mock default.
  - Remove the agent's runtime dependency on it.
  - Then either make it real as a toolkit or merge it into `integrations` (§16, §24).

### integrations

- **Purpose:** GitHub and Slack exposed as `AgentToolkit`s.
- **Problem:** each one exists **only** as agent tools. Calling GitHub from a resource's `onChange` means building a fake `DecisionIntent`.
- **Recommended status:** keep it. Split each integration into a **plain client** plus a **toolkit adapter**, and make `agent` an optional peer.

### frontend

- **Purpose:** the HTTP and resource client, plus React hooks, forms, tables, auth UI, router and components.
- **What else it contains:**
  - Seven AI and developer dashboards: workflow runs, memory browser, DSC dashboard, knowledge inspector, module graph, metrics, terminal.
  - About 18 exported DSA utilities (bloom filter, heap, trie, LRU, ring buffer and others).
- **Boilerplate it removes:** per-entity interfaces, fetch/loading/error/refetch state, forms, tables and session handling.
- **Problems:**
  - 112 runtime exports serving three audiences: app UI, studio UI and internals.
  - Server contracts re-declared by hand.
  - Calls introspection endpoints that no package serves.
- **Recommended status:** keep it as a single package. Split it by **subpath** (`/client` already exists; add `/studio`), and make DSA internal.

### cli

- **Purpose:** the `nexo` binary. It has inspection commands (inspect, status, context, knowledge, intents, source, graph, freshness, search, trace, impact, validate, health), plus `generate`, `doctor`, and an `init` that points you to `npx create-nexo-app`.
- **Boundary:** correct. It operates on an existing project.
- **Gaps:**
  - Only `doctor` has `--json`.
  - Nothing inspects resources.
  - No `dev` or `build`.
- **Recommended status:** keep it. Make it the AI's efficient entry point (§21).

### create-nexo-app

- **Purpose:** bootstraps a project. It has no runtime deps, so `npx` is fast.
- **Boundary:** correct.
- **Problem:** the `backend-api` and `fullstack-react` templates list agent, behavior, decision, scheduler, tools and web as dependencies but never import them. Each of those names appears exactly once in the template, in the manifest.
- **Recommended status:** keep it. Install only what the template imports.

---

## 7. Core vs Optional Packages

The table is derived from what each kind of app must import.

| Tier | Packages | Evidence |
|---|---|---|
| **Kernel (always)** | core | The only package every other package depends on |
| **Serve HTTP** | + hapi | core has no server; `minimal` template = core + hapi |
| **Full stack** | + frontend | Benchmark full-stack features import only core, core/model and frontend |
| **Developer tooling** | cli (dev dep), create-nexo-app (npx) | Not runtime |
| **Background / outbound** | scheduler, webhooks | Optional; no other runtime package needs them except webhooks → scheduler |
| **AI tier** | context, decision, agent | `agent` requires a `DecisionEngine`; `context` provides knowledge |
| **AI add-ons** | integrations, web, behavior | Behavior is pulled in by agent today; it should be optional once providers are real |
| **Tooling internals** | tools | Through the CLI |
| **Facade** | data | — |

---

## 8. Human Developer Architecture

### Full-stack lifecycle, mapped to the packages that are actually used

```text
Developer
  │ npx @nexo-alpha/create-nexo-app my-app      ← create-nexo-app (templates)
  ▼
Project (shared/, backend/, frontend/ workspaces)
  │ nexo doctor / nexo generate resource order   ← cli
  ▼
shared/order.model.ts   model("orders", {...})   ← core/model (browser-safe)
  │
  ├─► backend:  resource(Order, { store, auth }) ← core (resource, storage, auth)
  │             app.module(orders)               ← core (registry, lifecycle)
  │             startHapiServer(app)             ← hapi (HTTP + request pipeline)
  │
  └─► frontend: useResource(Order)               ← frontend (client, hooks)
                <NexoForm model={Order}/> <NexoResourceTable model={Order}/>
```

**The developer has to understand:** `model`/`field`, `resource`, `createApplication` + `app.module`, `startHapiServer`, `useResource`/`NexoForm`/`NexoResourceTable`, and `createAuth`. That is **3 packages and about 8 concepts**. This half of the framework meets the brief's goal (§23).

### Where it gets harder

| Need | What the developer must learn today |
|---|---|
| Custom (non-resource) endpoint | `api.get(...)` in core; on the frontend, `useApi(path)` with a hand-written response type (no contract) |
| Ownership (only my orders) | `beforeWrite` for writes; **reads have no per-caller filter** (resource auth is scope-only) |
| React to changes | `onChange` callback; manual wiring to webhooks or the queue |
| Background job | scheduler (new package, new concepts) |
| AI over the same data | context + decision + agent; hand-write one `NexoTool` per operation, with no schema (§9) |

---

## 9. AI Developer Architecture

The questions from §8 of the brief, answered from the code:

| Question | Answer today | Evidence |
|---|---|---|
| How does an AI discover the app? | `nexo context` / `buildContext(app, knowledge, sourceTree)`: identity, modules, APIs (with `schema` if declared), services, jobs, declared events, dependency edges, journal, optional source scan | [context.ts:321](packages/context/src/context.ts#L321) |
| How does it learn the available capabilities? | **Partially.** HTTP APIs appear inside modules. Resources appear only as a module with five APIs and **no model fields**. Agent tools appear only as `tools.actions` (names only). | [agent.ts:264](packages/agent/src/agent.ts#L264) |
| How does it decide what to do? | An `IntentParser` maps text to a `DecisionIntent`. The built-in parsers are regex or step parsers; an LLM parser must be supplied by the user. | [understand.ts](packages/agent/src/understand.ts) |
| How does it act safely? | `DecisionEngine` rules. **Allow by default**; permissions apply only with `toolPermissionRule`. Tools validate their own payloads by hand. | [engine.ts:172](packages/decision/src/engine.ts#L172) |
| How does it verify? | `VerifierRegistry` (deterministic, user-written), with retries steered by `behavior.retry` (made up by default) | [agent.ts:237](packages/agent/src/agent.ts#L237) |
| How is it constrained? | Decision rules, RBAC, tool timeouts, workflow `allowedActions` / `maxSteps`, audit | agent/workflow.ts |
| How does it save tokens? | The `context` manifest, the hash-gated knowledge graph and `nexo impact` / `nexo trace` (real and useful); `behavior` token utilities (unused in practice) | §21 |
| What metadata can it read? | The manifest, the journal, the knowledge graph (files, symbols, imports, calls, modules, APIs), metrics, audit trails | — |
| **What is missing?** | 1. Resources and models in the manifest. 2. Tool input schemas. 3. Tools derived from resources. 4. A real LLM provider. 5. JSON output from the CLI. 6. Context and memory passed into `run()`. 7. Deny-by-default. | — |

**Is there an intentional "AI understanding layer"?** Yes. `context` (what exists) + `tools`/`cli` (inspect the code) + `decision` (what is allowed) + `agent` (do it and check it) add up to one. But it understands Nexo's **structure** (modules, files) and not its **domain** (resources). That is backwards for an application framework: the domain is what users and agents act on.

---

## 10. Context / Tools / Behavior / Decision / Agent Analysis

| Package | Responsibility | Input | Output | Depends on | Used by |
|---|---|---|---|---|---|
| context | Describe the app and record why it is built that way | `NexoApplication`, optional `ApplicationKnowledge` and `SourceTree` | `ApplicationContext` JSON; the journal | core | cli, tools, agent, web |
| tools | Analyse and operate on the codebase (developer time) | app, context, project root | read views, source tree, knowledge graph, impact, lint, run results, metrics | core, context, typescript | cli |
| behavior | Ask an LLM a **bounded** question | state + `QuestionMap` | typed `DecisionResult` with confidence | — | agent, web |
| decision | Apply **deterministic** policy to a proposed action | `DecisionIntent` + rules (+ extras) | APPROVE / REJECT / ASK_USER / ESCALATE / DEFER + audit | core | agent |
| agent | Run the loop and execute | text or intent | `ExecutionRecord` (decision, tool result, verification) | context, decision, behavior, web | integrations, apps |

### Could any of them merge?

- **behavior + decision: no.** This boundary is the framework's safety thesis: deterministic rules (decision) versus probabilistic judgment (behavior). Merging them would let an LLM's answer pass as policy. The real problem is that the names do not say this. `decision` is "policy" and `behavior` is "judgment".
- **decision + agent: no.** Decision is useful without an agent (RBAC through `createAccessControl` is already used in templates). It is also the component you want audited and stable while the agent changes.
- **context + tools: no.** Pure contract versus I/O and analysis. The one thing that could move is the 13 read getters (`createReadInterface`), which are thin wiring over context and could live in `context`. That is optional.
- **context + agent: no.** The CLI and frontend consume context without an agent.
- **What should move is not packages but responsibilities:**
  - DSC out of behavior.
  - Metrics out of tools.
  - The duplicated `NexoDecision` out of core.
  - The `web` default out of agent.

### The UNDERSTAND → KNOW → DECIDE → ACT → VERIFY mapping, as implemented

| Stage | Expected (brief) | Actual |
|---|---|---|
| UNDERSTAND | context | **agent's `IntentParser`** (text → intent). `context` is optional input that `run()` does not pass. |
| KNOW | tools / web | **Not part of `execute()`.** Workflows can recall `AgentMemory` (`recallMemory`); `knowledge` is only **written to** (history); `web` is a separate method. |
| DECIDE | decision / behavior | **decision**. behavior is used only for retry, route, escalate and complete judgments. |
| ACT | tools / integrations | **agent `ToolRegistry`**, plus integrations toolkits. (`@nexo-alpha/tools` does not take part.) |
| VERIFY | — | **agent `VerifierRegistry`**. Elsewhere, `behavior.verify`, `web.verifyEvidence` and `tools` verification are three unrelated "verify"s. |

---

## 11. Data / Resource Architecture

**What it is:** a **resource system on top of a document store**. It is not an ORM.

| Concern | Status | Where |
|---|---|---|
| Schema DSL | ✅ `model()` + `field.*` (string, text, email, number, boolean, enum, date, ref, file, array), with `.optional()`, `.default()`, `.labelled()`, `.describe()` | core/model.ts |
| Types | ✅ `Infer`, `InferInput`, `InferPatch` | core/model.ts |
| Validation | ✅ rejects unknown fields; the same code runs server and client | core/model.ts, validation.ts |
| Storage | ✅ memory, JSON file and SQLite document stores; CAS `replaceIf`; SQL-pushed list queries | core/storage.ts |
| CRUD and REST | ✅ list, get, create, update, delete; search, filter, sort, paging; 404 and 409 | core/resource.ts |
| Relations | ⚠️ `ref` existence checks only; no joins or includes | core/resource.ts |
| Permissions | ⚠️ per-operation scopes; **no row-level read rules** | ResourceOptions.auth |
| Hooks | ✅ `beforeWrite`, `onChange` | core/resource.ts |
| Events | ❌ changes do not reach `app.events` | — |
| Frontend | ✅ `client.resource(M)`, `useResource`, `useRecord`, `NexoForm`, `NexoResourceTable` | frontend |
| AI tools | ❌ | — |
| Context / manifest | ❌ | — |
| Migrations | ⚠️ adding a field with a default needs no migration; renames are not handled | data/README |

**How close is it to the brief's `resource("User", {...})` reused across database, API, validation, frontend, AI tools and permissions?** About **4 of 6**:

- database ✅
- API ✅
- validation ✅
- frontend ✅
- permissions ⚠️ (scopes only)
- AI tools ❌

The model already carries everything an AI tool needs: a JSON-like schema per field, descriptions, enums, refs and required/optional. The missing parts are a **converter** and a **registration path**.

**How it should relate to the other packages (dependency direction):**

- context reads `resource.model` structurally.
- agent derives tools from it.
- frontend already shares it through `core/model`.
- core must not learn about AI.

---

## 12. Frontend / Backend / API Relationship

### Can the frontend use backend capabilities without rebuilding the API contract?

| Capability | Contract shared? | How |
|---|---|---|
| Resources | ✅ **Yes** | Same `model` object, same `resourcePath` and `encodeListQuery` from `core/model` |
| Auth | ✅ Yes | `AuthUser`/`AuthSession` types (type-only from core); `NexoAuthClient`, `NexoLoginForm` |
| Files | ✅ Yes | `FILES_PATH`, `NexoFile` from `core/model` |
| Custom `api.*` endpoints | ❌ No | `useApi<T>(path)` with a hand-written `T`; the RPC proxy guesses the HTTP method from the function name ([rpc.ts](packages/frontend/src/rpc.ts)) |
| Workflows, memory, metrics | ❌ Re-declared | `frontend/workflows.ts`, `memory.ts`, `metrics.ts` copy agent and tools types |
| Health and knowledge | ❌ No server side | Endpoints only exist in templates and examples |

**Other frontend gaps:**

- Four ways to fetch data: `useApi`, `useNexoApi`, `useNexoRpcQuery`, `useResource`.
- Two ways to mutate: `useMutation`, `useNexoRpcMutation`.
- Dashboards and DSA utilities sit in the main entry point.

### Hapi as an adapter (§12 of the brief)

What `create-server.ts` does, by kind:

| Concern | Framework-neutral? | Today |
|---|---|---|
| Route registration, path syntax, payload parsing, server start/stop, CORS config | Hapi-specific | hapi ✓ |
| Authenticate, check scopes, `validate`/`schema` validation, project resolution (`runInProject`), rate-limit decision, `NexoHttpError`/`NexoValidationError` → status, `httpResponse` → status and headers, request ID, `API_CALLED`/`API_ERROR` events, middleware | **Neutral** | hapi (and a partial copy in `app.dispatch`) |

**Verdict:** `Nexo → Hapi-specific semantics`. The application layer is portable: `NexoApi` is neutral and paths use `:param`. But the **meaning** of a request is defined inside the adapter.

**What new adapters (Fastify, Express, Workers, Bun, Node HTTP) would need:**

1. Add `createRequestPipeline(app, options)` to core. It returns `handle(api, { params, query, headers, body, remoteAddress }) → { status, headers, body }` and contains every neutral row above.
2. `app.dispatch()` calls the same pipeline. This also fixes middleware.
3. One place for the authenticator: today it is either `app.setAuthenticator` or `createHapiServer({ authenticate })`.
4. Each adapter then only translates the framework's request into the pipeline and the result back, at roughly 100–150 lines.
5. The Workers and Bun adapters additionally need storage that does not use `node:fs` or SQLite. `core`'s main entry imports `node:events`, `node:async_hooks`, `node:fs/promises` and `node:crypto`. The `core/model` entry is already browser-safe, which is the pattern to extend.

---

## 13. AI / Knowledge / Web Relationship

"Knowledge" currently means four different things:

| Name | Package | What it actually is |
|---|---|---|
| `ApplicationKnowledge` | context | A **journal**: decisions, constraints, intents, history, development state |
| `KnowledgeGraph` | tools | A **code graph**: modules, APIs, files, symbols, imports, calls |
| `AgentMemory` | agent | A **key–value memory** with tags and scope |
| `Evidence` | web | **Search results** |

(Also `NexoDecision`/`NexoConstraint` in core: a fifth, dead copy.)

The brief's distinction, Web Search ≠ Knowledge ≠ Agent ≠ Decision, **is respected at package level.** `web` does not decide, and `decision` does not search. It is **blurred by naming**, and **knowledge as an application capability does not exist**: there is no retrieval over the app's own data or documents for its end users.

**Recommendation:**

- Rename the four concepts precisely in docs and types, using aliases: *journal*, *code graph*, *memory*, *evidence*.
- Reserve "Knowledge" for a future, resource-backed retrieval capability (§19, P3). Do not build that until the resource ↔ AI bridge exists, because knowledge retrieval should go through the same tools and permissions.

---

## 14. Scheduler / Webhook / Integration Relationship

| Use case (brief) | Today |
|---|---|
| cron | ✅ `startJobScheduler(app)` runs `NexoJob.schedule` from modules |
| delayed jobs | ✅ queue `enqueue(…, { runAt })` with backoff |
| background tasks | ✅ queue, leases, multiple workers on SQLite |
| AI workflows | ✅ `createWorkflowApiModule({ queue })` (via the mirrored type) |
| knowledge indexing | ❌ no indexing to schedule |
| webhook retries | ✅ webhooks → queue |
| periodic sync | ✅ cron |

**Should scheduling be core or optional?**

- Keep the declaration (`NexoJob`) in core, as now.
- Keep execution in optional `scheduler`, as now.
- That split is correct: execution brings leases, workers and storage, which a CRUD app does not need.

**What is missing is events as glue:**

```text
resource change ─► app.events ("orders.created") ─┬─► webhooks.dispatch (outbound, signed, retried via queue)
                                                  ├─► queue.enqueue (background work)
                                                  └─► agent workflow trigger
inbound webhook (GitHub/Stripe) ─► receiver module (verify + idempotency) ─► app.events
```

- `NexoEventBus` exists but event names are untyped strings. Resources do not emit to it, and the manifest has no events catalogue beyond each module's declared `events: string[]`.
- `webhooks` should subscribe to `app.events` directly, through `webhooks.forwardFrom(app.events, ["orders.*"])`.
- `integrations` should not depend on the agent to be useful. Each one is a client plus an optional toolkit.

---

## 15. CLI / create-nexo-app Relationship

The implementation matches the intended split:

- `create-nexo-app` starts a project. It has zero runtime deps and four templates.
- `cli` works on an existing project. `nexo init` only prints `npx create-nexo-app …` ([cli.ts:124](packages/cli/src/cli.ts#L124)).

There is mild duplication: `cli generate resource|page` and the templates both generate resource and page code as string templates. This is acceptable. If it grows, have `create-nexo-app` call the CLI's `generateFiles()`. That only needs cli as a dev-time dependency of the generator, not of the app.

**Correction needed:** the templates install 11 packages but import 5 (§1).

---

## 16. Dependency Direction

Target: Application → {Frontend, Agent, API} → Data → Core, with adapters pointing inward.

| Violation | Kind | Fix |
|---|---|---|
| core and hapi define the request semantics inside the adapter | Adapter defines architecture | Move the pipeline into core (P0) |
| core contains AI concepts (`NexoDecision`, `NexoConstraint`, DSC mirrors) | Inner layer knows outer layer | Delete the dead store; move DSC out (P1) |
| agent → web (runtime) | Orchestrator depends on one optional knowledge source | Make it optional; research becomes a toolkit (P1) |
| integrations → agent (runtime dep for types) | Integration bound to one consumer | Client + adapter; peer dependency (P1) |
| frontend ↔ agent/tools contracts copied | Hidden dependency with no type check | `agent/contract` and `tools`-free metrics types (P2) |
| Apps → tools for metrics (pulls typescript) | Runtime depends on dev tooling | Metrics into core (P1) |
| decision → context (unused) and web → core (unused) | Manifest noise | Remove (P1) |

---

## 17. Circular Dependency Analysis

**Package graph:** acyclic for runtime, development and peer dependencies (checked against §4.1–4.3).

**Conceptual cycles:**

| # | Cycle | Why it exists | Harmful? | Clean boundary |
|---|---|---|---|---|
| 1 | core ⇄ behavior (DSC) | core, hapi, scheduler and context wanted DSC without depending on behavior, so they copy its interfaces | **Yes.** Five copies drift silently, and core's public API contains an AI package's internals | DSC is general instrumentation: either make it a core plugin with core owning the interface, or delete it. Behavior should not own it. |
| 2 | core ⇄ context (`NexoDecision`/`NexoConstraint`) | Left over from moving knowledge out of core in v0.17 ([docs/architecture/README.md](docs/architecture/README.md)) | **Yes.** Two public types with the same name and different fields | Delete from core |
| 3 | agent ⇄ scheduler (`WorkflowJobQueue`) | Avoids a runtime dependency | Mild | Type-only import from scheduler, with scheduler as an optional peer |
| 4 | tools ⇄ agent/scheduler (`*EventLike`) and frontend ⇄ agent/tools (wire types) | The same reason | Mild to moderate: wire contracts can drift without failing compilation | Each server package exports a browser-safe `…/contract` entry; consumers `import type` |
| 5 | context ⇄ tools (`SourceTree` types) | Keeps tools' output inside the manifest without context importing tools | Benign: context owns the contract and tools produces it. This is the right direction | Keep; document it as intended |

---

## 18. Redundancy Analysis

Each pair the brief asked about, with the evidence:

| Pair | Duplication? | Evidence |
|---|---|---|
| context vs tools | **Small.** `createReadInterface`'s 13 getters wrap `buildContext`/app | [read-interface.ts:105](packages/tools/src/read-interface.ts#L105) |
| tools vs integrations | **Naming only.** `@nexo-alpha/tools` (developer tools) and `NexoTool` (agent actions) are unrelated | — |
| behavior vs decision | **None in code.** Different mechanisms (LLM vs rules); the overlapping vocabulary ("decision", "verify") misleads | behavior `DecisionResult` vs decision `DecisionOutcome` |
| decision vs agent | None. Agent consumes decision; `toolPermissionRule` (agent) bridges tools to RBAC (decision) | [tool-permissions.ts](packages/agent/src/tool-permissions.ts) |
| data vs core | **Complete, by design** (re-export) | [data/src/index.ts](packages/data/src/index.ts) |
| scheduler vs webhooks | None. Webhooks uses the queue | [dispatcher.ts:19](packages/webhooks/src/dispatcher.ts#L19) |
| web vs knowledge | Distinct, but web writes into the knowledge journal | [pipeline.ts](packages/web/src/research/pipeline.ts) |
| frontend vs API | **Yes for non-resource APIs** (types re-declared, RPC guesses methods); **no for resources** | §12 |
| CLI vs create-nexo-app | Small: generator templates | §15 |

**Other duplication found:**

| Concept | Copies |
|---|---|
| Request pipeline | `app.dispatch` · hapi `create-server.ts` |
| Verify | agent `VerifierRegistry` · `behavior.verify` · `web.verifyEvidence` · `tools` `createVerificationInterface` |
| Audit | decision audit log · agent execution audit + `createDocumentAuditTrail` · knowledge history (written by tools, agent and web) |
| Knowledge | 4 meanings plus a dead core copy (§13) |
| Data fetching hooks | `useApi` · `useNexoApi` · `useNexoRpcQuery` · `useResource` |
| Permission vocabularies | HTTP scopes (core) · RBAC roles → scopes (decision, which correctly reuses `scopeMatches`) · `PermissionGrants` with `modify-source`/`modify-configuration` (tools) |
| Graph / topo-sort / LRU utilities | core `topoSort`/`memoize` · frontend `dsa/*` · behavior's private LRU |

---

## 19. Missing Capabilities

Each item is tested against the question "is this necessary for the Nexo vision?"

| Capability | Necessary? | Why | Priority |
|---|---|---|---|
| **Resource → AI tools bridge** (with schema and permissions) | **Yes.** It is the vision. | It is the join described in §2 | P0/P1 |
| **Adapter-neutral request pipeline** | **Yes** | Correctness (middleware) and portability | P0 |
| **Tool input schemas** (reusing `NexoFieldSchema`, exportable as JSON Schema for LLM function calling) | **Yes** | AI cannot call tools correctly without them | P1 |
| **A real LLM provider adapter** (SDK-free: `(prompt, schema) => json`) | **Yes** | Every behavior and web claim depends on it | P1 |
| **Typed domain events from resources** | **Yes** | The EVENTS layer in the target diagram; glue for webhooks, the queue and the agent | P1 |
| **Introspection module** (`/api/health`, `/api/nexo/context`) | **Yes** | The frontend already calls endpoints nobody provides | P1 |
| **Row-level authorization** (per-caller read filter, ownership) | Yes, for CRUD + AI | AI tools that list "orders" must see only the caller's orders | P2 |
| **Typed contracts for non-resource APIs** | Yes | "Frontend without rebuilding contracts" | P2 |
| **Inbound webhook receiver** | Yes, for integrations | GitHub, Slack and Stripe all call back | P2 |
| **MCP server over the CLI's inspect commands** | Yes, for the token goal | AI coding tools use MCP | P2 |
| **Knowledge (resource-backed retrieval / RAG)** | Eventually | The vision lists it, but it must sit on the resource + tools bridge | P3 |
| Tracing / OpenTelemetry | Nice to have | Logger and metrics exist | P3 |
| Secrets management | No (beyond `loadEnvConfig`) | Platform concern | — |
| Notifications | No (an integration) | Fits the integrations pattern | — |
| A separate validation package | No | Already in core | — |

---

## 20. Public API Analysis

| Package | Runtime exports | What users should import | Should be internal |
|---|---:|---|---|
| core | 82 | `createApplication`, `api`, `model`, `field`, `resource`, stores, `createAuth`, `createFiles`, errors, `httpResponse`, `scopeByProject`, logger | `topoSort`, `memoize`, `CountingMap`, `DSC_*`, `installDscPlugin`, `resolveDsc*`, `NexoDecision`/`NexoConstraint`, `LifecycleRegistry`, `NexoMiddlewarePipeline` (internal machinery) |
| frontend | 112 | `createNexoClient`, `NexoProvider`, `useResource`, `useRecord`, `NexoForm`, `NexoResourceTable`, auth hooks and components, router, basic UI | All `dsa/*` (≈18); move the dashboards (`NexoWorkflowRuns`, `NexoMemoryBrowser`, `NexoDscDashboard`, `NexoKnowledgeInspector`, `NexoModuleGraph`, `NexoMetricsDashboard`, `NexoTerminal`) to `/studio` |
| behavior | 31 | `choice`, `score`, `boolean`, `createBehaviorEngine`, the provider interface | DSC (all), token utilities (unless configured), `JevBehaviorProvider` |
| agent | 22 | `createAgent`, `createWorkflow`, toolkits, memory, `/testing` | `createDscAgent` |
| tools | 20 | Through the CLI | `createWriteInterface` structural ops; metrics moves to core |
| context | 14 | `buildContext`, `createKnowledge` | `*WithDsc`, hash helpers (keep exported for tools, but undocumented) |

**What a typical app imports today:**

- Full-stack app: about 15 names from 3 packages.
- Agent app (support-desk example): 7 packages.
- Fullstack-react example: 10 packages.

---

## 21. Token / Context Efficiency Analysis

**What already works well:**

- The `nexo context` manifest replaces reading module files.
- The knowledge graph is **hash-gated** and caches summaries per node, so a caller-supplied LLM summariser only pays for changed nodes.
- `nexo impact`, `trace`, `search` and `freshness` answer "what does this change touch?" without reading files.

**What wastes tokens today:**

1. Output is human text. Only `doctor` has `--json`.
2. There is nothing to inspect resources or models with. An AI must read `*.model.ts` and the `resource()` call sites to learn the domain, which is the most important thing to know.
3. The manifest always returns everything. There is no `--module`-style narrowing for every entity kind, and no depth or field selection.
4. Two import paths (`core` vs `data`) and four meanings of "knowledge" cost explanation tokens in every AI session.
5. The `behavior` token layer (compression, prompt cache, budget) optimises calls that never reach an LLM. It saves nothing today.

**Proposed CLI**, every command supporting `--json`:

```bash
nexo inspect --json                      # compact app summary: resources, apis, tools, jobs, events (names + counts)
nexo inspect resource orders             # fields (kind, required, enum, ref), operations, path, scopes, searchable, hooks present
nexo inspect route "POST /api/orders"    # schema, auth, owning module, handler file (via sourceFiles)
nexo inspect tool cancel_order           # input schema, permissions, verifiers
nexo inspect permissions                 # scope → routes/tools matrix
nexo inspect events                      # emitted events and subscribers
nexo graph / impact / trace              # (exists)
nexo mcp                                 # serve the above over MCP for AI coding tools
```

The intended loop is "AI asks → framework returns compact structure → AI acts". That needs (2) and JSON output. MCP is the channel AI coding tools already speak.

---

## 22. Current Architecture Diagram

```text
                    ┌──────────────────────── FULL STACK (coherent) ───────────────────────┐
                    │                                                                      │
 create-nexo-app ─► │  frontend ──(core/model: same model, paths, query encoding)──┐       │
   (11 pkgs!)       │     │ calls /api/health, /api/knowledge (nobody serves)      │       │
                    │     ▼ HTTP                                                   ▼       │
                    │  hapi  [owns request semantics] ──►  core  [kernel + data + auth +   │
                    │                                            files + tenancy + utils + │
                    │                                            DSC mirrors + dead store] │
                    │                                       ▲  data = re-export of core    │
                    └───────────────────────────────────────┼──────────────────────────────┘
                                                            │ (registry only: modules/APIs —
                    ┌──────────── AI LAYER (blind to resources) ───────────────────────────┐
                    │  context ◄── tools(+metrics,+typescript) ◄── cli                     │
                    │     ▲                                                                │
                    │  decision(allow-by-default) ◄── agent ──► behavior(made-up answers)  │
                    │                                  │  └──► web(mock search) ──► behavior│
                    │                      integrations┘ (agent-only toolkits)             │
                    └──────────────────────────────────────────────────────────────────────┘
   scheduler ◄── webhooks           (no event bridge from resources)
   DSC spread over: behavior, core, context, scheduler, agent, hapi, frontend
```

---

## 23. Recommended Architecture Diagram

```text
                                   NEXO (one mental model)
                 Resource · API · Component · Policy · Agent · Event
                                         │
         ┌───────────────────────────────┼────────────────────────────────┐
         ▼                               ▼                                ▼
   FRONTEND                        BACKEND / API                        AI
   frontend (+/client, +/studio)   core: request pipeline          agent  (resourceTools,
   uses model + contracts          hapi | fastify | workers*         tools w/ schema, KNOW wired)
         │                         (thin adapters)                 decision (deny-by-default)
         │                               │                         behavior* (real provider)
         └──────────────┬────────────────┴───────────────┬─────────┘
                        ▼                                ▼
                     RESOURCE  (core: model, resource, storage, files, auth)
                        │     emits typed events ─► app.events
          ┌─────────────┼──────────────────────┐
          ▼             ▼                      ▼
     context        EVENTS (core bus)     KNOWLEDGE* (P3: resource-backed retrieval)
  (manifest incl.       │
   resources, tools,    ├─► scheduler* (queue/cron)
   events, perms)       ├─► webhooks*  (out + inbound receiver)
          │             └─► integrations* (clients + toolkits)
          ▼
   cli / MCP (nexo inspect --json)        create-nexo-app (installs what it imports)

   * optional    data = facade over core (kept), future unified facade decides its fate
```

---

## 24. Recommended Package Boundaries

| Package | Keep / change | New boundary |
|---|---|---|
| core | **Change** | Kernel + data + auth (as decided) + **request pipeline** + **metrics** + health module. Remove DSC mirrors, DSA and the dead knowledge store from the public API. |
| data | Keep | Re-export only (standing rule). Revisit when a unified facade is decided. |
| context | **Extend** | Manifest gains `resources`, `tools`, `events`, `permissions`. Add `createContextApiModule()` to serve it over HTTP. Remove `*WithDsc`. |
| tools | **Shrink** | Developer-time analysis only (source, graph, impact, verify, run, journal writes). Lose metrics and the structural writes. Possibly rename to `devtools` (P2). |
| hapi | **Shrink** | A translator over the core pipeline. |
| scheduler | Keep | Remove `dsc-scheduler`. Export a type-only contract for agent. |
| webhooks | **Extend** | `forwardFrom(app.events)`, inbound receiver module. |
| behavior | **Refocus** | Judgment primitives + providers (one real adapter; the default refuses) + token utilities (wired only with a real provider). **DSC removed.** |
| decision | Keep | Drop the `context` dependency; add a helper for deny-by-default engines. |
| agent | **Extend** | `resourceTools()`, tool `input` schema, KNOW wiring in `run()`, a `/contract` entry. **Drop the runtime dependency on web.** Remove `createDscAgent`. |
| web | **Quarantine → merge** | Require a provider; then either it becomes `integrations`' web-search toolkit, or it is removed. |
| integrations | **Change** | Plain clients + `…Toolkit()` adapters; `agent` as an optional peer. |
| frontend | **Reorganise by subpath** | `.` (app), `/client` (exists), `/studio` (dashboards); DSA internal; type-only wire contracts from server `/contract` entries. |
| cli | **Extend** | `inspect resource|route|tool|permissions|events`, `--json` everywhere, `mcp`. |
| create-nexo-app | **Fix** | Each template installs exactly what it imports. |

**Net package count:** 15 → 14 (web merged into integrations, or removed). No new packages are needed for P0–P2. This respects the standing rule to extend existing packages.

---

## 25. Recommended Dependency Graph

```text
Layer 0   core                                  behavior*
            ▲                                       ▲
Layer 1   data · context · hapi · scheduler* · frontend (types + core/model only)
            ▲        ▲                ▲
Layer 2   decision · tools · webhooks* (→ scheduler)
            ▲        ▲
Layer 3   agent (→ core, context, decision; behavior optional peer)   cli (→ core, context, tools)
            ▲
Layer 4   integrations* (agent = optional peer; clients usable without it)

Removed edges: agent→web, decision→context, web→core, frontend⇢agent/tools (copied types → type-only /contract)
Removed conceptual edges: DSC mirrors from core/context/scheduler/hapi/agent; NexoDecision from core
```

---

## 26. Minimum Nexo Core

What the code shows:

- **"Is it Nexo?"** You need `core`. That gives the registry, lifecycle, model, resource and storage, and it runs on its own: you can call `resource.create()` and `app.dispatch()`.
- **"A Nexo app that serves requests"** = `core` + `hapi`, because core has no server. This is the `minimal` template.
- **"A Nexo full-stack app"** = `core` + `hapi` + `frontend` (+ `cli` as a dev dependency). This is the benchmark's import set.
- **"A Nexo AI-native app"** = the above + `context` + `decision` + `agent`. Today `agent` also drags in `behavior` and `web` at runtime; after P1 it does not.

`context` is **not** needed for a CRUD app at runtime. It is needed by tooling and AI. That is the right status for it: foundational to the *AI* tier, optional to the *app* tier.

---

## 27. Ideal Developer Experience

The target mental model is **Resource, API, Component, Policy, Agent, Event**, with no package names. A User/Product/Order app with AI access:

```ts
// shared/models.ts  (browser-safe)
export const Product = model("products", { name: field.string(), price: field.number({ min: 0 }) });
export const Order   = model("orders",   { productId: field.ref("products"), qty: field.number({ min: 1, integer: true }),
                                           status: field.enum(["open", "paid", "cancelled"]).default("open") });

// server.ts
const products = resource(Product, { store, auth: { write: ["catalog:write"] } });
const orders   = resource(Order,   { store, auth: true, emits: true /* orders.created … on app.events */ });
app.module(auth, products, orders);

const agent = createAgent({ decisionEngine: policy /* deny-by-default */ });
agent.tools.register(...resourceTools(orders, { expose: ["list", "get", "update"] }));   // schema + scopes derived
await startServer(app);                                                                  // adapter chosen once

// frontend
const { items } = useResource(Order);   <NexoForm model={Order} />
```

**Packages the developer must know:** 3 for full stack; 3 more for AI, each with one entry function.

**Unified facade (§36 of the brief):** a facade would help. But build it **after** the resource ↔ AI bridge exists; before that it would only hide the disconnection. When it is built:

- follow the `data` rule (zero implementation);
- use subpaths: `nexo`, `nexo/model`, `nexo/client`, `nexo/react`, `nexo/ai`;
- make `data` one of its subpaths.

**Too much magic?** No. Today's magic is limited and visible: default paths, system fields, ref checks. **Escape hatches are sufficient:** `api.*`, `beforeWrite`, `onChange`, custom stores, `expose`, raw `NexoModule`.

**Ideal install:**

```bash
npx @nexo-alpha/create-nexo-app my-app            # core, hapi, frontend, cli(dev)
npx @nexo-alpha/create-nexo-app my-app --ai       # + context, decision, agent
nexo add scheduler | webhooks | integrations      # later, P3: installs and wires
```

---

## 28. Ideal AI-Agent Experience

```text
LLM proposes intent ──► Framework understands ──► Deterministic rules validate ──► Bounded behavior executes ──► Result verified
  (IntentParser fed       (context: resources,      (decision: deny-by-default,      (tool input validated        (verifiers; for resource
   compact context:        tools w/ schemas,         scopes from resource.auth,       against model; timeout;      tools: re-read record and
   resources + tools)      permissions)              RBAC, confirmation, rate)        audited)                     compare — derived free)
```

Against the brief's §28: the **shape** is already implemented in `agent.execute()`. The **contents** are not:

| Stage | Missing piece |
|---|---|
| Understand | The parser gets names only, not schemas or the context |
| Validate | Rules allow by default; scopes are not derived from resources |
| Execute | No input validation |
| Verify | Every verifier is hand-written; resource tools could get one for free (read the record back and compare) |
| Judgment | Made-up answers |

**For AI coding agents** (Claude Code, Cursor and others): `nexo mcp` exposes `inspect`, `impact`, `trace` and `generate`. The agent asks for "resource orders", gets about 40 lines of JSON, and generates code with `nexo generate`. It does not read 500 files.

---

## 29. Migration Plan

All changes are 0.x minor bumps with deprecations where public API is removed. Order matters: fix the things that **misrepresent** capability first, then **connect**, then **simplify**.

### P0 — Critical architectural problems

1. **Stop making up AI judgments.**
   - `LocalBehaviorProvider` without an evaluator returns `uncertain`/`confidence: 0`, or throws "no behavior provider configured".
   - Remove Jev's silent fallback; on failure it should report the error.
   - `web.research()` requires a `provider`; delete the `MockWebSearchProvider` default (keep the mock for tests only).
   - Use `sufficient` in the result status.
2. **One request pipeline.**
   - Add `createRequestPipeline()` to core.
   - `app.dispatch()` and hapi both use it.
   - Middleware runs over HTTP.
   - One authenticator.
   - Add an adapter-conformance test suite that any future adapter must pass. Reuse hapi's 982 test lines.
3. **Deny by default for agents.**
   - `createAgent` refuses a `DecisionEngine` with zero rules unless `allowUnrestricted: true`, or installs `toolPermissionRule` by default.
   - Document that tool `permissions` are enforced.
4. **Templates install what they import.** Remove agent, behavior, decision, scheduler, tools and web from `backend-api` and `fullstack-react`.

### P1 — Important improvements

5. **Resources in the manifest.** `ModuleContext.resource?: { model, fields, operations, path, auth, searchable }`, read structurally from `module.model`. Add `nexo inspect resource <name>`.
6. **Tool schemas and resource tools.**
   - `NexoTool.input?: NexoFieldSchema | NexoModel`; the registry validates before `execute`.
   - Add `toJsonSchema()` (browser-safe, in core/model).
   - Add `resourceTools(resource, { expose })` in agent, with permissions taken from `resource.auth`.
7. **Wire KNOW.** `run()` passes `buildContext()` (resources and tools only) and recalled memory to the parser.
8. **A real behavior provider:** `createModelProvider(call: (prompt, jsonSchema) => Promise<unknown>)`, so it stays SDK-free. Wire the token utilities only through it.
9. **Resource events.**
   - Resources emit `"<model>.created|updated|deleted"` on `app.events` (opt-in).
   - Add `webhooks.forwardFrom(app.events, patterns)`.
   - List events in the manifest.
10. **Introspection modules.**
    - `createHealthModule()` in core.
    - `createContextApiModule(app, { knowledge })` in context.
    - Frontend hooks point at them; templates stop hand-writing them.
11. **Dependency hygiene.**
    - agent drops `web` (research becomes a toolkit).
    - integrations: `agent` becomes an optional peer.
    - Remove `decision → context` and `web → core`.
    - Move metrics from tools into core, so apps stop installing typescript.
12. **Delete the duplicates.**
    - Core's `addDecision`/`addConstraint` and its `NexoDecision`/`NexoConstraint`.
    - Deprecate DSC across core, context, scheduler, agent, hapi and frontend.
    - Decide later whether a single core instrumentation hook replaces it.

### P2 — Developer-experience improvements

13. Frontend subpaths: `/studio` for the dashboards; DSA becomes internal. Deprecate `useNexoApi`/`useNexoRpcQuery`/`useNexoRpcMutation` in favour of `useResource` + `useApi`.
14. Wire contracts: `agent/contract`, scheduler types and metrics types become browser-safe entries; frontend uses `import type`, with the server package as an optional peer.
15. Typed contracts for custom APIs: `api.get(path, handler, { response: Model | schema })`, plus a client helper that infers from a shared contract file.
16. CLI: `--json` everywhere, `inspect route|tool|permissions|events`, `nexo mcp`.
17. Row-level read rules on resources: `authorize(record, auth)` and a `scope(auth) → where` list filter.
18. Integrations become plain clients plus toolkits; add an inbound webhook receiver module in webhooks.
19. Names:
    - Consider renaming `tools` → `devtools`.
    - Document behavior as "judgment" and decision as "policy".
    - Rename the four knowledge concepts (journal, code graph, memory, evidence) using type aliases.
20. Merge `web` into `integrations` as a web-search toolkit, or remove it.

### P3 — Future capabilities

21. A unified facade (`nexo`, re-export only), once P1 lands.
22. `--ai` template flag and `nexo add <capability>`.
23. Resource-backed knowledge retrieval: search over resources, with an optional vector index behind the same tools and permissions.
24. Adapters: Fastify, Node HTTP, Workers (needs storage without `node:*`).
25. Tracing (OpenTelemetry) over the single pipeline.

---

## 30. Final Recommendations

### Answers to the final audit questions

**Architecture**

1. **Is the package architecture coherent?** The full-stack half is. The AI half is coherent internally but disconnected from the full-stack half. Experiments (DSC, token layer, web) cut across both.
2. **What is the actual hierarchy?** core → {context, data, hapi, scheduler, frontend} → {decision, tools, web, webhooks} → {agent, cli} → integrations. behavior is a separate root (§4).
3. **Are the boundaries correct?** Mostly, at package level. Wrong inside packages: request semantics live in hapi; metrics live in tools; DSC lives in behavior; dashboards and DSA live in frontend's main entry; AI types sit in core.
4. **Circular dependencies?** None between packages. Five conceptual cycles; two are harmful (DSC mirrors, the duplicated `NexoDecision`).
5. **Unnecessary packages?** `web` in its current form. `data` is redundant by design; keep it as decided.

**Product**

6. **What does Nexo uniquely solve?** One domain declaration that becomes database, API, validation, client and UI. Potentially it can also become a permission-gated, schema-described AI capability. The first part exists; the second does not.
7. **Does it support "less code"?** Yes, measurably, for CRUD, auth and files (−88%). Not yet for AI: each operation still needs a hand-written tool.
8. **Frontend → backend → database as one system?** Yes for resources, auth and files. No for custom APIs and the agent, workflow and metrics APIs.
9. **AI-native development?** Partially. Structure introspection and the code graph are real; domain introspection is missing.
10. **Knowledge as a first-class capability?** No. Four unrelated "knowledge" concepts, and none of them is application knowledge retrieval.

**AI**

11. **Are context, tools, behavior, decision and agent separated correctly?** Yes as packages. The responsibilities inside them leak (DSC, metrics, web dependency), and the names hide the policy vs judgment boundary.
12. **Does it reduce AI context usage?** For code structure, yes (graph, impact, hash gating). For the domain, no.
13. **Can an AI inspect the app efficiently?** Modules and APIs: yes. Resources, tools, permissions and events: no. JSON output: only `doctor`.
14. **Can an AI act safely?** The pipeline is right; the defaults are not (allow by default, no input schemas).
15. **Can an AI verify its own work?** Only through hand-written verifiers. Behavior-based verification makes up its answers.

**Developer experience**

16. **How many packages must a developer understand?** Full stack: 3. With AI today: 6–7, plus unused packages installed by templates.
17. **Can it expose a smaller mental model?** Yes: Resource, API, Component, Policy, Agent, Event. Mostly done for the first three.
18. **Can resources become the central abstraction?** They already are for full stack. Extend them to AI and events (§25 of the brief, §11 here) without making core aware of AI.
19. **Too much magic?** No.
20. **Enough escape hatches?** Yes.

**Future**

21. **Merge:** `web` → `integrations` (or remove it).
22. **Split:** none at package level. By subpath: `frontend/studio`, `agent/contract`.
23. **Make internal:** DSA utilities (core and frontend), DSC (everywhere), `LifecycleRegistry` and `NexoMiddlewarePipeline` (core), the structural write ops in tools.
24. **Make public:** `createRequestPipeline` (for adapter authors), `resourceTools`, `toJsonSchema`, the introspection modules, `inspect --json`.
25. **Most important missing layer:** the **resource ↔ AI bridge**, followed by the adapter-neutral request pipeline and typed resource events.
26. **Deprecate:** DSC APIs; `app.addDecision`/`addConstraint`; `MockWebSearchProvider` as a default; `JevBehaviorProvider`'s fallback; the structural `createWriteInterface` ops; the overlapping RPC hooks.
27. **Rename (optional, before 1.0):** `tools` → `devtools`. Describe `behavior` as judgment and `decision` as policy. Give the four knowledge concepts precise names.
28. **What should the ideal architecture look like?** §23 and §25. One Resource at the centre. Thin adapters pointing inward. Events as the glue for jobs, webhooks and integrations. An AI tier that reads the same resource declaration the UI does. A CLI and MCP surface that answers in compact JSON.

### Bottom line

Nexo has built the hard half: a resource-first full stack that measurably removes most CRUD code. It has also built a careful AI execution loop. The work now is not more packages. It is to **connect the AI loop to the Resource**, remove the defaults that misrepresent what the AI layer can do, and move request semantics out of the Hapi adapter. After that, the internal package structure serves the model in the brief instead of being the model.

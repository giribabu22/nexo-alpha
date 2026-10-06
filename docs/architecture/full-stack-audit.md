# Full-Stack Simplicity Audit

Date: 2026-10-06. Scope: the path a CRUD feature travels in Nexo, from
**Frontend → API → Backend → Database**. AI, agent, workflow and DSC
packages were reviewed only to the extent they touch that path.

## 1. What already exists, and should be reused

| Concern | Existing home | Notes |
|---|---|---|
| Field schema (data, not code) | `core/api.ts` `NexoFieldSchema` | string/number/boolean/object/array, min/max, pattern, enum, nested |
| Validation | `core/validation.ts` `validateField`, `validateSchema`, `assertValid` | Dependency-free, error strings like `Field "body.email" is required.` |
| Persistence | `core/storage.ts` `NexoDocumentStore` | memory / JSON file / SQLite; `replaceIf` gives compare-and-swap |
| Multi-tenancy | `core/projects.ts` `scopeByProject(store)` | Any store can be wrapped; composes with anything that takes a store |
| HTTP errors | `core/errors.ts` `NexoHttpError`, `httpResponse()` | 4xx and custom status/headers from handlers |
| Auth | `core/auth.ts` JWT + API keys, scopes | `NexoApi.auth = { required, scopes }` enforced by hapi |
| HTTP server | `hapi/create-server.ts` | Parsing, schema validation, 401/403, request IDs, rate limits, logging, tenancy |
| HTTP client | `frontend/client.ts` `NexoClient` | Auth headers, timeouts, `NexoApiError` with status and payload |
| React data hooks | `frontend/hooks.ts` | `useApi`, `useMutation`, `useNexoApi`, `useNexoRpcQuery`, `useNexoRpcMutation` |
| Routing | `frontend/router/*` | Trie router with `:param` and `*`, `NexoRouterProvider`, `NexoRoutes`, `NexoLink` |
| UI | `frontend/components/*` | Card, Button, Input, Badge, Tabs, Page (navbar/sidebar/footer), Metric, Terminal |
| Scaffolding | `cli/generate.ts` (`tool`, `workflow`, `module`), `create-nexo-app` templates | Pure generators, refuse to overwrite |

The building blocks exist. What is missing is a **single source of truth for
a domain object** that connects them.

## 2. Boilerplate: code that exists only because a primitive is missing

Measured on `examples/fullstack-react/src/app.ts` (todos) and the
benchmark "before" implementations in `benchmarks/code-to-intent/`:

1. **The entity shape is written 3–4 times**: a TypeScript `interface`
   (server), a `NexoFieldSchema` for validation, the same `interface` again
   on the frontend (`TodoData` in `TodoPage.tsx` duplicates `TodoItem` in
   `app.ts`), and implicit shapes in handlers (`payload as { text?: string … }`).
2. **Every CRUD endpoint is hand-written**: name, method, path, payload
   casting, id generation, 404 handling, 201 status, timestamps. The todos
   module's `toggleTodo` returns `{ error: "Todo not found" }` with status
   **200**: the kind of bug that convention-based CRUD removes.
3. **Every frontend list re-implements loading, error and refetch** state:
   `useProjects`, `useWorkflowRuns`, `useAgentMemory` and `useApi` each
   carry their own `useState` × 3 + `mountedRef` + `useCallback` block.
4. **Pagination, search and filtering** have no shared implementation; each
   API would parse `request.query` itself.
5. **Validation failures thrown from a handler become 500s**: hapi maps
   `NexoHttpError` to 4xx, but a `NexoValidationError` thrown by
   `assertValid()` inside a handler is reported as an internal error.
6. **Handlers cannot see who is calling**: hapi authenticates, then
   discards the `NexoAuthResult`, so ownership rules (`createdBy`) need a
   second token parse inside the handler.

## 3. Duplicate abstractions

| Concept | Implementations | Recommendation |
|---|---|---|
| "Fetch data into React state" | `useApi`, `useNexoApi`, `useNexoRpcQuery`, plus ad-hoc copies in four components | Keep for compatibility; make `useResource` the documented path for domain data |
| "Mutate then update UI" | `useMutation`, `useNexoRpcMutation` | Same: resource hooks own CRUD mutations |
| "Call a backend endpoint" | `NexoClient.get/post…`, RPC proxy (`createNexoRpcClient`) | The RPC proxy guesses the HTTP method from the function name (`getX` → GET), which is unrelated to how the server declared it; prefer contracts that come from the server's declaration |
| "Shape of an entity" | TS interface + `NexoFieldSchema` + frontend interface | Collapse into `model()` |

Not changed in this pass: deprecating existing hooks would break the studio
and dashboard components; they stay and are documented as lower-level.

## 4. AI complexity hot spots

- **Making one simple change means editing several files**: adding a field to
  todos means editing the server interface, the handler's payload cast, the
  frontend interface and the component. Nothing ties them together, so an AI
  cannot find all four by following types.
- **Comments describe generators that don't exist**: `NexoFieldSchema`'s doc
  comment refers to "`@nexo-alpha/tools`'s OpenAPI/client generators"; there
  are none in the repo. Readers (human or AI) are told to look for something
  that isn't there.
- **The full-stack example opens with infrastructure**: the first 120 lines of
  `examples/fullstack-react/src/app.ts` are DSC, knowledge and tenancy setup,
  so the feature code is hard to find. The new example keeps features in
  their own folders.
- **Names guessed by convention can silently disagree**: `inferMethod()` in
  `rpc.ts` turns `updateX` into PUT, while the server may have declared
  PATCH.

## 5. Backward-compatibility surface (must not break)

`NexoApi`, `NexoModule`, `NexoRequestContext`, `NexoDocumentStore`,
`createHapiServer` options and response shapes (`{ error, errors }` on 400,
`{ error, code }` on 4xx), `NexoClient` methods, every exported hook and
component, and the CLI `generate` kinds. All changes in this pass are
**additive**: new exports, one new optional field on `NexoRequestContext`
(`auth`), and one new error mapping in hapi (`NexoValidationError` → 400,
previously 500).

## 6. Plan (incremental)

1. `model()` in core: one declaration drives TS types, validation, defaults,
   unknown-field rejection and the API schema. Browser-safe subpath
   `@nexo-alpha/core/model` so the frontend can share it.
2. `resource(model, { store })` in core: a `NexoModule` that is also a
   server-side data API (`list/get/create/update/delete`) with pagination,
   search, filters, sort, reference checks, optimistic concurrency, auth
   scopes and a `beforeWrite` hook.
3. `api.get/post/…` in core: one-line custom endpoints.
4. hapi: map `NexoValidationError` to 400; expose `context.auth`.
5. frontend: `client.resource(model)`, `useResource`, `useRecord`,
   `NexoForm`, `NexoTable`, `NexoResourceTable`, `NexoStack`, `NexoGrid`,
   feedback states, and `page()` + `NexoApp` for routing, layout and protected
   pages.
6. CLI: `nexo generate resource <name>`.
7. Code-to-intent benchmark with before and after implementations that pass
   the **same** HTTP conformance tests, so the LOC numbers compare
   equivalent behavior.

Deliberately deferred, each needing its own design: a login/session flow
(`auth()`), file upload, unique constraints (the document store has no
unique index, so a uniqueness check would not hold across processes),
server-side query pushdown (list currently filters in memory),
notifications, payments, WebSockets/streaming UI, the larger component
catalog (DataGrid, Kanban, CommandPalette, AI chat primitives).

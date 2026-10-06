# Changelog

## 0.7.0

0.7.0 makes Nexo a full-stack framework. A domain object is declared once and drives storage, validation, the REST API, TypeScript types, forms and tables. It also adds built-in sign-in, file uploads, and SQL-backed lists on SQLite. See [Full-stack primitives](./docs/primitives.md) and the [upgrade notes](./docs/architecture/full-stack-report.md#f-migration).

### Changed

- **`resource()` list sorting no longer uses `localeCompare`.** It now uses one rule on every store: numbers sort numerically and strings case-insensitively (ASCII letters only), missing values sort last in both directions, and ties keep creation order.
- **A `resource()` create or update with several problems answers one 400 listing all of them**, unknown fields included, in the same words as browser-side validation.
- **`resource({ searchable })` accepts only text fields** (string, text, email, enum, date, ref).

- **`@nexo-alpha/hapi` answers 400 when a handler throws `NexoValidationError`** (`{ error: "Validation failed", errors }`, the same body as schema validation failures). It used to answer 500.
- **`@nexo-alpha/frontend` depends on `@nexo-alpha/core`** (previously a dev dependency). Browser code imports only the Node-free `@nexo-alpha/core/model` entry.

### Added

**Core (`@nexo-alpha/core`)**
- `model(name, fields)` and `field.*`: one declaration gives `Infer`/`InferInput`/`InferPatch` types, validation that rejects unknown fields, defaults, labels and API schemas. Browser-safe entry point: `@nexo-alpha/core/model`.
- `resource(model, { store })`: a `NexoModule` serving `GET/POST /api/<name>` and `GET/PATCH/DELETE /api/<name>/:id`, and the same operations for server code. It provides paging, sorting, search, typed filters, reference checks for `field.ref()`, compare-and-swap updates (409 on persistent conflicts), auth scopes per read/write, and `beforeWrite`.
- `api.get/post/put/patch/delete(path, handler, options?)` for one-line endpoints.
- `resource({ onChange })` runs after every stored create, update and delete (for webhooks, audit logs and notifications). `auth` accepts per-operation scopes (e.g. `{ write: [...], delete: [...] }`). `field.*().describe(text)` adds descriptions to API schemas.
- `NexoRequestContext.auth`: the authenticated caller, on APIs with `auth.required`.

- `createAuth({ store, secret })`: email and password accounts. Passwords are scrypt-hashed, emails are unique and claimed atomically, sessions are revocable, failed sign-ins are limited, and scopes are read per request. It provides `/api/auth/register|login|logout|me` and an `authenticate` for `createHapiServer`.
- `createFiles({ store, blobs })`: uploads, downloads and file metadata at `/api/files`, with `createDiskBlobStore` and `createInMemoryBlobStore`. Downloads are served safely: `nosniff`, a sandboxing CSP, and HTML/SVG always downloaded. Size limits answer 413 and type limits 415. `field.file({ accept })` references an uploaded file, and `resource()` checks that it exists and has an accepted type.
- File cleanup: `resource()` tracks which record uses each file (one record per file; a second use answers 409 `FILE_IN_USE`) and releases files a record replaces or deletes. `createFiles` removes released files after `cleanup.removeDetachedAfterMs` (default 1 hour) on a timer tied to `app.start()`/`stop()`; never-used uploads are removed only with `cleanup.removeUnattachedAfterMs`. Also available: `files.attach`, `files.detach` and `files.sweep`.
- `NexoApi.rawBody`: receive the request body as bytes (any content type, up to `maxBytes`); `@nexo-alpha/hapi` supports it.
- `NexoDocumentStore.insert` (optional, atomic insert-if-absent; implemented by all built-in stores and forwarded by `scopeByProject`) and `insertDocument()`.
- `scopeMatches` and `missingScopes` are also exported from the browser-safe `@nexo-alpha/core/model`.
- Lists on SQLite run in SQL: `NexoDocumentStore.query` (optional) filters, searches, sorts and pages in the store, and `NexoDocumentStore.index` (optional) adds expression indexes. `resource()` uses both, and indexes `ref` fields by default (`indexes` option). Other stores use `queryDocuments()`, which follows the same rules, and a randomized test checks the two give identical results. On 50,000 rows, one customer's orders take 3 ms instead of 160 ms.

**Frontend (`@nexo-alpha/frontend`)**
- `client.session` (`NexoSession`, persisted in localStorage in browsers) and `client.auth` (login, register, logout, me). The session token is sent on every request, and a 401 for it signs the client out.
- `client.files` (`NexoFilesClient`: upload, url, info, download, delete) and `client.request(path, init, read)` for non-JSON responses. `NexoForm` renders `field.file()` as a file picker that uploads on selection, and `NexoTable` links to the file.
- `NexoResourceTable` asks before deleting (`confirmDelete`, default true) and shows delete errors.
- `useAuth()` and `NexoLoginForm` (sign in or sign up, then return to `?next=`, same-site paths only).
- `client.resource(model)`: typed CRUD with client-side validation and change notifications.
- `useResource`, `useRecord`, `useResourceClient`, and `createQuery` (the React-free state behind them).
- `NexoForm` / `useForm`, `NexoTable`, `NexoResourceTable`, `NexoStack`, `NexoGrid`, `NexoLoader`, `NexoErrorState`, `NexoEmptyState`.
- `page()` and `NexoApp`: routing, layouts, protected pages and not-found in one component. Protected pages follow the session by default.

**CLI (`@nexo-alpha/cli`)**
- `nexo generate resource <name>` (`--no-page` for backend-only projects) and `nexo generate page <name>`.

**Tooling**
- `pnpm lint`: ESLint with typescript-eslint and React's rules of hooks, run in CI.

**Templates (`create-nexo-app`)**
- `backend-api` projects start with a `notes` resource (`src/notes/`) stored in `data/app.json`.
- `fullstack-react` projects share one `Todo` model between backend and frontend through a `shared/` workspace: the backend serves it with `resource()` (stored in `backend/data/app.json`, seeded on first start), and the frontend uses `useResource()` instead of hand-written fetch and state code. The Dockerfile installs through the workspace.
- Templates depend on `^0.7.0`.

### Fixed

- `NexoProvider` ignored its `auth` and `timeoutMs` props.
- The code-to-intent benchmark's "before" email checks rejected addresses containing the letter "s" (a lost escape in the pattern). Found by the new lint step.
- Tests that need `node:sqlite` are skipped on Node.js 20, as the CI matrix expects.
- Projects generated from the `fullstack-react` template failed `npm run build`: the frontend type check rejected an unused `React` import in `KnowledgeInspector.tsx`.
- The README's hapi example accepted any `Authorization` header as signed in. It now uses `jwtAuthenticator`.

## 0.6.0

0.6.0 adds a production runtime: workflows over HTTP, a persistent job queue, authentication and role-based access, multi-tenant projects, webhooks, observability, and a frontend for all of it. See the [Developer Guide](./docs/DEVELOPER_GUIDE.md), sections 13–22.

### Breaking changes

- **`NexoDocumentStore` has a new required method, `replaceIf(collection, id, expected, next)`** (an atomic compare-and-swap). The built-in stores implement it; custom stores must add it.
- **Scope matching supports wildcards.** A granted scope of `"*"` or `"prefix:*"` now satisfies more specific required scopes, both in `app.dispatch()` and in `@nexo-alpha/hapi`. Exact matches behave as before.
- **An actor passed to `workflow.run()` / `resume()` now overrides the parser's actor.** A parsed (possibly user-influenced) intent can no longer name a different actor. Without an explicit actor, the parser's actor is used as before.
- **`createMetricsCollector().getMetrics()` returns `workflows` and `queues` as well as `apis` and `jobs`.** It also accepts `{ projectId }` to return one project's metrics.
- **An agent's in-memory `auditLog` keeps the newest 10,000 records** (`maxAuditEntries`). Use `auditSink` with `createDocumentAuditTrail()` to keep the full history.
- **Workflow events carry `workflowName`.**

### Added

**Runtime (`@nexo-alpha/agent`)**
- Step-lifecycle events (`onEvent`), cancellation with an `AbortSignal`, and `start()` / `execute()` / `reopen()` for background execution.
- `AgentMemory` for recall across runs (in-memory, file, or any document store).
- `createWorkflowApiModule()`: start, list, inspect, resume and describe workflows over HTTP. With a job queue, it answers `202 Accepted` with a `Location` header.
- `createMemoryApiModule()`, `toolPermissionRule()`, per-tool `timeoutMs`, toolkits via `installToolkit()`, and a durable audit trail via `auditSink` and `createDocumentAuditTrail()`.
- Test helpers in `@nexo-alpha/agent/testing`: `createToolStub`, `createTestAgent`, `runSteps`, `collectEvents`.

**Core (`@nexo-alpha/core`)**
- Authentication: `apiKeyAuthenticator`, `jwtAuthenticator` with `signToken` / `verifyToken` (HS256), and `anyAuthenticator`.
- Document stores: in-memory, JSON file (cached, with grouped writes), and SQLite via `node:sqlite` (Node ≥ 22.5, safe to share between processes).
- `createLogger()` for structured JSON logs with credential redaction.
- `createRateLimiter()`, `withTimeout()`, `retry()`, `createCircuitBreaker()`.
- HTTP helpers: `NexoHttpError` answers with a 4xx, `httpResponse()` sets a success status and headers, and `createRequestContext()` builds a request for tests.
- Projects (multi-tenancy): `runInProject()`, `scopeByProject()`, `createProjectRegistry()`, `createProjectApiModule()`.

**Access control (`@nexo-alpha/decision`)**
- `createAccessControl()` for roles with inheritance and wildcard permissions, and `rbacRule()`.

**HTTP (`@nexo-alpha/hapi`)**
- Request IDs (`x-request-id`), structured request logs (`logger`), rate limiting (`rateLimit`), and per-request projects (`project`).

**Job queue (`@nexo-alpha/scheduler`)**
- `createJobQueue()`: a persistent queue with retries and backoff, delayed jobs, cancellation and concurrency.
- Workers hold a lease on each running job, and jobs are claimed atomically, so several workers can share one SQLite store.
- Each job runs inside the project it was enqueued in.

**Metrics (`@nexo-alpha/tools`)**
- Workflow and queue metrics, per-project metrics, Prometheus text export, and `createMetricsApiModule()` (`/metrics` and `/metrics/prometheus`).

**Frontend (`@nexo-alpha/frontend`)**
- Client namespaces: `client.workflows`, `client.memory`, `client.projects` and `getMetrics()`.
- Project selection: the `projectId` option and `forProject()`.
- A React-free entry point, `@nexo-alpha/frontend/client`.
- Components with matching hooks: workflow dashboard, workflow catalog, metrics dashboard, memory browser, project switcher.

**CLI and scaffolding**
- `@nexo-alpha/cli`: `nexo generate tool|workflow|module` and `nexo doctor`.
- `create-nexo-app`: a new `agent-service` template (auth, role-based access, queued workflows, memory, metrics, Docker).

**New packages**
- `@nexo-alpha/webhooks`: signed, retried webhook delivery and receiver-side verification.
- `@nexo-alpha/integrations`: GitHub and Slack toolkits for agents.

**Packaging & Distribution**
- Official distribution via the npm registry under `@nexo-alpha`.
- Automated GitHub Actions CI/CD release workflow (`.github/workflows/publish.yml`) with automated tests, typechecks, and dry-run validation.
- Standardized `repository` metadata linking all monorepo subpackages to the root repository.
- Scaffolding tool published as `@nexo-alpha/create-nexo-app` (`npx @nexo-alpha/create-nexo-app`).

### Fixed

- File-backed workflow stores and agent memory no longer lose updates when writes happen at the same time.
- `NexoProvider` now passes every client option through to the client, including `workflowsPath` and `memoryPath`.

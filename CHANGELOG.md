# Changelog

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
- Official distribution via GitHub Packages registry (`npm.pkg.github.com`) under `@nexo-alpha`.
- Automated GitHub Actions CI/CD release workflow (`.github/workflows/publish.yml`) with automated tests, typechecks, and dry-run validation.
- Standardized `repository` metadata linking all monorepo subpackages to the root repository.
- Scaffolding tool published as `@nexo-alpha/create-nexo-app` (`npx @nexo-alpha/create-nexo-app`).

### Fixed

- File-backed workflow stores and agent memory no longer lose updates when writes happen at the same time.
- `NexoProvider` now passes every client option through to the client, including `workflowsPath` and `memoryPath`.

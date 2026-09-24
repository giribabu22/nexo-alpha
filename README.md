# Nexo

A lightweight Node.js application framework and environment for the AI era.

Nexo's core (`@nexo-alpha/core`) defines the application model — applications,
modules, services, APIs, jobs, and lifecycle — with zero AI, HTTP, database,
or scheduling dependencies. Every other package builds on top of it, never
the reverse; see `docs/architecture/README.md`'s "Dependency direction rule".

See `PRD — AI-Era Software Development Framework.md`, `plan.txt`, and
`phase.txt` for the product vision and build roadmap, and
`docs/architecture/README.md` for a running, per-milestone log of what has
actually been built and why.

## Status

**v0.17** — application model (with lifecycle failure/recovery, lifecycle
events, and mutation gating), a context manifest that includes a
registry-derived structure hash for staleness detection, a separate
knowledge journal (decisions/constraints/development state/history) with
JSON serialization, AI read/write/verification interfaces (including
process-shelling `run_tests`/`run_typecheck`/`run_build`), a Hapi HTTP
adapter with request auth/validation and lifecycle-bound shutdown, a cron
job scheduler, event-based observability, and a CLI (`inspect`, `status`,
`context`, `knowledge`, `validate`, `health`). See
`docs/architecture/README.md` for the full milestone-by-milestone
breakdown and what remains deliberately out of scope (source-text
extraction — files/symbols/call graphs, distributed coordination,
autonomous AI operations, `run_lint`).

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Each command runs across every workspace package (`pnpm -r`).

## Packages

- `packages/core` — `@nexo-alpha/core`, the framework-independent application
  model: `NexoApplication`, `NexoModule`, `NexoService`, `NexoApi`, `NexoJob`,
  lifecycle management (including failure/reset semantics), and the event bus.
- `packages/context` — `@nexo-alpha/context`, builds a plain,
  JSON-serializable `ApplicationContext` manifest from a `NexoApplication`,
  and defines `createKnowledge()` — the human-authored decisions,
  constraints, development state, and history journal.
- `packages/decision` — `@nexo-alpha/decision`, the deterministic Decision Engine:
  rule evaluation chain (`permission`, `state`, `constraint`, `confirmation`, `escalation`, `rateLimit`)
  producing structured outcomes (`APPROVE`, `REJECT`, `ASK_USER`, `ESCALATE`, `DEFER`) and audit logs.
- `packages/agent` — `@nexo-alpha/agent`, the AI-native application orchestration layer:
  wires the intelligence stack (`UNDERSTAND → KNOW → DECIDE → ACT → VERIFY`), `ToolRegistry`,
  `VerifierRegistry`, `ExecutionAuditLog`, `NexoAgent` (`execute()` & `run()`), and `NexoWorkflow`
  (Phase 6 multi-step autonomous workflow engine with safety boundaries and human resumption).
- `packages/tools` — `@nexo-alpha/tools`, the AI/tooling interface: source-interface code scanning,
  read-only query interface, permission-gated write interface, verification interface, and metrics collector.
- `packages/hapi` — `@nexo-alpha/hapi`, an HTTP adapter that turns
  handler-backed `NexoApi` declarations into a running `@hapi/hapi` server.
- `packages/scheduler` — `@nexo-alpha/scheduler`, a cron-based executor for `NexoJob`s.
- `packages/cli` — `@nexo-alpha/cli` (`nexo` binary), developer CLI for inspecting applications.

## Examples

- `examples/hello-world` — minimal application using `@nexo-alpha/core` and
  `@nexo-alpha/hapi`.

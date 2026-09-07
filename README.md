# Nexo

A lightweight Node.js application framework and environment for the AI era.

Nexo's core (`@nexo/core`) defines the application model — applications, modules,
services, APIs, and lifecycle — with zero AI, HTTP, or database dependencies.
Later packages (Hapi adapter, CLI, context, AI interface) build on top of it.

See `PRD — AI-Era Software Development Framework.md`, `plan.txt`, and `phase.txt`
for the product vision and build roadmap.

## Status

**v0.1-alpha** — `@nexo/core` only: Application, Module, Service, API, Lifecycle, Errors.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Packages

- `packages/core` — `@nexo/core`, the framework-independent application model.

## Examples

- `examples/hello-world` — minimal application using `@nexo/core`.

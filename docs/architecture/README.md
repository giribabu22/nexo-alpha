# Architecture Notes — v0.1-alpha

## Current model

```text
Application
   |
   +-- Modules
```

`NexoApplication` registers `NexoModule`s and drives their lifecycle
(`initialize` -> `start`, then `stop` in reverse registration order).

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

## v0.1-alpha boundary

In scope: Application, Module, Service, API, Lifecycle, Errors.

Not yet: Hapi adapter, CLI, Context system, dependency injection,
configuration system, AI/MCP interface, database, cloud, autonomous
agent operations. See `plan.txt` and `phase.txt` for the full phased
roadmap.

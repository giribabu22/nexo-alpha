# @nexo-alpha/cli

Command-line interface for [Nexo](https://www.npmjs.com/package/@nexo-alpha/core) — `nexo inspect`, `nexo status`, and `nexo context`, the human-facing counterpart to [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools)'s AI-facing read interface. Both read the same [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) manifest.

## Install

```bash
npm install -g @nexo-alpha/cli
```

Or use it without a global install via `npx @nexo-alpha/cli`.

## Why

`phase.txt` calls this "the first real demonstration of the idea": run one command and see your application's structure — modules, APIs, dependencies, current development state — without reading the source.

## How it finds an application

Nexo has no project scaffold or config-file convention yet, so the CLI takes an explicit path to a **compiled JS module** that exports a `NexoApplication` as `app` (or `default`):

```ts
// dist/app.js
export const app = createApplication({ name: "shop" });
app.module({ name: "payments", purpose: "Handle customer payments" });
```

```bash
nexo inspect ./dist/app.js
```

## Commands

```bash
nexo inspect <app-path>              # application summary + module list
nexo inspect <app-path> <moduleName> # one module's full detail
nexo status <app-path>               # development state
nexo context <app-path>              # raw JSON manifest (buildContext output)
```

Example:

```text
$ nexo inspect ./dist/app.js payments

payments

Purpose: Handle customer payments
Status: in-progress

Dependencies:
  stripe
  orders

Dependents:
  (none)

APIs:
  POST /payments  createPayment

...
```

## Design notes

- **Read-only.** No commands modify an application — matching the rest of Nexo's "read-only first" AI/tooling surface.
- **No dependencies beyond Nexo's own packages** (`@nexo-alpha/core`, `@nexo-alpha/context`) — argument parsing is hand-rolled since the commands take no flags.

## Related packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — the application/module model
- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — the manifest this CLI renders
- [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools) — the same data, shaped for AI tools instead of a terminal

## Status

**v0.1-alpha.** No config-file convention yet (so `nexo inspect` alone doesn't work from a project root — an explicit path is required), no write commands.

## License

MIT

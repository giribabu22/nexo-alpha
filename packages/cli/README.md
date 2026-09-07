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

The CLI resolves a target app one of two ways:

**Explicit path** — a path to a **compiled JS module** that exports a `NexoApplication` as `app` (or `default`):

```ts
// dist/app.js
export const app = createApplication({ name: "shop" });
app.module({ name: "payments", purpose: "Handle customer payments" });
```

```bash
nexo inspect ./dist/app.js
```

**Project config** — omit the path and the CLI looks for a `nexo.config.json` in the current directory, or a parent directory, with the shape:

```json
{ "app": "./dist/app.js" }
```

`app` is resolved relative to the config file's own directory, so it works the same no matter which subdirectory you run `nexo` from. Run `nexo inspect` from anywhere under a project with this config and it just works — no path needed.

## Commands

```bash
nexo inspect [app-path] [moduleName]  # application summary, or one module's full detail
nexo inspect [--module moduleName]    # same, using nexo.config.json for the app path
nexo status [app-path]                # development state
nexo context [app-path]               # raw JSON manifest (buildContext output)
```

`app-path` is optional in every form above — when omitted, the CLI falls back to `nexo.config.json`. `--module` is only meaningful for `inspect`, and only when `app-path` is omitted (when a path is given, the module name is just the next positional argument, as before).

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

**v0.1-alpha.** No write commands.

## License

MIT

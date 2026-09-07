# @nexo-alpha/hapi

Turns a [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) `NexoApplication`'s declared APIs into a real, running [Hapi.js](https://hapi.dev) HTTP server. This is the framework's first package with a real external runtime dependency (`@hapi/hapi`) — everything before it stays dependency-free by design.

## Install

```bash
npm install @nexo-alpha/hapi @nexo-alpha/core @hapi/hapi
```

## Why

Nexo's application model is otherwise purely declarative — `NexoApi` describes an endpoint's method, path, and metadata, but nothing runs it. `@nexo-alpha/hapi` is the adapter that turns a `handler`-bearing `NexoApi` into an actual route, keeping `@nexo-alpha/core` itself Hapi-agnostic.

## Usage

```ts
import { createApplication } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";

const app = createApplication({ name: "shop" });

app.module({
  name: "hello",
  apis: [
    {
      name: "sayHello",
      method: "GET",
      path: "/hello",
      handler: async () => ({ message: "Hello from Nexo" })
    }
  ]
});

const server = await startHapiServer(app, { port: 3000 });
console.log(`Listening on ${server.info.uri}`);
```

```bash
curl http://localhost:3000/hello
# {"message":"Hello from Nexo"}
```

## What's here

- **`createHapiServer(app, options?)`** — builds a `Hapi.server(...)` and registers a route for every API that has a `handler`. Path params use Express-style `:id` in `NexoApi.path` (matching the rest of Nexo's examples) and are converted to Hapi's `{id}` syntax automatically.
- **`startHapiServer(app, options?)`** — `createHapiServer` plus `server.start()`.
- **`toHapiPath(path)`** — the `:id` → `{id}` path converter, exported directly if you need it.
- A handler receives a plain `NexoRequestContext` (`params`, `query`, `payload`, `headers`) — no Hapi types leak into `@nexo-alpha/core`. Return a value to send it as the response (objects are serialized to JSON automatically); return `undefined` for a `204`.

## Design notes

- **APIs without a `handler` get no route.** They stay descriptive-only, exactly as they appear in `@nexo-alpha/context`'s manifest and `@nexo-alpha/cli`'s output.
- **`HEAD` is not registered as an explicit route** — Hapi generates `HEAD` responses from `GET` routes automatically and rejects `HEAD` as an explicit method.
- **No request validation or auth yet.** Every handler-backed API is wired with no input validation and no authentication layer — that's Phase 5 ("Safe Development Operations") territory, not this package.

## Related packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — the application/module model, including `NexoRequestContext` and `NexoApiHandler`

## Status

**v0.1-alpha.** No request validation, no authentication, no lifecycle wiring to `NexoApplication.start()`/`stop()` yet — creating and starting the Hapi server is a separate step from the application's own lifecycle.

## License

MIT

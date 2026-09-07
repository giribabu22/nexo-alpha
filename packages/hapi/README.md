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

### Auth and validation

`NexoApi.auth` and `NexoApi.validate` are plain declarative/function hooks (no Joi, no JWT library — `@nexo-alpha/core` stays dependency-free); the actual verification logic is supplied by you:

```ts
app.module({
  name: "widgets",
  apis: [
    {
      name: "createWidget",
      method: "POST",
      path: "/widgets",
      auth: { required: true, scopes: ["widgets:write"] },
      validate: (context) => {
        const payload = context.payload;
        if (!payload || typeof payload.name !== "string") {
          return { valid: false, errors: ["name is required"] };
        }
        return { valid: true };
      },
      handler: async (context) => ({ created: context.payload.name })
    }
  ]
});

const server = await startHapiServer(app, {
  authenticate: async (context) => {
    const token = context.headers.authorization;
    // verify the token however you like (JWT, session lookup, API key, ...)
    return token === "Bearer good-token"
      ? { authenticated: true, scopes: ["widgets:write"] }
      : { authenticated: false };
  }
});
```

Requests to `/widgets` now run through **Identity → Permission → Validation → Operation** before the handler: no/invalid auth → `401`; authenticated but missing a required scope → `403`; validation fails → `400` with `errors`; otherwise the handler runs, unchanged. If any API declares `auth.required` but no `authenticate` option is passed to `createHapiServer`/`startHapiServer`, server creation fails immediately rather than silently serving an unenforceable route.

### Observability

Every route emits through `app.events` (`@nexo-alpha/core`'s `NexoEventBus`), so you can observe traffic without touching the route logic:

```ts
app.events.on("api.called", ({ api, method, path, statusCode, durationMs }) => {
  console.log(`${method} ${path} (${api}) -> ${statusCode} in ${durationMs}ms`);
});

app.events.on("api.error", ({ api, error }) => {
  console.error(`${api} handler threw:`, error);
});
```

`api.called` fires for every completed request — including auth/validation denials (`401`/`403`/`400`) — with the actual status code, so you can see e.g. how much traffic to an endpoint is getting rejected. `api.error` fires only when the handler itself throws; the error still propagates and Hapi still returns its own default `500`, unchanged. `@nexo-alpha/tools`'s `createMetricsCollector(app)` subscribes to these same events to build call/error counts and average durations, if you want aggregated numbers instead of raw events.

## What's here

- **`createHapiServer(app, options?)`** — builds a `Hapi.server(...)` and registers a route for every API that has a `handler`. Path params use Express-style `:id` in `NexoApi.path` (matching the rest of Nexo's examples) and are converted to Hapi's `{id}` syntax automatically.
- **`startHapiServer(app, options?)`** — `createHapiServer` plus `server.start()`.
- **`toHapiPath(path)`** — the `:id` → `{id}` path converter, exported directly if you need it.
- A handler receives a plain `NexoRequestContext` (`params`, `query`, `payload`, `headers`) — no Hapi types leak into `@nexo-alpha/core`. Return a value to send it as the response (objects are serialized to JSON automatically); return `undefined` for a `204`.
- `options.authenticate` — an optional `NexoAuthenticator` used for every API with `auth.required`, checked before validation and before the handler runs.

## Design notes

- **APIs without a `handler` get no route.** They stay descriptive-only, exactly as they appear in `@nexo-alpha/context`'s manifest and `@nexo-alpha/cli`'s output.
- **`HEAD` is not registered as an explicit route** — Hapi generates `HEAD` responses from `GET` routes automatically and rejects `HEAD` as an explicit method.
- **Auth runs before validation** — both the PRD's stated request pipeline (Identity → Permission → ... → Validation → Operation) and standard security practice: an unauthenticated caller shouldn't learn anything about payload shape from a `400`.

## Related packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — the application/module model, including `NexoRequestContext`, `NexoApiHandler`, `NexoApiAuth`, `NexoRequestValidator`, and `NexoAuthenticator`

## Status

**v0.1-alpha.** No lifecycle wiring to `NexoApplication.start()`/`stop()` yet — creating and starting the Hapi server is a separate step from the application's own lifecycle.

## License

MIT

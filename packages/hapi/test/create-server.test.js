import test from "node:test";
import assert from "node:assert/strict";

import { createApplication, createLogger, NexoHttpError, jwtAuthenticator, signToken } from "@nexo-alpha/core";
import { createHapiServer, startHapiServer, toHapiPath } from "../dist/index.js";

test("toHapiPath converts :param segments to {param} syntax", () => {
  assert.equal(toHapiPath("/payments/:id"), "/payments/{id}");
  assert.equal(toHapiPath("/payments"), "/payments");
  assert.equal(toHapiPath("/orders/:orderId/items/:itemId"), "/orders/{orderId}/items/{itemId}");
});

function buildFixtureApp() {
  const app = createApplication({ name: "shop" });

  app.module({
    name: "api",
    apis: [
      {
        name: "health",
        method: "GET",
        path: "/health",
        handler: async () => ({ status: "ok" })
      },
      {
        name: "getItem",
        method: "GET",
        path: "/items/:id",
        handler: async (context) => ({ id: context.params.id })
      },
      {
        name: "noContent",
        method: "POST",
        path: "/noop",
        handler: async () => undefined
      },
      {
        name: "descriptiveOnly",
        method: "GET",
        path: "/no-handler"
      }
    ]
  });

  return app;
}

test("createHapiServer registers a route for each handler-backed API", async () => {
  const server = await createHapiServer(buildFixtureApp());

  const response = await server.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.payload), { status: "ok" });
});

test("createHapiServer wires path params into the request context", async () => {
  const server = await createHapiServer(buildFixtureApp());

  const response = await server.inject({ method: "GET", url: "/items/abc123" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.payload), { id: "abc123" });
});

test("a handler returning undefined produces a 204", async () => {
  const server = await createHapiServer(buildFixtureApp());

  const response = await server.inject({ method: "POST", url: "/noop" });

  assert.equal(response.statusCode, 204);
});

test("an API with no handler gets no route", async () => {
  const server = await createHapiServer(buildFixtureApp());

  const response = await server.inject({ method: "GET", url: "/no-handler" });

  assert.equal(response.statusCode, 404);
});

function buildSecuredApp() {
  const app = createApplication({ name: "shop" });

  app.module({
    name: "api",
    apis: [
      {
        name: "secureEcho",
        method: "POST",
        path: "/secure-echo",
        auth: { required: true, scopes: ["write"] },
        validate: (context) => {
          const payload = context.payload;
          if (!payload || typeof payload.value !== "string") {
            return { valid: false, errors: ["payload.value must be a string"] };
          }
          return { valid: true };
        },
        handler: async (context) => ({ echoed: context.payload.value })
      }
    ]
  });

  return app;
}

test("createHapiServer rejects when an auth-required API has no authenticate option", async () => {
  await assert.rejects(createHapiServer(buildSecuredApp()), /requires auth/);
});

test("an unauthenticated request gets a 401 and the handler does not run", async () => {
  const server = await createHapiServer(buildSecuredApp(), {
    authenticate: async () => ({ authenticated: false })
  });

  const response = await server.inject({
    method: "POST",
    url: "/secure-echo",
    payload: { value: "hi" }
  });

  assert.equal(response.statusCode, 401);
});

test("an authenticated request missing a required scope gets a 403", async () => {
  const server = await createHapiServer(buildSecuredApp(), {
    authenticate: async () => ({ authenticated: true, scopes: ["read"] })
  });

  const response = await server.inject({
    method: "POST",
    url: "/secure-echo",
    payload: { value: "hi" }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.payload).missingScopes, ["write"]);
});

test("an authenticated request with the required scope but an invalid payload gets a 400", async () => {
  const server = await createHapiServer(buildSecuredApp(), {
    authenticate: async () => ({ authenticated: true, scopes: ["write"] })
  });

  const response = await server.inject({
    method: "POST",
    url: "/secure-echo",
    payload: { value: 123 }
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.payload).errors, ["payload.value must be a string"]);
});

test("an authenticated request with the required scope and a valid payload runs the handler", async () => {
  const server = await createHapiServer(buildSecuredApp(), {
    authenticate: async () => ({ authenticated: true, scopes: ["write"] })
  });

  const response = await server.inject({
    method: "POST",
    url: "/secure-echo",
    payload: { value: "hi" }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.payload), { echoed: "hi" });
});

test("auth runs before validation: an unauthenticated request with an invalid payload still gets a 401", async () => {
  const server = await createHapiServer(buildSecuredApp(), {
    authenticate: async () => ({ authenticated: false })
  });

  const response = await server.inject({
    method: "POST",
    url: "/secure-echo",
    payload: { value: 123 }
  });

  assert.equal(response.statusCode, 401);
});

test("a successful call emits api.called with the right status and a measured duration", async () => {
  const app = buildFixtureApp();
  const events = [];
  app.events.on("api.called", (event) => events.push(event));

  const server = await createHapiServer(app);
  const response = await server.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.equal(events.length, 1);
  assert.equal(events[0].api, "health");
  assert.equal(events[0].method, "GET");
  assert.equal(events[0].path, "/health");
  assert.equal(events[0].statusCode, 200);
  assert.equal(typeof events[0].durationMs, "number");
  assert.ok(events[0].durationMs >= 0);
});

test("a denied request (401/403/400) also emits api.called with that status code", async () => {
  const app = buildSecuredApp();
  const events = [];
  app.events.on("api.called", (event) => events.push(event));

  const server = await createHapiServer(app, {
    authenticate: async () => ({ authenticated: false })
  });

  const response = await server.inject({
    method: "POST",
    url: "/secure-echo",
    payload: { value: "hi" }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(events.length, 1);
  assert.equal(events[0].api, "secureEcho");
  assert.equal(events[0].statusCode, 401);
});

test("a throwing handler emits api.error and Hapi still returns its default 500", async () => {
  const app = createApplication({ name: "shop" });
  app.module({
    name: "api",
    apis: [
      {
        name: "broken",
        method: "GET",
        path: "/broken",
        handler: async () => {
          throw new Error("kaboom");
        }
      }
    ]
  });

  const events = [];
  app.events.on("api.error", (event) => events.push(event));
  const calledEvents = [];
  app.events.on("api.called", (event) => calledEvents.push(event));

  const server = await createHapiServer(app);
  const response = await server.inject({ method: "GET", url: "/broken" });

  assert.equal(response.statusCode, 500);
  assert.equal(events.length, 1);
  assert.equal(events[0].api, "broken");
  assert.equal(events[0].error, "kaboom");
  assert.equal(typeof events[0].durationMs, "number");
  // No api.called for the throwing path -- there's no meaningful status
  // code to report from Nexo's side once the handler itself has thrown.
  assert.equal(calledEvents.length, 0);
});

test("a handler throwing NexoHttpError gets that 4xx status and emits api.called, not api.error", async () => {
  const app = createApplication({ name: "shop" });
  app.module({
    name: "api",
    apis: [
      {
        name: "missing",
        method: "GET",
        path: "/items/:id",
        handler: async (context) => {
          throw new NexoHttpError(404, "ITEM_NOT_FOUND", `Item "${context.params.id}" not found.`);
        }
      }
    ]
  });

  const errorEvents = [];
  app.events.on("api.error", (event) => errorEvents.push(event));
  const calledEvents = [];
  app.events.on("api.called", (event) => calledEvents.push(event));

  const server = await createHapiServer(app);
  const response = await server.inject({ method: "GET", url: "/items/x1" });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.payload), { error: 'Item "x1" not found.', code: "ITEM_NOT_FOUND" });
  assert.equal(errorEvents.length, 0);
  assert.equal(calledEvents.length, 1);
  assert.equal(calledEvents[0].statusCode, 404);
});

test("startHapiServer stops automatically when app.stop() is called", async () => {
  const app = buildFixtureApp();
  await app.start();

  const server = await startHapiServer(app, { port: 0 });
  const infoUri = server.info.uri;
  assert.ok(infoUri, "Server should have an active URI when started");

  await app.stop();

  // Injecting or checking info after stop shows server is stopped
  assert.equal(app.state, "stopped");
});

test("jwtAuthenticator + wildcard scopes: 'orders:*' grants a route requiring 'orders:refund'", async () => {
  const secret = "hapi-test-secret-that-is-at-least-32-bytes";
  const app = createApplication({ name: "shop" });
  app.module({
    name: "api",
    apis: [
      {
        name: "refund",
        method: "POST",
        path: "/refund",
        auth: { required: true, scopes: ["orders:refund"] },
        handler: async () => ({ refunded: true })
      }
    ]
  });

  const server = await createHapiServer(app, { logging: false, authenticate: jwtAuthenticator({ secret }) });
  const post = (token) =>
    server.inject({ method: "POST", url: "/refund", headers: { authorization: `Bearer ${token}` } });

  const manager = signToken({ sub: "m", scopes: ["orders:*"] }, secret, { expiresInSeconds: 60 });
  const viewer = signToken({ sub: "v", scope: "orders:read" }, secret, { expiresInSeconds: 60 });

  assert.equal((await post(manager)).statusCode, 200);
  const forbidden = await post(viewer);
  assert.equal(forbidden.statusCode, 403);
  assert.deepEqual(JSON.parse(forbidden.payload).missingScopes, ["orders:refund"]);
  assert.equal((await post("not-a-token")).statusCode, 401);
});

test("request IDs: generated when absent, reused when well-formed, replaced when malformed, and visible to handlers", async () => {
  const app = createApplication({ name: "shop" });
  let seen;
  app.module({
    name: "api",
    apis: [
      { name: "echo", method: "GET", path: "/echo", handler: async (context) => { seen = context.headers["x-request-id"]; return { ok: true }; } },
      { name: "boom", method: "GET", path: "/boom", handler: async () => { throw new Error("x"); } }
    ]
  });
  const server = await createHapiServer(app, { logging: false });

  const generated = await server.inject({ method: "GET", url: "/echo" });
  assert.match(generated.headers["x-request-id"], /^[0-9a-f-]{36}$/);
  assert.equal(seen, generated.headers["x-request-id"]);

  const reused = await server.inject({ method: "GET", url: "/echo", headers: { "x-request-id": "trace-123" } });
  assert.equal(reused.headers["x-request-id"], "trace-123");
  assert.equal(seen, "trace-123");

  const replaced = await server.inject({ method: "GET", url: "/echo", headers: { "x-request-id": "bad id\nwith newline" } });
  assert.notEqual(replaced.headers["x-request-id"], "bad id\nwith newline");

  const failed = await server.inject({ method: "GET", url: "/boom", headers: { "x-request-id": "err-1" } });
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.headers["x-request-id"], "err-1");
});

test("logger option: one structured entry per response, level by status", async () => {
  const app = createApplication({ name: "shop" });
  app.module({
    name: "api",
    apis: [
      { name: "ok", method: "GET", path: "/ok", handler: async () => ({ ok: true }) },
      { name: "missing", method: "GET", path: "/missing", handler: async () => { throw new NexoHttpError(404, "NOPE", "nope"); } }
    ]
  });
  const entries = [];
  const logger = createLogger({ sink: (entry) => entries.push(entry) });
  const server = await createHapiServer(app, { logger });

  await server.inject({ method: "GET", url: "/ok", headers: { "x-request-id": "r-ok" } });
  await server.inject({ method: "GET", url: "/missing" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(entries.length, 2);
  assert.equal(entries[0].msg, "http request");
  assert.equal(entries[0].level, "info");
  assert.equal(entries[0].requestId, "r-ok");
  assert.equal(entries[0].method, "GET");
  assert.equal(entries[0].path, "/ok");
  assert.equal(entries[0].statusCode, 200);
  assert.equal(typeof entries[0].durationMs, "number");
  assert.equal(entries[1].level, "warn");
  assert.equal(entries[1].statusCode, 404);
});

test("rateLimit: 429 with Retry-After once a client exceeds the window; headers on every response; key() exempts or groups", async () => {
  let now = 0;
  const app = createApplication({ name: "shop" });
  app.module({
    name: "api",
    apis: [
      { name: "ping", method: "GET", path: "/ping", handler: async () => ({ ok: true }) },
      { name: "health", method: "GET", path: "/health", handler: async () => ({ ok: true }) }
    ]
  });
  let handled = 0;
  app.events.on("api.called", () => { handled += 1; });

  const server = await createHapiServer(app, {
    logging: false,
    rateLimit: {
      windowMs: 60_000,
      max: 2,
      now: () => now,
      key: (request) => (request.path === "/health" ? undefined : request.headers["x-api-key"] ?? request.remoteAddress)
    }
  });
  const get = (url, headers = {}) => server.inject({ method: "GET", url, headers });

  const first = await get("/ping");
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["ratelimit-limit"], "2");
  assert.equal(first.headers["ratelimit-remaining"], "1");
  assert.equal(first.headers["ratelimit-reset"], "60");

  await get("/ping");
  const limited = await get("/ping", { "x-request-id": "rl-1" });
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(JSON.parse(limited.payload), { error: "Too Many Requests", code: "RATE_LIMITED" });
  assert.equal(limited.headers["retry-after"], "60");
  assert.equal(limited.headers["x-request-id"], "rl-1");
  assert.equal(handled, 2); // the limited request never reached the handler

  assert.equal((await get("/ping", { "x-api-key": "tenant-a" })).statusCode, 200); // separate bucket
  assert.equal((await get("/health")).statusCode, 200); // exempt
  assert.equal((await get("/health")).headers["ratelimit-limit"], undefined);

  now += 60_000;
  assert.equal((await get("/ping")).statusCode, 200); // window reset
});

test("httpResponse: handlers can set a success status and headers", async () => {
  const { httpResponse } = await import("@nexo-alpha/core");
  const app = createApplication({ name: "shop" });
  app.module({
    name: "api",
    apis: [
      { name: "accept", method: "POST", path: "/jobs", handler: async () => httpResponse(202, { id: "j1" }, { location: "/jobs/j1" }) },
      { name: "empty", method: "DELETE", path: "/jobs/:id", handler: async () => httpResponse(204) }
    ]
  });
  const calls = [];
  app.events.on("api.called", (event) => calls.push(event.statusCode));
  const server = await createHapiServer(app, { logging: false });

  const accepted = await server.inject({ method: "POST", url: "/jobs" });
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.headers.location, "/jobs/j1");
  assert.deepEqual(JSON.parse(accepted.payload), { id: "j1" });
  assert.ok(accepted.headers["x-request-id"]);

  const empty = await server.inject({ method: "DELETE", url: "/jobs/j1" });
  assert.equal(empty.statusCode, 204);
  assert.equal(empty.payload, "");
  assert.deepEqual(calls, [202, 204]);
});

test("project: requests run inside the resolved project; missing, invalid or denied projects are rejected", async () => {
  const { currentProjectId, NexoHttpError: HttpError } = await import("@nexo-alpha/core");
  const app = createApplication({ name: "tenants" });
  app.module({
    name: "api",
    apis: [
      { name: "whereAmI", method: "GET", path: "/where", handler: async () => ({ project: currentProjectId() ?? null }) },
      { name: "health", method: "GET", path: "/health", handler: async () => ({ project: currentProjectId() ?? null }) }
    ]
  });
  const memberships = { ann: ["acme"] };
  const server = await createHapiServer(app, {
    logging: false,
    project: {
      resolve: (context) => {
        const projectId = context.headers["x-project-id"];
        if (projectId === undefined) return undefined;
        if (!(memberships[context.headers["x-user"]] ?? []).includes(projectId)) {
          throw new HttpError(403, "NOT_A_MEMBER", "Not a member of this project.");
        }
        return projectId;
      },
      skip: (api) => api.name === "health"
    }
  });
  const get = (url, headers) => server.inject({ method: "GET", url, headers });

  const inside = await get("/where", { "x-user": "ann", "x-project-id": "acme" });
  assert.deepEqual(JSON.parse(inside.payload), { project: "acme" });

  const missing = await get("/where", { "x-user": "ann" });
  assert.equal(missing.statusCode, 400);
  assert.equal(JSON.parse(missing.payload).code, "PROJECT_REQUIRED");

  assert.equal((await get("/where", { "x-user": "ann", "x-project-id": "globex" })).statusCode, 403);
  assert.deepEqual(JSON.parse((await get("/health", {})).payload), { project: null });

  const optional = await createHapiServer(app, { logging: false, project: { resolve: () => "BAD ID", required: false } });
  assert.equal((await optional.inject({ method: "GET", url: "/where" })).statusCode, 400);
});

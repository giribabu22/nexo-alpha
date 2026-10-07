/**
 * The Hapi adapter and app.dispatch() run every request through core's
 * request pipeline, so the same request gets the same answer either way.
 * Each scenario below is sent both ways and the answers compared.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createApplication,
  NexoAuthenticationError,
  NexoHttpError,
  NexoValidationError,
  httpResponse
} from "@nexo-alpha/core";
import { createHapiServer } from "../dist/index.js";

const TOKEN = "Bearer good";

function buildApp() {
  const app = createApplication({ name: "parity" });
  app.setAuthenticator(async (context) =>
    context.headers.authorization === TOKEN ? { authenticated: true, scopes: ["notes:read"] } : { authenticated: false }
  );
  app.useMiddleware(async (context, next) => {
    const result = await next();
    return result !== null && typeof result === "object" && !("statusCode" in result) ? { ...result, viaMiddleware: true } : result;
  });
  app.module({
    name: "notes",
    apis: [
      { name: "ok", method: "GET", path: "/ok", handler: () => ({ ok: true }) },
      { name: "empty", method: "POST", path: "/empty", handler: () => undefined },
      { name: "accepted", method: "POST", path: "/accepted", handler: () => httpResponse(202, { queued: true }, { location: "/jobs/1" }) },
      { name: "private", method: "GET", path: "/private", auth: { required: true }, handler: (ctx) => ({ scopes: ctx.auth.scopes }) },
      { name: "admin", method: "GET", path: "/admin", auth: { required: true, scopes: ["notes:admin"] }, handler: () => ({}) },
      {
        name: "create",
        method: "POST",
        path: "/notes",
        schema: { body: { type: "object", required: ["title"], properties: { title: { type: "string", minLength: 1 } } } },
        handler: (ctx) => ({ title: ctx.payload.title })
      },
      { name: "missing", method: "GET", path: "/missing", handler: () => { throw new NexoHttpError(404, "NOT_FOUND", "No such note."); } },
      { name: "invalid", method: "POST", path: "/invalid", handler: () => { throw new NexoValidationError("Bad note.", ["title is required"]); } }
    ]
  });
  return app;
}

/** dispatch()'s answer in HTTP terms: a body, or the status its thrown error stands for. */
async function viaDispatch(app, name, request) {
  try {
    return { statusCode: "ok", body: await app.dispatch(name, { params: {}, query: {}, payload: undefined, headers: {}, ...request }) };
  } catch (error) {
    if (error instanceof NexoHttpError) return { statusCode: error.statusCode, code: error.code };
    if (error instanceof NexoValidationError) return { statusCode: 400, errors: error.errors };
    if (error instanceof NexoAuthenticationError) return { statusCode: error.message.startsWith("Missing required scope") ? 403 : 401 };
    throw error;
  }
}

const SCENARIOS = [
  { name: "ok", http: { method: "GET", url: "/ok" }, status: 200, body: { ok: true, viaMiddleware: true } },
  { name: "empty", http: { method: "POST", url: "/empty" }, status: 204 },
  { name: "accepted", http: { method: "POST", url: "/accepted" }, status: 202, body: { queued: true } },
  { name: "private", http: { method: "GET", url: "/private" }, status: 401 },
  { name: "private", http: { method: "GET", url: "/private", headers: { authorization: TOKEN } }, status: 200, body: { scopes: ["notes:read"], viaMiddleware: true } },
  { name: "admin", http: { method: "GET", url: "/admin", headers: { authorization: TOKEN } }, status: 403 },
  { name: "create", http: { method: "POST", url: "/notes", payload: { title: "" } }, status: 400 },
  { name: "create", http: { method: "POST", url: "/notes", payload: { title: "Hi" } }, status: 200, body: { title: "Hi", viaMiddleware: true } },
  { name: "missing", http: { method: "GET", url: "/missing" }, status: 404 },
  { name: "invalid", http: { method: "POST", url: "/invalid" }, status: 400 }
];

test("dispatch() and HTTP give the same answer to the same request", async () => {
  const app = buildApp();
  const server = await createHapiServer(app, { logging: false });

  for (const scenario of SCENARIOS) {
    const label = `${scenario.http.method} ${scenario.http.url} ${scenario.http.headers ? "(signed in)" : ""}`;
    const http = await server.inject(scenario.http);
    assert.equal(http.statusCode, scenario.status, `HTTP ${label}`);

    const dispatched = await viaDispatch(app, scenario.name, {
      headers: scenario.http.headers ?? {},
      payload: scenario.http.payload
    });
    if (scenario.status < 400) {
      assert.equal(dispatched.statusCode, "ok", `dispatch ${label}`);
      assert.deepEqual(dispatched.body, scenario.body, `dispatch ${label}`);
      if (scenario.body !== undefined) assert.deepEqual(JSON.parse(http.payload), scenario.body, `HTTP body ${label}`);
    } else {
      assert.equal(dispatched.statusCode, scenario.status, `dispatch ${label}`);
    }
  }
});

test("app middleware runs for HTTP requests", async () => {
  const app = createApplication({ name: "mw" });
  const seen = [];
  app.useMiddleware(async (context, next) => {
    seen.push(context.params.id);
    return next();
  });
  app.module({ name: "m", apis: [{ name: "get", method: "GET", path: "/items/:id", handler: (ctx) => ({ id: ctx.params.id }) }] });
  const server = await createHapiServer(app, { logging: false });

  const response = await server.inject({ method: "GET", url: "/items/7" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, ["7"]);
});

test("middleware can answer with a 4xx by throwing NexoHttpError", async () => {
  const app = createApplication({ name: "mw-deny" });
  app.useMiddleware(async (context, next) => {
    if (context.headers["x-tenant"] === undefined) throw new NexoHttpError(400, "TENANT_REQUIRED", "x-tenant is required.");
    return next();
  });
  app.module({ name: "m", apis: [{ name: "get", method: "GET", path: "/t", handler: () => ({ ok: true }) }] });
  const server = await createHapiServer(app, { logging: false });

  const denied = await server.inject({ method: "GET", url: "/t" });
  assert.equal(denied.statusCode, 400);
  assert.equal(JSON.parse(denied.payload).code, "TENANT_REQUIRED");
  assert.equal((await server.inject({ method: "GET", url: "/t", headers: { "x-tenant": "a" } })).statusCode, 200);
});

test("app.setAuthenticator() authenticates HTTP requests when createHapiServer() gets none", async () => {
  const app = createApplication({ name: "auth" });
  app.setAuthenticator(async (ctx) => ({ authenticated: ctx.headers.authorization === TOKEN }));
  app.module({ name: "m", apis: [{ name: "me", method: "GET", path: "/me", auth: { required: true }, handler: () => ({ me: true }) }] });
  const server = await createHapiServer(app, { logging: false });

  assert.equal((await server.inject({ method: "GET", url: "/me" })).statusCode, 401);
  assert.equal((await server.inject({ method: "GET", url: "/me", headers: { authorization: TOKEN } })).statusCode, 200);
});

test("the createHapiServer() authenticator overrides the application's", async () => {
  const app = createApplication({ name: "auth-override" });
  app.setAuthenticator(async () => ({ authenticated: true }));
  app.module({ name: "m", apis: [{ name: "me", method: "GET", path: "/me", auth: { required: true }, handler: () => ({}) }] });
  const server = await createHapiServer(app, { logging: false, authenticate: async () => ({ authenticated: false }) });

  assert.equal((await server.inject({ method: "GET", url: "/me" })).statusCode, 401);
});

test("an API that requires auth with no authenticator anywhere fails at startup", async () => {
  const app = createApplication({ name: "no-auth" });
  app.module({ name: "m", apis: [{ name: "me", method: "GET", path: "/me", auth: { required: true }, handler: () => ({}) }] });

  await assert.rejects(createHapiServer(app, { logging: false }), /requires auth, but no authenticator is configured/);
});

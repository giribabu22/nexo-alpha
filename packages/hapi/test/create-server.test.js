import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createHapiServer, toHapiPath } from "../dist/index.js";

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

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

/**
 * A browser app on another origin (e.g. a Vite dev server) calling resource,
 * auth and files routes: preflights must allow the methods and headers the
 * frontend client sends.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createApplication,
  createAuth,
  createFiles,
  createInMemoryBlobStore,
  createInMemoryDocumentStore,
  field,
  model,
  resource
} from "@nexo-alpha/core";
import { createHapiServer } from "../dist/index.js";

test("cors: true lets another origin call resource, auth and files routes", async () => {
  const store = createInMemoryDocumentStore();
  const auth = createAuth({ store, secret: "cors-test-secret-0123456789abcdefghijkl" });
  const app = createApplication({ name: "cors" });
  app.module(auth);
  app.module(createFiles({ store, blobs: createInMemoryBlobStore() }));
  app.module(resource(model("notes", { text: field.string() }), { store, auth: true }));
  const server = await createHapiServer(app, { logging: false, cors: true, authenticate: auth.authenticate });

  const origin = "http://localhost:5173";
  const preflight = (method, url, headers) =>
    server.inject({
      method: "OPTIONS",
      url,
      headers: { origin, "access-control-request-method": method, "access-control-request-headers": headers }
    });

  for (const [method, url, headers] of [
    ["PATCH", "/api/notes/n1", "authorization,content-type"],
    ["DELETE", "/api/notes/n1", "authorization"],
    ["POST", "/api/auth/login", "content-type"],
    ["POST", "/api/files?name=a.png", "authorization,content-type"]
  ]) {
    const response = await preflight(method, url, headers);
    assert.equal(response.statusCode, 200, `${method} ${url}`);
    assert.match(response.headers["access-control-allow-methods"], new RegExp(method), `${method} ${url}`);
    assert.match(response.headers["access-control-allow-headers"].toLowerCase(), /authorization/);
  }

  const { token } = await auth.register({ email: "ann@example.com", password: "correct horse" });
  const created = await server.inject({
    method: "POST",
    url: "/api/notes",
    payload: { text: "hi" },
    headers: { origin, authorization: `Bearer ${token}` }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.headers["access-control-allow-origin"], origin);
});

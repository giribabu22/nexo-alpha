/**
 * Memory HTTP API tests — served through @nexo-alpha/hapi.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createHapiServer } from "@nexo-alpha/hapi";

import { createInMemoryAgentMemory, createMemoryApiModule } from "../dist/index.js";

async function setup(moduleOptions = {}, serverOptions = {}) {
  const memory = createInMemoryAgentMemory();
  const app = createApplication({ name: "memory-api" });
  app.module(createMemoryApiModule({ memory, ...moduleOptions }));
  const server = await createHapiServer(app, { logging: false, ...serverOptions });
  const call = async (method, url, payload, headers = {}) => {
    const response = await server.inject({ method, url, headers, ...(payload !== undefined ? { payload } : {}) });
    return { status: response.statusCode, body: response.payload ? JSON.parse(response.payload) : undefined };
  };
  return { memory, call };
}

test("Memory API: put, get, recall with filters, delete", async () => {
  const { call } = await setup();

  const put = await call("PUT", "/memory/refund-policy", { value: { limit: 500 }, tags: ["policy", "refund"], scope: "support" });
  assert.equal(put.status, 200);
  assert.equal(put.body.key, "refund-policy");
  await call("PUT", "/memory/shipping", { value: "two days", tags: ["policy"] });

  assert.deepEqual((await call("GET", "/memory/refund-policy")).body.value, { limit: 500 });

  const byText = await call("GET", "/memory?text=refund");
  assert.deepEqual(byText.body.entries.map((e) => e.key), ["refund-policy"]);
  assert.equal((await call("GET", "/memory?tags=policy")).body.entries.length, 2);
  assert.equal((await call("GET", "/memory?tags=policy,refund")).body.entries.length, 1);
  assert.equal((await call("GET", "/memory?scope=support")).body.entries.length, 1);
  assert.equal((await call("GET", "/memory?limit=1")).body.entries.length, 1);

  assert.equal((await call("DELETE", "/memory/shipping")).status, 204);
  assert.equal((await call("GET", "/memory")).body.entries.length, 1);
});

test("Memory API: 404s for unknown keys, 400s for invalid input", async () => {
  const { call } = await setup();

  assert.equal((await call("GET", "/memory/nope")).body.code, "MEMORY_NOT_FOUND");
  assert.equal((await call("DELETE", "/memory/nope")).status, 404);

  assert.equal((await call("PUT", "/memory/k", {})).status, 400);
  assert.equal((await call("PUT", "/memory/k", { value: 1, tags: "x" })).status, 400);
  assert.equal((await call("PUT", "/memory/k", { value: 1, scope: 5 })).status, 400);
  assert.equal((await call("GET", "/memory?limit=0")).status, 400);
});

test("Memory API: writeAuth can require stronger scopes than reads", async () => {
  const { call } = await setup(
    { auth: { required: true }, writeAuth: { required: true, scopes: ["memory:write"] } },
    {
      authenticate: (context) => {
        const token = context.headers.authorization;
        if (token === "Bearer reader") return { authenticated: true, scopes: ["memory:read"] };
        if (token === "Bearer writer") return { authenticated: true, scopes: ["memory:*"] };
        return { authenticated: false };
      }
    }
  );

  assert.equal((await call("GET", "/memory")).status, 401);
  assert.equal((await call("GET", "/memory", undefined, { authorization: "Bearer reader" })).status, 200);
  assert.equal((await call("PUT", "/memory/k", { value: 1 }, { authorization: "Bearer reader" })).status, 403);
  assert.equal((await call("PUT", "/memory/k", { value: 1 }, { authorization: "Bearer writer" })).status, 200);
});

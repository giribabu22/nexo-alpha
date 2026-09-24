import test from "node:test";
import assert from "node:assert/strict";
import { createNexoClient, NexoClient, NexoApiError } from "../dist/index.js";

test("createNexoClient returns instance of NexoClient", () => {
  const client = createNexoClient({ baseUrl: "http://localhost:3000" });
  assert.ok(client instanceof NexoClient);
  assert.equal(client.baseUrl, "http://localhost:3000");
});

test("baseUrl strips trailing slashes", () => {
  const client = createNexoClient({ baseUrl: "http://localhost:3000///" });
  assert.equal(client.baseUrl, "http://localhost:3000");
});

test("client.getHealth makes GET request to /api/health", async () => {
  const mockHealth = {
    status: "ok",
    framework: "Nexo",
    uptimeSeconds: 120,
    timestamp: "2026-09-24T00:00:00.000Z",
    modules: ["system", "todos"],
    moduleGraph: [
      {
        name: "system",
        dependencies: [],
        dependents: ["todos"],
        externalDependencies: []
      },
      {
        name: "todos",
        dependencies: ["system"],
        dependents: [],
        externalDependencies: []
      }
    ]
  };

  const client = createNexoClient({
    baseUrl: "http://localhost:3000",
    fetch: async (url, init) => {
      assert.equal(url, "http://localhost:3000/api/health");
      assert.equal(init?.method, "GET");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => mockHealth
      };
    }
  });

  const health = await client.getHealth();
  assert.deepEqual(health, mockHealth);
});

test("client.getKnowledge makes GET request to /api/knowledge", async () => {
  const mockKnowledge = {
    decisions: [{ title: "Architecture", status: "accepted" }],
    constraints: [{ description: "Decoupled frontend" }],
    intents: [{ entityKind: "component", entityName: "Header", purpose: "Title" }],
    developmentState: { completed: ["Scaffold"] }
  };

  const client = createNexoClient({
    baseUrl: "http://localhost:3000",
    fetch: async (url, init) => {
      assert.equal(url, "http://localhost:3000/api/knowledge");
      assert.equal(init?.method, "GET");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => mockKnowledge
      };
    }
  });

  const knowledge = await client.getKnowledge();
  assert.deepEqual(knowledge, mockKnowledge);
});

test("client.getModules extracts moduleGraph from health", async () => {
  const mockHealth = {
    status: "ok",
    framework: "Nexo",
    uptimeSeconds: 10,
    timestamp: "2026-09-24T00:00:00.000Z",
    modules: ["system"],
    moduleGraph: [
      {
        name: "system",
        dependencies: [],
        dependents: [],
        externalDependencies: []
      }
    ]
  };

  const client = createNexoClient({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => mockHealth
    })
  });

  const modules = await client.getModules();
  assert.equal(modules.length, 1);
  assert.equal(modules[0].name, "system");
});

test("client.post sends JSON body with Content-Type header", async () => {
  let capturedInit;
  const client = createNexoClient({
    fetch: async (url, init) => {
      capturedInit = init;
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 1, text: "Buy milk" })
      };
    }
  });

  const res = await client.post("/api/todos", { text: "Buy milk" });
  assert.deepEqual(res, { id: 1, text: "Buy milk" });
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.headers?.["Content-Type"], "application/json");
  assert.equal(capturedInit?.body, JSON.stringify({ text: "Buy milk" }));
});

test("client throws NexoApiError on HTTP error status", async () => {
  const client = createNexoClient({
    fetch: async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "Item not found" })
    })
  });

  await assert.rejects(
    async () => client.get("/api/todos/999"),
    (err) => {
      assert.ok(err instanceof NexoApiError);
      assert.equal(err.status, 404);
      assert.equal(err.message, "Item not found");
      return true;
    }
  );
});

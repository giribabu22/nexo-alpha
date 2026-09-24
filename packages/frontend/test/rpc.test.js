import test from "node:test";
import assert from "node:assert/strict";
import { createNexoRpcClient } from "../dist/index.js";

test("rpc client resolves conventional routes", async () => {
  let capturedUrl;
  let capturedInit;

  const rpc = createNexoRpcClient({
    baseUrl: "http://localhost:4000",
    fetch: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 1, text: "Buy milk" }]
      };
    }
  });

  const todos = await rpc.todos.getTodos();
  assert.equal(capturedUrl, "http://localhost:4000/api/todos/getTodos");
  assert.equal(capturedInit?.method, "GET");
  assert.deepEqual(todos, [{ id: 1, text: "Buy milk" }]);
});

test("rpc client supports explicit custom route mapping", async () => {
  let capturedUrl;
  let capturedInit;

  const rpc = createNexoRpcClient({
    baseUrl: "http://localhost:4000",
    routes: {
      "todos.getTodos": { method: "GET", path: "/api/todos" },
      "todos.addTodo": { method: "POST", path: "/api/todos" }
    },
    fetch: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 2, text: "Write tests" })
      };
    }
  });

  await rpc.todos.getTodos();
  assert.equal(capturedUrl, "http://localhost:4000/api/todos");
  assert.equal(capturedInit?.method, "GET");

  await rpc.todos.addTodo({ text: "Write tests" });
  assert.equal(capturedUrl, "http://localhost:4000/api/todos");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.body, JSON.stringify({ text: "Write tests" }));
});

test("rpc client replaces path parameters and query strings", async () => {
  let capturedUrl;
  let capturedInit;

  const rpc = createNexoRpcClient({
    routes: {
      "todos.toggleTodo": { method: "POST", path: "/api/todos/{id}/toggle" },
      "users.getUser": { method: "GET", path: "/api/users/{id}" }
    },
    fetch: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      };
    }
  });

  await rpc.todos.toggleTodo({ id: 99 });
  assert.equal(capturedUrl, "/api/todos/99/toggle");
  assert.equal(capturedInit?.method, "POST");

  await rpc.users.getUser({ id: 5, includeDetails: true });
  assert.equal(capturedUrl, "/api/users/5?includeDetails=true");
  assert.equal(capturedInit?.method, "GET");
});

test("rpc client supports .query() and .mutate() aliases", async () => {
  let calledQuery = false;
  let calledMutate = false;

  const rpc = createNexoRpcClient({
    routes: {
      "todos.getTodos": { method: "GET", path: "/api/todos" },
      "todos.addTodo": { method: "POST", path: "/api/todos" }
    },
    fetch: async (_url, init) => {
      if (init?.method === "GET") calledQuery = true;
      if (init?.method === "POST") calledMutate = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({})
      };
    }
  });

  await rpc.todos.getTodos.query();
  assert.ok(calledQuery);

  await rpc.todos.addTodo.mutate({ text: "New Item" });
  assert.ok(calledMutate);
});

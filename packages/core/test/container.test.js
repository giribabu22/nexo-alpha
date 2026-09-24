import { test } from "node:test";
import assert from "node:assert/strict";
import { NexoContainer } from "../dist/container.js";
import { NexoResolutionError } from "../dist/errors.js";

test("container binds and resolves values", () => {
  const container = new NexoContainer();
  container.bindValue("config.port", 8080);

  assert.equal(container.resolve("config.port"), 8080);
  assert.equal(container.has("config.port"), true);
  assert.equal(container.has("nonexistent"), false);
});

test("container resolves transient instances with fresh copies", () => {
  const container = new NexoContainer();
  let count = 0;
  container.bind("generator", () => ({ id: ++count }), { lifetime: "transient" });

  const a = container.resolve("generator");
  const b = container.resolve("generator");

  assert.equal(a.id, 1);
  assert.equal(b.id, 2);
  assert.notEqual(a, b);
});

test("container resolves singleton instances with cached copies", () => {
  const container = new NexoContainer();
  let count = 0;
  container.bind("service", () => ({ id: ++count }), { singleton: true });

  const a = container.resolve("service");
  const b = container.resolve("service");

  assert.equal(a.id, 1);
  assert.equal(b.id, 1);
  assert.equal(a, b);
});

test("container resolves class constructor bindings", () => {
  class DatabaseClient {
    connected = true;
  }

  const container = new NexoContainer();
  container.bindClass("db", DatabaseClient, { singleton: true });

  const db = container.resolve("db");
  assert.ok(db instanceof DatabaseClient);
  assert.equal(db.connected, true);
  assert.equal(container.resolve("db"), db);
});

test("container supports child scoping and fallback", () => {
  const root = new NexoContainer();
  root.bindValue("global-setting", "production");
  root.bind("scoped-worker", () => ({ timestamp: Date.now() }), { lifetime: "scoped" });

  const child1 = root.createChild();
  const child2 = root.createChild();

  assert.equal(child1.resolve("global-setting"), "production");
  assert.equal(child2.resolve("global-setting"), "production");

  const worker1A = child1.resolve("scoped-worker");
  const worker1B = child1.resolve("scoped-worker");
  const worker2A = child2.resolve("scoped-worker");

  assert.equal(worker1A, worker1B);
  assert.notEqual(worker1A, worker2A);
});

test("container detects circular dependencies and throws NexoResolutionError", () => {
  const container = new NexoContainer();
  container.bind("serviceA", (c) => c.resolve("serviceB"));
  container.bind("serviceB", (c) => c.resolve("serviceA"));

  assert.throws(
    () => container.resolve("serviceA"),
    (err) => err instanceof NexoResolutionError && err.message.includes("Circular dependency")
  );
});

test("container throws NexoResolutionError for unregistered token", () => {
  const container = new NexoContainer();

  assert.throws(
    () => container.resolve("missing"),
    (err) => err instanceof NexoResolutionError && err.message.includes("missing")
  );
});

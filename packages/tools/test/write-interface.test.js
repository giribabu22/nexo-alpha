import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createWriteInterface } from "../dist/index.js";

function noGrants() {
  return { scopes: new Set() };
}

function sourceGrant() {
  return { scopes: new Set(["modify-source"]) };
}

function configGrant() {
  return { scopes: new Set(["modify-configuration"]) };
}

function buildFixtureApp() {
  const app = createApplication({ name: "shop" });

  app.module({
    name: "orders",
    apis: [{ name: "createOrder", method: "POST", path: "/orders" }],
    services: [{ name: "OrderService" }]
  });

  return app;
}

test("createModule denies without modify-source permission and records an audit entry", () => {
  const app = buildFixtureApp();
  const writes = createWriteInterface(app, noGrants());

  const result = writes.createModule({ name: "payments" }, "agent-1");

  assert.equal(result.success, false);
  assert.match(result.error, /Permission required/);
  assert.equal(app.getModule("payments"), undefined);

  const history = app.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].operation, "create_module");
  assert.equal(history[0].result, "denied");
  assert.equal(history[0].actor, "agent-1");
});

test("createModule succeeds with permission and audits success", () => {
  const app = buildFixtureApp();
  const writes = createWriteInterface(app, sourceGrant());

  const result = writes.createModule({ name: "payments" });

  assert.equal(result.success, true);
  assert.equal(app.getModule("payments").name, "payments");
  assert.equal(app.getHistory().at(-1).result, "success");
});

test("createModule fails validation for a duplicate module without granting the operation", () => {
  const app = buildFixtureApp();
  const writes = createWriteInterface(app, sourceGrant());

  const result = writes.createModule({ name: "orders" });

  assert.equal(result.success, false);
  assert.match(result.error, /already registered/);
  assert.equal(app.getHistory().at(-1).result, "failed");
});

test("createApi and modifyApi require modify-source and delegate to the core mutators", () => {
  const app = buildFixtureApp();

  const denied = createWriteInterface(app, noGrants()).createApi("orders", {
    name: "cancelOrder",
    method: "DELETE",
    path: "/orders/:id"
  });
  assert.equal(denied.success, false);

  const writes = createWriteInterface(app, sourceGrant());

  const created = writes.createApi("orders", {
    name: "cancelOrder",
    method: "DELETE",
    path: "/orders/:id"
  });
  assert.equal(created.success, true);

  const modified = writes.modifyApi("orders", "cancelOrder", { description: "Cancels an order" });
  assert.equal(modified.success, true);
  assert.equal(modified.data.description, "Cancels an order");

  const missing = writes.modifyApi("orders", "missing", {});
  assert.equal(missing.success, false);
  assert.match(missing.error, /not registered/);
});

test("createService and modifyService require modify-source and delegate to the core mutators", () => {
  const app = buildFixtureApp();
  const writes = createWriteInterface(app, sourceGrant());

  const created = writes.createService("orders", { name: "ShippingService" });
  assert.equal(created.success, true);

  const modified = writes.modifyService("orders", "ShippingService", { description: "Handles shipping" });
  assert.equal(modified.success, true);
  assert.equal(modified.data.description, "Handles shipping");
});

test("updateConfiguration requires modify-configuration, not modify-source", () => {
  const app = buildFixtureApp();

  const deniedBySourceOnly = createWriteInterface(app, sourceGrant()).updateConfiguration({ debug: true });
  assert.equal(deniedBySourceOnly.success, false);

  const result = createWriteInterface(app, configGrant()).updateConfiguration({ debug: true });
  assert.equal(result.success, true);
  assert.deepEqual(app.getAllConfig(), { debug: true });
});

test("addDependency requires modify-source and rejects invalid dependencies", () => {
  const app = buildFixtureApp();
  app.module({ name: "payments" });

  const writes = createWriteInterface(app, sourceGrant());

  const result = writes.addDependency("payments", "orders");
  assert.equal(result.success, true);
  assert.deepEqual(result.data, ["orders"]);

  const selfDep = writes.addDependency("payments", "payments");
  assert.equal(selfDep.success, false);
  assert.match(selfDep.error, /cannot depend on itself/);
});

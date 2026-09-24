import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";
import { createWriteInterface, createReadInterface } from "../dist/index.js";

function noGrants() {
  return { scopes: new Set() };
}

function sourceGrant() {
  return { scopes: new Set(["modify-source"]) };
}

function configGrant() {
  return { scopes: new Set(["modify-configuration"]) };
}

function knowledgeGrant() {
  return { scopes: new Set(["modify-knowledge"]) };
}

function buildFixture() {
  const app = createApplication({ name: "shop" });

  app.module({
    name: "orders",
    apis: [{ name: "createOrder", method: "POST", path: "/orders" }],
    services: [{ name: "OrderService" }]
  });

  const knowledge = createKnowledge();

  return { app, knowledge };
}

test("createModule denies without modify-source permission and records an audit entry", () => {
  const { app, knowledge } = buildFixture();
  const writes = createWriteInterface(app, knowledge, noGrants());

  const result = writes.createModule({ name: "payments" }, "agent-1");

  assert.equal(result.success, false);
  assert.match(result.error, /Permission required/);
  assert.equal(app.getModule("payments"), undefined);

  const history = knowledge.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].operation, "create_module");
  assert.equal(history[0].result, "denied");
  assert.equal(history[0].actor, "agent-1");
});

test("createModule succeeds with permission and audits success", () => {
  const { app, knowledge } = buildFixture();
  const writes = createWriteInterface(app, knowledge, sourceGrant());

  const result = writes.createModule({ name: "payments" });

  assert.equal(result.success, true);
  assert.equal(app.getModule("payments").name, "payments");
  assert.equal(knowledge.getHistory().at(-1).result, "success");
});

test("createModule fails validation for a duplicate module without granting the operation", () => {
  const { app, knowledge } = buildFixture();
  const writes = createWriteInterface(app, knowledge, sourceGrant());

  const result = writes.createModule({ name: "orders" });

  assert.equal(result.success, false);
  assert.match(result.error, /already registered/);
  assert.equal(knowledge.getHistory().at(-1).result, "failed");
});

test("createApi and modifyApi require modify-source and delegate to the core mutators", () => {
  const { app, knowledge } = buildFixture();

  const denied = createWriteInterface(app, knowledge, noGrants()).createApi("orders", {
    name: "cancelOrder",
    method: "DELETE",
    path: "/orders/:id"
  });
  assert.equal(denied.success, false);

  const writes = createWriteInterface(app, knowledge, sourceGrant());

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
  const { app, knowledge } = buildFixture();
  const writes = createWriteInterface(app, knowledge, sourceGrant());

  const created = writes.createService("orders", { name: "ShippingService" });
  assert.equal(created.success, true);

  const modified = writes.modifyService("orders", "ShippingService", { description: "Handles shipping" });
  assert.equal(modified.success, true);
  assert.equal(modified.data.description, "Handles shipping");
});

test("createJob and modifyJob require modify-source and delegate to the core mutators", () => {
  const { app, knowledge } = buildFixture();

  const denied = createWriteInterface(app, knowledge, noGrants()).createJob("orders", {
    name: "expireStaleOrders",
    schedule: "0 * * * *"
  });
  assert.equal(denied.success, false);

  const writes = createWriteInterface(app, knowledge, sourceGrant());

  const created = writes.createJob("orders", { name: "expireStaleOrders", schedule: "0 * * * *" });
  assert.equal(created.success, true);

  const modified = writes.modifyJob("orders", "expireStaleOrders", { schedule: "0 */2 * * *" });
  assert.equal(modified.success, true);
  assert.equal(modified.data.schedule, "0 */2 * * *");

  const missing = writes.modifyJob("orders", "missing", {});
  assert.equal(missing.success, false);
  assert.match(missing.error, /not registered/);
});

test("updateConfiguration requires modify-configuration, not modify-source", () => {
  const { app, knowledge } = buildFixture();

  const deniedBySourceOnly = createWriteInterface(app, knowledge, sourceGrant()).updateConfiguration({ debug: true });
  assert.equal(deniedBySourceOnly.success, false);

  const result = createWriteInterface(app, knowledge, configGrant()).updateConfiguration({ debug: true });
  assert.equal(result.success, true);
  assert.deepEqual(app.getAllConfig(), { debug: true });
});

test("addDependency requires modify-source and rejects invalid dependencies", () => {
  const { app, knowledge } = buildFixture();
  app.module({ name: "payments" });

  const writes = createWriteInterface(app, knowledge, sourceGrant());

  const result = writes.addDependency("payments", "orders");
  assert.equal(result.success, true);
  assert.deepEqual(result.data, ["orders"]);

  const selfDep = writes.addDependency("payments", "payments");
  assert.equal(selfDep.success, false);
  assert.match(selfDep.error, /cannot depend on itself/);
});

test("write operations are immediately observable through createReadInterface", () => {
  const { app, knowledge } = buildFixture();
  const writes = createWriteInterface(app, knowledge, sourceGrant());

  writes.createModule({
    name: "shipping",
    apis: [{ name: "calculateRate", method: "POST", path: "/shipping/rates" }],
    services: [{ name: "RateService" }]
  });

  const reads = createReadInterface(app, knowledge);
  const module = reads.getModule("shipping");

  assert.ok(module, "Module should be found by read interface");
  assert.equal(module.name, "shipping");
  assert.equal(reads.getApi("calculateRate")?.path, "/shipping/rates");
  assert.equal(reads.getService("RateService")?.name, "RateService");
  assert.equal(reads.getHistory().length, 1);
});

test("recordDecision requires modify-knowledge and persists to knowledge", () => {
  const { app, knowledge } = buildFixture();

  const denied = createWriteInterface(app, knowledge, noGrants()).recordDecision({
    id: "dec-1",
    title: "Use PostgreSQL",
    rationale: "Relational integrity required"
  });
  assert.equal(denied.success, false);
  assert.match(denied.error, /Permission required/);

  const writes = createWriteInterface(app, knowledge, knowledgeGrant());
  const result = writes.recordDecision({
    id: "dec-1",
    title: "Use PostgreSQL",
    rationale: "Relational integrity required"
  });

  assert.equal(result.success, true);
  assert.equal(result.data.id, "dec-1");
  assert.equal(knowledge.getDecisions().length, 1);
  assert.equal(knowledge.getDecisions()[0].title, "Use PostgreSQL");
});

test("recordConstraint requires modify-knowledge and persists to knowledge", () => {
  const { app, knowledge } = buildFixture();

  const denied = createWriteInterface(app, knowledge, sourceGrant()).recordConstraint({
    id: "c-1",
    type: "architectural",
    description: "No direct DB access outside services"
  });
  assert.equal(denied.success, false);
  assert.match(denied.error, /Permission required/);

  const writes = createWriteInterface(app, knowledge, knowledgeGrant());
  const result = writes.recordConstraint({
    id: "c-1",
    type: "architectural",
    description: "No direct DB access outside services"
  });

  assert.equal(result.success, true);
  assert.equal(knowledge.getConstraints().length, 1);
  assert.equal(knowledge.getConstraints()[0].type, "architectural");
});

test("recordIntent requires modify-knowledge and persists to knowledge", () => {
  const { app, knowledge } = buildFixture();

  const denied = createWriteInterface(app, knowledge, sourceGrant()).recordIntent({
    entityKind: "component",
    entityName: "CheckoutForm",
    purpose: "Collects payment details and submits a checkout."
  });
  assert.equal(denied.success, false);
  assert.match(denied.error, /Permission required/);
  assert.equal(knowledge.getHistory().at(-1).operation, "record_intent");
  assert.equal(knowledge.getHistory().at(-1).target, "component:CheckoutForm");

  const writes = createWriteInterface(app, knowledge, knowledgeGrant());
  const result = writes.recordIntent({
    entityKind: "component",
    entityName: "CheckoutForm",
    purpose: "Collects payment details and submits a checkout."
  });

  assert.equal(result.success, true);
  assert.equal(knowledge.getIntents().length, 1);
  assert.equal(knowledge.getIntent("component", "CheckoutForm").purpose, "Collects payment details and submits a checkout.");
  assert.equal(knowledge.getHistory().at(-1).result, "success");
});

test("updateDevelopmentState requires modify-knowledge and persists to knowledge", () => {
  const { app, knowledge } = buildFixture();

  const denied = createWriteInterface(app, knowledge, noGrants()).updateDevelopmentState({
    activeTasks: ["implement-checkout"]
  });
  assert.equal(denied.success, false);

  const writes = createWriteInterface(app, knowledge, knowledgeGrant());
  const result = writes.updateDevelopmentState({
    activeTasks: ["implement-checkout"],
    knownIssues: ["slow-tests"]
  });

  assert.equal(result.success, true);
  const state = knowledge.getDevelopmentState();
  assert.deepEqual(state.activeTasks, ["implement-checkout"]);
  assert.deepEqual(state.knownIssues, ["slow-tests"]);
});

test("createTest requires modify-source and records test operation", () => {
  const { app, knowledge } = buildFixture();

  const denied = createWriteInterface(app, knowledge, knowledgeGrant()).createTest(
    "orders",
    "orders.test.js",
    "unit"
  );
  assert.equal(denied.success, false);

  const writes = createWriteInterface(app, knowledge, sourceGrant());
  const result = writes.createTest("orders", "orders.test.js", "unit");

  assert.equal(result.success, true);
  assert.equal(result.data.module, "orders");
  assert.equal(result.data.test, "orders.test.js");
  assert.equal(result.data.spec, "unit");

  const missingMod = writes.createTest("unknown", "test.js");
  assert.equal(missingMod.success, false);
  assert.match(missingMod.error, /not registered/);
});

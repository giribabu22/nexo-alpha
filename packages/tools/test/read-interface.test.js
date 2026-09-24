import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";
import { createReadInterface } from "../dist/index.js";

function buildFixture() {
  const app = createApplication({
    name: "shop",
    version: "0.1.0",
    description: "A shop application",
    config: { region: "us-east-1" }
  });

  app.module({
    name: "orders",
    description: "Order management",
    purpose: "Track customer orders",
    apis: [{ name: "createOrder", method: "POST", path: "/orders" }],
    services: [{ name: "OrderService" }]
  });

  app.module({
    name: "payments",
    purpose: "Handle customer payments",
    status: "in-progress",
    dependencies: ["stripe", "orders"],
    apis: [{ name: "createPayment", method: "POST", path: "/payments" }],
    services: [{ name: "PaymentService" }]
  });

  const knowledge = createKnowledge();

  knowledge.addDecision({ title: "Use Redis for job coordination", status: "accepted" });
  knowledge.addConstraint({ description: "Payments must never be retried after a permanent decline." });
  knowledge.setDevelopmentState({
    currentObjective: "Implement payment recovery",
    completed: ["Retry API"]
  });

  return { app, knowledge };
}

test("getApplication returns identity and state", () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  assert.deepEqual(tools.getApplication(), {
    name: "shop",
    version: "0.1.0",
    description: "A shop application",
    state: "created"
  });
});

test("getModule finds a registered module and returns undefined otherwise", () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  const payments = tools.getModule("payments");
  assert.equal(payments.name, "payments");
  assert.equal(payments.status, "in-progress");

  assert.equal(tools.getModule("missing"), undefined);
});

test("getApi and getService find across modules and return undefined otherwise", () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  assert.equal(tools.getApi("createPayment").path, "/payments");
  assert.equal(tools.getApi("missing"), undefined);

  assert.equal(tools.getService("OrderService").name, "OrderService");
  assert.equal(tools.getService("missing"), undefined);
});

test("getDependencies and getDependents delegate to the application graph", () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  assert.deepEqual(tools.getDependencies("payments"), ["stripe", "orders"]);
  assert.deepEqual(tools.getDependents("orders"), ["payments"]);
});

test("getConfiguration returns the full config object", () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  assert.deepEqual(tools.getConfiguration(), { region: "us-east-1" });
});

test("getArchitecture aggregates modules, apis, and services", () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  const architecture = tools.getArchitecture();

  assert.equal(architecture.modules.length, 2);
  assert.deepEqual(
    architecture.apis.map((api) => api.name),
    ["createOrder", "createPayment"]
  );
  assert.deepEqual(
    architecture.services.map((service) => service.name),
    ["OrderService", "PaymentService"]
  );
});

test("getStructure returns a registry-derived rollup with a matching hash", () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  const { structure, structureHash } = tools.getStructure();

  assert.equal(structure.moduleCount, 2);
  assert.equal(structure.apiCount, 2);
  assert.equal(structure.serviceCount, 2);
  assert.deepEqual(structure.dependencyEdges, [
    { from: "payments", to: "orders" },
    { from: "payments", to: "stripe" }
  ]);
  assert.equal(typeof structureHash, "string");
  assert.equal(tools.getStructure().structureHash, structureHash);
});

test("getDecisions, getConstraints, getCurrentWork, and getStatus expose knowledge records", () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  assert.equal(tools.getDecisions().length, 1);
  assert.equal(tools.getConstraints().length, 1);

  const currentWork = tools.getCurrentWork();
  assert.equal(currentWork.currentObjective, "Implement payment recovery");
  assert.deepEqual(currentWork.completed, ["Retry API"]);

  const status = tools.getStatus();
  assert.equal(status.state, "created");
  assert.equal(status.developmentState.currentObjective, "Implement payment recovery");
});

test("getIntents and getIntent expose recorded intents, with no knowledge supplied defaulting to empty/undefined", () => {
  const { app, knowledge } = buildFixture();
  knowledge.addIntent({
    entityKind: "component",
    entityName: "CheckoutForm",
    purpose: "Collects payment details and submits a checkout."
  });

  const tools = createReadInterface(app, knowledge);
  assert.equal(tools.getIntents().length, 1);
  assert.equal(tools.getIntent("component", "CheckoutForm").purpose, "Collects payment details and submits a checkout.");
  assert.equal(tools.getIntent("component", "missing"), undefined);

  const toolsWithoutKnowledge = createReadInterface(app);
  assert.deepEqual(toolsWithoutKnowledge.getIntents(), []);
  assert.equal(toolsWithoutKnowledge.getIntent("component", "CheckoutForm"), undefined);
});

test("getHistory returns audit entries recorded on knowledge", () => {
  const { app, knowledge } = buildFixture();
  knowledge.addHistoryEntry({ operation: "create_module", target: "shipping", result: "success" });

  const tools = createReadInterface(app, knowledge);

  const history = tools.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].operation, "create_module");
  assert.equal(history[0].result, "success");
});

test("getKnowledgeGraph, search, and trace work over the registry alone, with no sourceTree supplied", async () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  const graph = await tools.getKnowledgeGraph();
  assert.ok(graph.nodes.some((n) => n.id === "module:payments"));
  assert.ok(!graph.nodes.some((n) => n.kind === "file"), "no sourceTree was supplied, so no file nodes");

  const found = await tools.search("payments");
  assert.ok(found.some((n) => n.id === "module:payments"));

  const dependents = await tools.traceDependents("module:orders");
  assert.ok(dependents.some((e) => e.from === "module:payments" && e.kind === "depends_on"));

  assert.deepEqual(await tools.traceCallers("module:orders"), []);
});

test("traceImpact walks the transitive dependents of a module", async () => {
  const { app, knowledge } = buildFixture();
  const tools = createReadInterface(app, knowledge);

  const result = await tools.traceImpact("module:orders");

  assert.equal(result.direction, "dependents");
  assert.ok(result.reached.some((hit) => hit.nodeId === "module:payments" && hit.depth === 1));
});


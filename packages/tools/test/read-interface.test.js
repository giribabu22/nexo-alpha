import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo/core";
import { createReadInterface } from "../dist/index.js";

function buildFixtureApp() {
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

  app.addDecision({ title: "Use Redis for job coordination", status: "accepted" });
  app.addConstraint({ description: "Payments must never be retried after a permanent decline." });
  app.setDevelopmentState({
    currentObjective: "Implement payment recovery",
    completed: ["Retry API"]
  });

  return app;
}

test("getApplication returns identity and state", () => {
  const tools = createReadInterface(buildFixtureApp());

  assert.deepEqual(tools.getApplication(), {
    name: "shop",
    version: "0.1.0",
    description: "A shop application",
    state: "created"
  });
});

test("getModule finds a registered module and returns undefined otherwise", () => {
  const tools = createReadInterface(buildFixtureApp());

  const payments = tools.getModule("payments");
  assert.equal(payments.name, "payments");
  assert.equal(payments.status, "in-progress");

  assert.equal(tools.getModule("missing"), undefined);
});

test("getApi and getService find across modules and return undefined otherwise", () => {
  const tools = createReadInterface(buildFixtureApp());

  assert.equal(tools.getApi("createPayment").path, "/payments");
  assert.equal(tools.getApi("missing"), undefined);

  assert.equal(tools.getService("OrderService").name, "OrderService");
  assert.equal(tools.getService("missing"), undefined);
});

test("getDependencies and getDependents delegate to the application graph", () => {
  const tools = createReadInterface(buildFixtureApp());

  assert.deepEqual(tools.getDependencies("payments"), ["stripe", "orders"]);
  assert.deepEqual(tools.getDependents("orders"), ["payments"]);
});

test("getConfiguration returns the full config object", () => {
  const tools = createReadInterface(buildFixtureApp());

  assert.deepEqual(tools.getConfiguration(), { region: "us-east-1" });
});

test("getArchitecture aggregates modules, apis, and services", () => {
  const tools = createReadInterface(buildFixtureApp());

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

test("getDecisions, getConstraints, getCurrentWork, and getStatus expose knowledge records", () => {
  const tools = createReadInterface(buildFixtureApp());

  assert.equal(tools.getDecisions().length, 1);
  assert.equal(tools.getConstraints().length, 1);

  const currentWork = tools.getCurrentWork();
  assert.equal(currentWork.currentObjective, "Implement payment recovery");
  assert.deepEqual(currentWork.completed, ["Retry API"]);

  const status = tools.getStatus();
  assert.equal(status.state, "created");
  assert.equal(status.developmentState.currentObjective, "Implement payment recovery");
});

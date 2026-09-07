import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo/core";
import { buildContext, contextToJson } from "../dist/index.js";

function buildFixtureApp() {
  const app = createApplication({
    name: "shop",
    version: "0.1.0",
    description: "A shop application"
  });

  app.module({
    name: "orders",
    description: "Order management",
    purpose: "Track customer orders"
  });

  app.module({
    name: "payments",
    purpose: "Handle customer payments",
    status: "in-progress",
    dependencies: ["stripe", "orders"],
    apis: [{ name: "createPayment", method: "POST", path: "/payments" }],
    services: [{ name: "PaymentService" }],
    events: ["payment.created"],
    jobs: [{ name: "retryFailedPayments", schedule: "*/5 * * * *" }]
  });

  return app;
}

test("buildContext produces application identity and module metadata", () => {
  const app = buildFixtureApp();
  const context = buildContext(app);

  assert.deepEqual(context.application, {
    name: "shop",
    version: "0.1.0",
    description: "A shop application",
    state: "created"
  });

  assert.equal(context.modules.length, 2);
});

test("buildContext computes dependents and defaults missing metadata to empty arrays", () => {
  const app = buildFixtureApp();
  const context = buildContext(app);

  const orders = context.modules.find((module) => module.name === "orders");
  const payments = context.modules.find(
    (module) => module.name === "payments"
  );

  assert.deepEqual(orders.dependencies, []);
  assert.deepEqual(orders.dependents, ["payments"]);
  assert.deepEqual(orders.apis, []);
  assert.deepEqual(orders.services, []);
  assert.deepEqual(orders.events, []);
  assert.deepEqual(orders.jobs, []);

  assert.deepEqual(payments.dependencies, ["stripe", "orders"]);
  assert.deepEqual(payments.dependents, []);
  assert.equal(payments.apis.length, 1);
  assert.equal(payments.services[0].name, "PaymentService");
  assert.deepEqual(payments.events, ["payment.created"]);
  assert.equal(payments.jobs[0].name, "retryFailedPayments");
});

test("contextToJson round-trips through JSON.parse", () => {
  const app = buildFixtureApp();
  const context = buildContext(app);

  const json = contextToJson(context);
  const parsed = JSON.parse(json);

  assert.deepEqual(parsed, context);
});

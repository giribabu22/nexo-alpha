import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "../dist/index.js";

test("getDependencies and getDependents traverse the module graph", () => {
  const app = createApplication({ name: "shop" });

  app.module({ name: "orders" });
  app.module({
    name: "payments",
    dependencies: ["stripe", "orders"]
  });

  assert.deepEqual(app.getDependencies("payments"), ["stripe", "orders"]);
  assert.deepEqual(app.getDependencies("orders"), []);
  assert.deepEqual(app.getDependencies("unknown"), []);

  assert.deepEqual(app.getDependents("orders"), ["payments"]);
  assert.deepEqual(app.getDependents("stripe"), ["payments"]);
  assert.deepEqual(app.getDependents("payments"), []);
});

test("getApis, getServices, and getJobs flatten across modules", () => {
  const app = createApplication({ name: "shop" });

  app.module({
    name: "orders",
    apis: [{ name: "createOrder", method: "POST", path: "/orders" }],
    services: [{ name: "OrderService" }],
    jobs: [{ name: "expireStaleOrders", schedule: "0 * * * *" }]
  });
  app.module({ name: "notifications" });
  app.module({
    name: "payments",
    apis: [
      { name: "createPayment", method: "POST", path: "/payments" },
      { name: "getPayment", method: "GET", path: "/payments/:id" }
    ],
    services: [{ name: "PaymentService" }],
    jobs: [{ name: "retryFailedPayments", schedule: "*/5 * * * *" }]
  });

  assert.deepEqual(
    app.getApis().map((api) => api.name),
    ["createOrder", "createPayment", "getPayment"]
  );
  assert.deepEqual(
    app.getServices().map((service) => service.name),
    ["OrderService", "PaymentService"]
  );
  assert.deepEqual(
    app.getJobs().map((job) => job.name),
    ["expireStaleOrders", "retryFailedPayments"]
  );
});

test("events bus delivers emitted payloads to listeners", () => {
  const app = createApplication({ name: "shop" });

  let received;
  app.events.on("order.created", (payload) => {
    received = payload;
  });

  app.events.emit("order.created", { orderId: "123" });

  assert.deepEqual(received, { orderId: "123" });
});

test("getConfig reads configured values and returns undefined for missing keys", () => {
  const app = createApplication({
    name: "shop",
    config: { region: "us-east-1" }
  });

  assert.equal(app.getConfig("region"), "us-east-1");
  assert.equal(app.getConfig("missing"), undefined);
});

test("getAllConfig returns the full configured object", () => {
  const app = createApplication({
    name: "shop",
    config: { region: "us-east-1", tier: "standard" }
  });

  assert.deepEqual(app.getAllConfig(), { region: "us-east-1", tier: "standard" });
});

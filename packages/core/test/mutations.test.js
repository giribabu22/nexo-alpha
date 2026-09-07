import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "../dist/index.js";

function buildFixtureApp() {
  const app = createApplication({ name: "shop" });

  app.module({
    name: "orders",
    apis: [{ name: "createOrder", method: "POST", path: "/orders" }],
    services: [{ name: "OrderService" }]
  });

  app.module({ name: "payments" });

  return app;
}

test("addApiToModule appends a new api", () => {
  const app = buildFixtureApp();

  app.addApiToModule("orders", { name: "cancelOrder", method: "DELETE", path: "/orders/:id" });

  assert.deepEqual(
    app.getModule("orders").apis.map((api) => api.name),
    ["createOrder", "cancelOrder"]
  );
});

test("addApiToModule rejects a missing module or a duplicate api name", () => {
  const app = buildFixtureApp();

  assert.throws(() => app.addApiToModule("missing", { name: "x", method: "GET", path: "/x" }), /not registered/);
  assert.throws(
    () => app.addApiToModule("orders", { name: "createOrder", method: "GET", path: "/orders" }),
    /already registered/
  );
});

test("updateApi merges a patch into an existing api", () => {
  const app = buildFixtureApp();

  const updated = app.updateApi("orders", "createOrder", { description: "Creates an order" });

  assert.equal(updated.description, "Creates an order");
  assert.equal(
    app.getApis().find((api) => api.name === "createOrder").description,
    "Creates an order"
  );
});

test("updateApi rejects a missing module or api", () => {
  const app = buildFixtureApp();

  assert.throws(() => app.updateApi("missing", "createOrder", {}), /not registered/);
  assert.throws(() => app.updateApi("orders", "missing", {}), /not registered/);
});

test("addServiceToModule appends a new service", () => {
  const app = buildFixtureApp();

  app.addServiceToModule("orders", { name: "ShippingService" });

  assert.deepEqual(
    app.getModule("orders").services.map((service) => service.name),
    ["OrderService", "ShippingService"]
  );
});

test("addServiceToModule rejects a missing module or a duplicate service name", () => {
  const app = buildFixtureApp();

  assert.throws(() => app.addServiceToModule("missing", { name: "x" }), /not registered/);
  assert.throws(() => app.addServiceToModule("orders", { name: "OrderService" }), /already registered/);
});

test("updateService merges a patch into an existing service", () => {
  const app = buildFixtureApp();

  const updated = app.updateService("orders", "OrderService", { description: "Manages orders" });

  assert.equal(updated.description, "Manages orders");
});

test("updateService rejects a missing module or service", () => {
  const app = buildFixtureApp();

  assert.throws(() => app.updateService("missing", "OrderService", {}), /not registered/);
  assert.throws(() => app.updateService("orders", "missing", {}), /not registered/);
});

test("addJobToModule appends a new job", () => {
  const app = buildFixtureApp();

  app.addJobToModule("orders", { name: "expireStaleOrders", schedule: "0 * * * *" });

  assert.deepEqual(
    app.getModule("orders").jobs.map((job) => job.name),
    ["expireStaleOrders"]
  );
});

test("addJobToModule rejects a missing module or a duplicate job name", () => {
  const app = buildFixtureApp();

  assert.throws(() => app.addJobToModule("missing", { name: "x" }), /not registered/);

  app.addJobToModule("orders", { name: "expireStaleOrders", schedule: "0 * * * *" });
  assert.throws(
    () => app.addJobToModule("orders", { name: "expireStaleOrders", schedule: "0 * * * *" }),
    /already registered/
  );
});

test("updateJob merges a patch into an existing job", () => {
  const app = buildFixtureApp();
  app.addJobToModule("orders", { name: "expireStaleOrders", schedule: "0 * * * *" });

  const updated = app.updateJob("orders", "expireStaleOrders", { schedule: "0 */2 * * *" });

  assert.equal(updated.schedule, "0 */2 * * *");
});

test("updateJob rejects a missing module or job", () => {
  const app = buildFixtureApp();

  assert.throws(() => app.updateJob("missing", "expireStaleOrders", {}), /not registered/);
  assert.throws(() => app.updateJob("orders", "missing", {}), /not registered/);
});

test("updateConfig shallow-merges into the application config", () => {
  const app = createApplication({ name: "shop", config: { region: "us-east-1" } });

  const config = app.updateConfig({ debug: true });

  assert.deepEqual(config, { region: "us-east-1", debug: true });
  assert.deepEqual(app.getAllConfig(), { region: "us-east-1", debug: true });
});

test("addModuleDependency appends a new dependency and rejects invalid ones", () => {
  const app = buildFixtureApp();

  const dependencies = app.addModuleDependency("payments", "orders");
  assert.deepEqual(dependencies, ["orders"]);

  assert.throws(() => app.addModuleDependency("payments", "payments"), /cannot depend on itself/);
  assert.throws(() => app.addModuleDependency("payments", "missing"), /not registered/);
  assert.throws(() => app.addModuleDependency("payments", "orders"), /already depends/);
});

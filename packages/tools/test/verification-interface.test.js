import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createVerificationInterface } from "../dist/index.js";

test("a clean application has no validation issues", () => {
  const app = createApplication({ name: "shop", config: { region: "us-east-1" } });

  app.module({ name: "orders" });
  app.module({ name: "payments", dependencies: ["orders"] });

  const verify = createVerificationInterface(app);

  assert.deepEqual(verify.validateArchitecture(), { valid: true, issues: [] });
  assert.deepEqual(verify.validateConfiguration(), { valid: true, issues: [] });
});

test("validateArchitecture flags a self-dependency as an error", () => {
  const app = createApplication({ name: "shop" });
  app.module({ name: "payments", dependencies: ["payments"] });

  const result = createVerificationInterface(app).validateArchitecture();

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.severity === "error" && /depends on itself/.test(issue.message)));
});

test("validateArchitecture flags a dependency cycle as an error, reported once", () => {
  const app = createApplication({ name: "shop" });
  app.module({ name: "a", dependencies: ["b"] });
  app.module({ name: "b", dependencies: ["a"] });

  const result = createVerificationInterface(app).validateArchitecture();

  assert.equal(result.valid, false);

  const cycleIssues = result.issues.filter((issue) => /Dependency cycle detected/.test(issue.message));
  assert.equal(cycleIssues.length, 1);
});

test("validateArchitecture flags an unregistered dependency as a warning only", () => {
  const app = createApplication({ name: "shop" });
  app.module({ name: "payments", dependencies: ["stripe"] });

  const result = createVerificationInterface(app).validateArchitecture();

  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "warning");
  assert.match(result.issues[0].message, /not a registered module/);
});

test("validateConfiguration flags a function-valued key as a warning", () => {
  const app = createApplication({ name: "shop", config: { onReady: () => {} } });

  const result = createVerificationInterface(app).validateConfiguration();

  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "warning");
  assert.equal(result.issues[0].target, "onReady");
});

test("validateConfiguration flags a circular config value as an error", () => {
  const circular = {};
  circular.self = circular;

  const app = createApplication({ name: "shop", config: { circular } });

  const result = createVerificationInterface(app).validateConfiguration();

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.severity === "error"));
});

test("inspectDependencies returns the full graph across all modules", () => {
  const app = createApplication({ name: "shop" });
  app.module({ name: "orders" });
  app.module({ name: "payments", dependencies: ["orders"] });

  const graph = createVerificationInterface(app).inspectDependencies();

  assert.deepEqual(graph, [
    { module: "orders", dependencies: [], dependents: ["payments"] },
    { module: "payments", dependencies: ["orders"], dependents: [] }
  ]);
});

test("checkApplicationHealth reports counts and embeds the architecture result", () => {
  const app = createApplication({ name: "shop" });
  app.module({
    name: "orders",
    apis: [{ name: "createOrder", method: "POST", path: "/orders", service: "OrderService" }],
    services: [{ name: "OrderService" }]
  });

  const health = createVerificationInterface(app).checkApplicationHealth();

  assert.equal(health.state, "created");
  assert.equal(health.moduleCount, 1);
  assert.equal(health.apiCount, 1);
  assert.equal(health.serviceCount, 1);
  assert.deepEqual(health.architecture, { valid: true, issues: [] });
});

test("validateArchitecture flags an unregistered api service as a warning", () => {
  const app = createApplication({ name: "shop" });
  app.module({
    name: "orders",
    apis: [{ name: "createOrder", method: "POST", path: "/orders", service: "MissingService" }]
  });

  const result = createVerificationInterface(app).validateArchitecture();

  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "warning");
  assert.match(result.issues[0].message, /references service "MissingService", which is not registered/);
});

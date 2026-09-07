import test from "node:test";
import assert from "node:assert/strict";

import {
  renderApplicationSummary,
  renderModuleDetail,
  renderDevelopmentState
} from "../dist/render.js";

test("renderApplicationSummary includes identity, state, and module names", () => {
  const output = renderApplicationSummary({
    application: { name: "shop", version: "0.1.0", description: "A shop", state: "running" },
    modules: [{ name: "orders" }, { name: "payments" }]
  });

  assert.match(output, /Name: shop/);
  assert.match(output, /Version: 0\.1\.0/);
  assert.match(output, /Description: A shop/);
  assert.match(output, /State: running/);
  assert.match(output, /orders/);
  assert.match(output, /payments/);
});

test("renderApplicationSummary shows (none) when there are no modules", () => {
  const output = renderApplicationSummary({
    application: { name: "empty", version: "0.1.0", state: "created" },
    modules: []
  });

  assert.match(output, /\(none\)/);
});

test("renderModuleDetail shows populated fields and (none) for empty lists", () => {
  const output = renderModuleDetail({
    name: "payments",
    purpose: "Handle customer payments",
    status: "in-progress",
    dependencies: ["stripe", "orders"],
    dependents: [],
    apis: [{ name: "createPayment", method: "POST", path: "/payments" }],
    services: [],
    events: ["payment.created"],
    jobs: [{ name: "retryFailedPayments", schedule: "*/5 * * * *" }]
  });

  assert.match(output, /^payments/);
  assert.match(output, /Purpose: Handle customer payments/);
  assert.match(output, /Status: in-progress/);
  assert.match(output, /stripe/);
  assert.match(output, /POST \/payments  createPayment/);
  assert.match(output, /retryFailedPayments  \(\*\/5 \* \* \* \*\)/);

  const dependentsSection = output.split("Dependents:")[1].split("APIs:")[0];
  assert.match(dependentsSection, /\(none\)/);
});

test("renderDevelopmentState shows populated and empty fields correctly", () => {
  const output = renderDevelopmentState({
    currentObjective: "Implement payment recovery",
    completed: ["Retry API"],
    inProgress: [],
    blocked: [],
    knownIssues: [],
    nextStep: "Resolve webhook ordering"
  });

  assert.match(output, /Implement payment recovery/);
  assert.match(output, /Retry API/);
  assert.match(output, /Resolve webhook ordering/);

  const blockedSection = output.split("Blocked:")[1].split("Known issues:")[0];
  assert.match(blockedSection, /\(none\)/);
});

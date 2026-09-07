import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import {
  buildContext,
  contextToJson,
  createKnowledge,
  describeStructure,
  hashSourceTree,
  hashStructure
} from "../dist/index.js";

function buildFixture() {
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

  const knowledge = createKnowledge();

  knowledge.addDecision({
    title: "Use Redis for job coordination",
    reason: "Multiple application instances require shared job state.",
    status: "accepted"
  });

  knowledge.addConstraint({
    description: "Failed permanent payment declines must not be retried."
  });

  knowledge.setDevelopmentState({
    currentObjective: "Implement payment recovery",
    completed: ["Retry API"],
    inProgress: ["Retry worker"]
  });

  return { app, knowledge };
}

test("buildContext produces application identity and module metadata", () => {
  const { app, knowledge } = buildFixture();
  const context = buildContext(app, knowledge);

  assert.deepEqual(context.application, {
    name: "shop",
    version: "0.1.0",
    description: "A shop application",
    state: "created"
  });

  assert.equal(context.modules.length, 2);
});

test("buildContext computes dependents and defaults missing metadata to empty arrays", () => {
  const { app, knowledge } = buildFixture();
  const context = buildContext(app, knowledge);

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

test("buildContext surfaces decisions, constraints, and development state", () => {
  const { app, knowledge } = buildFixture();
  const context = buildContext(app, knowledge);

  assert.equal(context.decisions.length, 1);
  assert.equal(context.decisions[0].title, "Use Redis for job coordination");
  assert.equal(context.decisions[0].status, "accepted");

  assert.equal(context.constraints.length, 1);
  assert.equal(
    context.constraints[0].description,
    "Failed permanent payment declines must not be retried."
  );

  assert.equal(context.developmentState.currentObjective, "Implement payment recovery");
  assert.deepEqual(context.developmentState.completed, ["Retry API"]);
  assert.deepEqual(context.developmentState.inProgress, ["Retry worker"]);
  assert.deepEqual(context.developmentState.blocked, []);
  assert.deepEqual(context.developmentState.knownIssues, []);
});

test("buildContext includes a structure rollup derived from the app registry", () => {
  const { app, knowledge } = buildFixture();
  const context = buildContext(app, knowledge);

  assert.deepEqual(context.structure, {
    moduleCount: 2,
    apiCount: 1,
    serviceCount: 1,
    jobCount: 1,
    dependencyEdges: [
      { from: "payments", to: "orders" },
      { from: "payments", to: "stripe" }
    ]
  });
  assert.equal(context.structureHash, hashStructure(context.structure));
});

test("describeStructure sorts dependency edges regardless of module registration order", () => {
  const a = createApplication({ name: "a" });
  a.module({ name: "orders" });
  a.module({ name: "payments", dependencies: ["stripe", "orders"] });

  const b = createApplication({ name: "b" });
  b.module({ name: "payments", dependencies: ["stripe", "orders"] });
  b.module({ name: "orders" });

  assert.deepEqual(describeStructure(a).dependencyEdges, describeStructure(b).dependencyEdges);
});

test("hashStructure is stable for identical structure and changes when structure changes", () => {
  const { app, knowledge } = buildFixture();
  const structure = describeStructure(app);

  assert.equal(hashStructure(structure), hashStructure(describeStructure(app)));

  app.module({ name: "shipping" });
  assert.notEqual(hashStructure(structure), hashStructure(describeStructure(app)));
});

test("hashSourceTree is sensitive to a call edge's confidence field", () => {
  const baseTree = {
    fileCount: 1,
    files: [],
    importEdges: [],
    callEdges: [{ from: { file: "a.ts", symbol: "run" }, to: { file: "b.ts", symbol: "Widget" } }]
  };
  const heuristicTree = {
    ...baseTree,
    callEdges: [{ ...baseTree.callEdges[0], confidence: "heuristic" }]
  };

  assert.notEqual(hashSourceTree(baseTree), hashSourceTree(heuristicTree));
});

test("contextToJson round-trips through JSON.parse", () => {
  const { app, knowledge } = buildFixture();
  const context = buildContext(app, knowledge);

  const json = contextToJson(context);
  const parsed = JSON.parse(json);

  assert.deepEqual(parsed, context);
});

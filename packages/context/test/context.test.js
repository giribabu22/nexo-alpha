import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createApplication } from "@nexo-alpha/core";
import {
  buildContext,
  contextToJson,
  createKnowledge,
  describeStructure,
  hashSourceFile,
  hashSourceTree,
  hashSourceTreeFiles,
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

test("buildContext surfaces intents, and defaults to empty when no knowledge is supplied", () => {
  const { app, knowledge } = buildFixture();

  knowledge.addIntent({
    entityKind: "component",
    entityName: "CheckoutForm",
    purpose: "Collects payment details and submits a checkout.",
    evidence: { file: "src/frontend/CheckoutForm.tsx", line: 12 }
  });

  const context = buildContext(app, knowledge);
  assert.equal(context.intents.length, 1);
  assert.equal(context.intents[0].entityName, "CheckoutForm");

  const contextWithoutKnowledge = buildContext(app);
  assert.deepEqual(contextWithoutKnowledge.intents, []);
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

test("hashSourceTree's own output is unchanged by the canonicalSourceFileString extraction", () => {
  const tree = {
    fileCount: 1,
    files: [
      {
        path: "a.ts",
        exports: ["run"],
        imports: ["./b.js"],
        symbols: [{ name: "run", kind: "function", exported: true, line: 1 }]
      }
    ],
    importEdges: [{ from: "a.ts", to: "b.ts" }],
    callEdges: [{ from: { file: "a.ts", symbol: "run" }, to: { file: "b.ts", symbol: "helper" } }]
  };

  // Replicates the pre-refactor inline formula exactly, so this pins
  // hashSourceTree's output against independently-computed canonical JSON
  // rather than against itself.
  const preRefactorCanonical = JSON.stringify({
    files: tree.files.map(
      (file) =>
        `${file.path}:${file.exports.join(",")}:${file.imports.join(",")}:` +
        file.symbols.map((symbol) => `${symbol.name}/${symbol.kind}/${symbol.exported}`).join(",")
    ),
    importEdges: [...tree.importEdges].map((edge) => `${edge.from}->${edge.to}`).sort(),
    callEdges: [...tree.callEdges]
      .map(
        (edge) =>
          `${edge.from.file}#${edge.from.symbol}->${
            edge.to !== undefined ? `${edge.to.file}#${edge.to.symbol}` : `external:${edge.toExternal}`
          }${edge.confidence !== undefined ? `|${edge.confidence}` : ""}`
      )
      .sort()
  });
  const preRefactorHash = createHash("sha256").update(preRefactorCanonical).digest("hex");

  assert.equal(hashSourceTree(tree), preRefactorHash);
});

test("hashSourceFile is deterministic and sensitive to exports/imports/symbols", () => {
  const file = {
    path: "a.ts",
    exports: ["run"],
    imports: ["./b.js"],
    symbols: [{ name: "run", kind: "function", exported: true, line: 1 }]
  };

  assert.equal(hashSourceFile(file), hashSourceFile({ ...file }));

  assert.notEqual(hashSourceFile(file), hashSourceFile({ ...file, exports: [...file.exports, "extra"] }));
  assert.notEqual(hashSourceFile(file), hashSourceFile({ ...file, imports: [...file.imports, "./c.js"] }));
  assert.notEqual(
    hashSourceFile(file),
    hashSourceFile({ ...file, symbols: [...file.symbols, { name: "helper", kind: "function", exported: false, line: 2 }] })
  );

  // path is part of the fingerprint too, since the same shape at a different location is a different file.
  assert.notEqual(hashSourceFile(file), hashSourceFile({ ...file, path: "b.ts" }));
});

test("hashSourceTreeFiles hashes every file, keyed by its exact path", () => {
  const tree = {
    fileCount: 2,
    files: [
      { path: "a.ts", exports: ["run"], imports: [], symbols: [] },
      { path: "nested/b.ts", exports: ["helper"], imports: [], symbols: [] }
    ],
    importEdges: [],
    callEdges: []
  };

  const hashes = hashSourceTreeFiles(tree);

  assert.deepEqual(Object.keys(hashes).sort(), ["a.ts", "nested/b.ts"]);
  assert.equal(hashes["a.ts"], hashSourceFile(tree.files[0]));
  assert.equal(hashes["nested/b.ts"], hashSourceFile(tree.files[1]));
});

test("contextToJson round-trips through JSON.parse", () => {
  const { app, knowledge } = buildFixture();
  const context = buildContext(app, knowledge);

  const json = contextToJson(context);
  const parsed = JSON.parse(json);

  assert.deepEqual(parsed, context);
});

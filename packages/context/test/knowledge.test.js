import test from "node:test";
import assert from "node:assert/strict";

import {
  createKnowledge,
  knowledgeToJson,
  knowledgeFromJson,
  KNOWLEDGE_SCHEMA_VERSION
} from "../dist/index.js";

test("addDecision and getDecisions accumulate in order", () => {
  const knowledge = createKnowledge();

  knowledge.addDecision({ title: "Use Redis for job coordination", status: "accepted" });
  knowledge.addDecision({ title: "Use Postgres for orders", status: "proposed" });

  assert.deepEqual(
    knowledge.getDecisions().map((decision) => decision.title),
    ["Use Redis for job coordination", "Use Postgres for orders"]
  );
});

test("addConstraint and getConstraints accumulate in order", () => {
  const knowledge = createKnowledge();

  knowledge.addConstraint({
    description: "Failed permanent payment declines must not be retried."
  });

  assert.equal(knowledge.getConstraints().length, 1);
  assert.equal(
    knowledge.getConstraints()[0].description,
    "Failed permanent payment declines must not be retried."
  );
});

test("getDevelopmentState starts empty with no optional keys", () => {
  const knowledge = createKnowledge();

  const state = knowledge.getDevelopmentState();

  assert.deepEqual(state, {
    completed: [],
    inProgress: [],
    blocked: [],
    knownIssues: []
  });
  assert.equal("currentObjective" in state, false);
  assert.equal("nextStep" in state, false);
});

test("setDevelopmentState merges without clobbering untouched fields", () => {
  const knowledge = createKnowledge();

  knowledge.setDevelopmentState({
    currentObjective: "Implement payment recovery",
    completed: ["Retry API", "Retry model"]
  });

  knowledge.setDevelopmentState({
    inProgress: ["Retry worker"]
  });

  const state = knowledge.getDevelopmentState();

  assert.equal(state.currentObjective, "Implement payment recovery");
  assert.deepEqual(state.completed, ["Retry API", "Retry model"]);
  assert.deepEqual(state.inProgress, ["Retry worker"]);
  assert.deepEqual(state.blocked, []);

  knowledge.setDevelopmentState({ completed: ["Retry API"] });
  assert.deepEqual(knowledge.getDevelopmentState().completed, ["Retry API"]);
});

test("addHistoryEntry stamps a timestamp and getHistory returns in order", () => {
  const knowledge = createKnowledge();

  knowledge.addHistoryEntry({ operation: "create_module", target: "payments", result: "success" });
  knowledge.addHistoryEntry({ operation: "modify_api", target: "payments.createPayment", actor: "agent-1", result: "denied" });

  const history = knowledge.getHistory();

  assert.equal(history.length, 2);
  assert.equal(history[0].operation, "create_module");
  assert.equal(history[0].result, "success");
  assert.ok(history[0].timestamp, "timestamp should be present");

  assert.equal(history[1].operation, "modify_api");
  assert.equal(history[1].actor, "agent-1");
  assert.equal(history[1].result, "denied");
});

test("getHistory starts empty", () => {
  const knowledge = createKnowledge();
  assert.deepEqual(knowledge.getHistory(), []);
});

test("method calls are chainable", () => {
  const knowledge = createKnowledge();

  const result = knowledge
    .addDecision({ title: "D1", status: "accepted" })
    .addConstraint({ description: "C1" })
    .setDevelopmentState({ currentObjective: "Build something" });

  assert.strictEqual(result, knowledge);
  assert.equal(knowledge.getDecisions().length, 1);
  assert.equal(knowledge.getConstraints().length, 1);
  assert.equal(knowledge.getDevelopmentState().currentObjective, "Build something");
});

test("knowledgeToJson and knowledgeFromJson round-trip cleanly", () => {
  const original = createKnowledge();
  original
    .addDecision({ title: "Use Postgres", status: "accepted" })
    .addConstraint({ description: "No plain passwords" })
    .setDevelopmentState({ currentObjective: "Auth module", completed: ["Hash utility"] })
    .addHistoryEntry({ operation: "create_module", target: "auth", result: "success" })
    .addIntent({
      entityKind: "component",
      entityName: "LoginForm",
      purpose: "Collects credentials and starts a session.",
      evidence: { file: "src/frontend/LoginForm.tsx", line: 8 }
    });

  const json = knowledgeToJson(original);
  const loaded = knowledgeFromJson(json);

  assert.deepEqual(loaded.getDecisions(), original.getDecisions());
  assert.deepEqual(loaded.getConstraints(), original.getConstraints());
  assert.deepEqual(loaded.getDevelopmentState(), original.getDevelopmentState());
  assert.equal(loaded.getHistory().length, 1);
  assert.equal(loaded.getHistory()[0].operation, "create_module");
  assert.deepEqual(loaded.getIntents(), original.getIntents());
});

test("knowledgeFromJson loads a version-1 snapshot with no intents field as an empty list", () => {
  const legacySnapshot = JSON.stringify({
    decisions: [{ title: "Use Postgres" }],
    constraints: [],
    developmentState: { completed: [], inProgress: [], blocked: [], knownIssues: [] },
    history: [],
    generatedAt: new Date().toISOString(),
    schemaVersion: 1
  });

  const loaded = knowledgeFromJson(legacySnapshot);

  assert.deepEqual(loaded.getIntents(), []);
  assert.equal(loaded.getDecisions().length, 1);
});

test("addIntent and getIntents accumulate in order", () => {
  const knowledge = createKnowledge();

  knowledge.addIntent({
    entityKind: "api",
    entityName: "retry",
    purpose: "Retry transient payment failures."
  });
  knowledge.addIntent({
    entityKind: "component",
    entityName: "CheckoutForm",
    purpose: "Collects payment details and submits a checkout."
  });

  assert.deepEqual(
    knowledge.getIntents().map((intent) => intent.entityName),
    ["retry", "CheckoutForm"]
  );
});

test("getIntent returns undefined when nothing was recorded for that entity", () => {
  const knowledge = createKnowledge();
  assert.equal(knowledge.getIntent("component", "Missing"), undefined);
});

test("getIntent returns the most recently recorded intent for an entity", () => {
  const knowledge = createKnowledge();

  knowledge.addIntent({ entityKind: "function", entityName: "processPayment", purpose: "First pass." });
  knowledge.addIntent({ entityKind: "function", entityName: "processPayment", purpose: "Revised." });
  // A same-named entity of a different kind must not be confused with it.
  knowledge.addIntent({ entityKind: "component", entityName: "processPayment", purpose: "Unrelated component." });

  const intent = knowledge.getIntent("function", "processPayment");
  assert.equal(intent.purpose, "Revised.");
});

test("addIntent preserves businessReason, dependencies, and evidence", () => {
  const knowledge = createKnowledge();

  knowledge.addIntent({
    entityKind: "component",
    entityName: "CheckoutForm",
    purpose: "Collects payment details and submits a checkout.",
    businessReason: "Customers need a single-page checkout to reduce drop-off.",
    dependencies: ["payments.retry"],
    evidence: { file: "src/frontend/CheckoutForm.tsx", line: 12 }
  });

  const [intent] = knowledge.getIntents();
  assert.equal(intent.businessReason, "Customers need a single-page checkout to reduce drop-off.");
  assert.deepEqual(intent.dependencies, ["payments.retry"]);
  assert.deepEqual(intent.evidence, { file: "src/frontend/CheckoutForm.tsx", line: 12 });
});

test("knowledgeToJson stamps a schema version and a generation timestamp", () => {
  const knowledge = createKnowledge();
  knowledge.addDecision({ title: "Use Postgres" });

  const json = knowledgeToJson(knowledge);
  const parsed = JSON.parse(json);

  assert.equal(parsed.schemaVersion, KNOWLEDGE_SCHEMA_VERSION);
  assert.ok(parsed.generatedAt, "generatedAt should be present");
  assert.ok(
    !Number.isNaN(Date.parse(parsed.generatedAt)),
    "generatedAt should be a valid ISO timestamp"
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "../dist/index.js";

test("addDecision and getDecisions accumulate in order", () => {
  const app = createApplication({ name: "shop" });

  app.addDecision({ title: "Use Redis for job coordination", status: "accepted" });
  app.addDecision({ title: "Use Postgres for orders", status: "proposed" });

  assert.deepEqual(
    app.getDecisions().map((decision) => decision.title),
    ["Use Redis for job coordination", "Use Postgres for orders"]
  );
});

test("addConstraint and getConstraints accumulate in order", () => {
  const app = createApplication({ name: "shop" });

  app.addConstraint({
    description: "Failed permanent payment declines must not be retried."
  });

  assert.equal(app.getConstraints().length, 1);
  assert.equal(
    app.getConstraints()[0].description,
    "Failed permanent payment declines must not be retried."
  );
});

test("getDevelopmentState starts empty with no objective/nextStep keys", () => {
  const app = createApplication({ name: "shop" });

  const state = app.getDevelopmentState();

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
  const app = createApplication({ name: "shop" });

  app.setDevelopmentState({
    currentObjective: "Implement payment recovery",
    completed: ["Retry API", "Retry model"]
  });

  app.setDevelopmentState({
    inProgress: ["Retry worker"]
  });

  const state = app.getDevelopmentState();

  assert.equal(state.currentObjective, "Implement payment recovery");
  assert.deepEqual(state.completed, ["Retry API", "Retry model"]);
  assert.deepEqual(state.inProgress, ["Retry worker"]);
  assert.deepEqual(state.blocked, []);

  app.setDevelopmentState({ completed: ["Retry API"] });
  assert.deepEqual(app.getDevelopmentState().completed, ["Retry API"]);
});

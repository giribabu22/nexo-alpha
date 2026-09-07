import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";
import { inspect, status, context, knowledge, validate, health } from "../dist/commands.js";

function buildFixture() {
  const app = createApplication({ name: "shop", version: "0.1.0" });

  app.module({ name: "orders" });
  app.module({
    name: "payments",
    purpose: "Handle customer payments",
    dependencies: ["orders"]
  });

  const knowledge = createKnowledge();
  knowledge.setDevelopmentState({ currentObjective: "Implement payment recovery" });

  return { app, knowledge };
}

test("inspect with no module name renders the application summary", () => {
  const { app, knowledge } = buildFixture();
  const output = inspect(app, knowledge);

  assert.match(output, /Nexo Application/);
  assert.match(output, /orders/);
  assert.match(output, /payments/);
});

test("inspect with a valid module name renders module detail", () => {
  const { app, knowledge } = buildFixture();
  const output = inspect(app, knowledge, "payments");

  assert.match(output, /^payments/);
  assert.match(output, /Purpose: Handle customer payments/);
});

test("inspect with an unknown module name throws with suggestions", () => {
  const { app, knowledge } = buildFixture();
  assert.throws(
    () => inspect(app, knowledge, "missing"),
    /No module named "missing" found\. Did you mean one of: orders, payments\?/
  );
});

test("status renders the development state", () => {
  const { app, knowledge } = buildFixture();
  const output = status(app, knowledge);

  assert.match(output, /Nexo Development Status/);
  assert.match(output, /Implement payment recovery/);
});

test("context returns valid JSON matching the manifest", () => {
  const { app, knowledge } = buildFixture();
  const output = context(app, knowledge);
  const parsed = JSON.parse(output);

  assert.equal(parsed.application.name, "shop");
  assert.equal(parsed.modules.length, 2);
});

test("knowledge returns the journal as a standalone JSON snapshot", () => {
  const { app, knowledge: journal } = buildFixture();
  journal.addDecision({ title: "Use Redis", status: "accepted" });

  const output = knowledge(app, journal);
  const parsed = JSON.parse(output);

  assert.equal(parsed.decisions.length, 1);
  assert.equal(parsed.decisions[0].title, "Use Redis");
  assert.ok(parsed.generatedAt, "generatedAt should be present");
  assert.equal(typeof parsed.schemaVersion, "number");
  assert.equal(parsed.structure.moduleCount, 2);
  assert.equal(typeof parsed.structureHash, "string");
});

test("knowledge throws a clear error when the app exports no knowledge journal", () => {
  const { app } = buildFixture();

  assert.throws(
    () => knowledge(app, undefined),
    /does not export a knowledge journal/
  );
});

test("validate renders validation results", () => {
  const { app } = buildFixture();
  const output = validate(app);

  assert.match(output, /Nexo Validation: PASSED/);
});

test("health renders application health metrics", () => {
  const { app } = buildFixture();
  const output = health(app);

  assert.match(output, /Nexo Application Health/);
  assert.match(output, /Modules: 2/);
  assert.match(output, /Architecture Valid: YES/);
});


import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { inspect, status, context } from "../dist/commands.js";

function buildFixtureApp() {
  const app = createApplication({ name: "shop", version: "0.1.0" });

  app.module({ name: "orders" });
  app.module({
    name: "payments",
    purpose: "Handle customer payments",
    dependencies: ["orders"]
  });

  app.setDevelopmentState({ currentObjective: "Implement payment recovery" });

  return app;
}

test("inspect with no module name renders the application summary", () => {
  const output = inspect(buildFixtureApp());

  assert.match(output, /Nexo Application/);
  assert.match(output, /orders/);
  assert.match(output, /payments/);
});

test("inspect with a valid module name renders module detail", () => {
  const output = inspect(buildFixtureApp(), "payments");

  assert.match(output, /^payments/);
  assert.match(output, /Purpose: Handle customer payments/);
});

test("inspect with an unknown module name throws with suggestions", () => {
  assert.throws(
    () => inspect(buildFixtureApp(), "missing"),
    /No module named "missing" found\. Did you mean one of: orders, payments\?/
  );
});

test("status renders the development state", () => {
  const output = status(buildFixtureApp());

  assert.match(output, /Nexo Development Status/);
  assert.match(output, /Implement payment recovery/);
});

test("context returns valid JSON matching the manifest", () => {
  const output = context(buildFixtureApp());
  const parsed = JSON.parse(output);

  assert.equal(parsed.application.name, "shop");
  assert.equal(parsed.modules.length, 2);
});

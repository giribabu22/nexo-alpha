/**
 * Debugging difficulty (DEBUGGING.md): the serve()/resource() variant must keep
 * catching every scenario's mistake and keep saying what DEBUGGING.md records,
 * so a regression in an error message fails here.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SCENARIOS } from "../debugging/scenarios.mjs";
import { runScenario } from "../debugging/measure.mjs";

// What the "after" variant achieves today: [detected at, criteria met].
const EXPECTED_AFTER = {
  "missing-auth-secret": ["startup", 3],
  "protected-api-no-authenticator": ["startup", 3],
  "database-location-unusable": ["startup", 3],
  "port-in-use": ["startup", 3],
  "missing-scope": ["request", 3],
  "field-typo": ["request", 3],
  "model-changed-without-migration": ["check", 3]
};

for (const scenario of SCENARIOS) {
  test(`debugging: ${scenario.title}`, async () => {
    const after = await runScenario(scenario, "after");
    assert.deepEqual([after.stage, after.points], EXPECTED_AFTER[scenario.id], after.message);
  });
}

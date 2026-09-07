import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "../dist/index.js";

test("addHistoryEntry stamps a timestamp and getHistory returns entries in order", () => {
  const app = createApplication({ name: "shop" });

  app.addHistoryEntry({ operation: "create_module", target: "orders", result: "success" });
  app.addHistoryEntry({ operation: "create_module", target: "payments", result: "denied", detail: "missing permission" });

  const history = app.getHistory();

  assert.equal(history.length, 2);
  assert.equal(history[0].operation, "create_module");
  assert.equal(history[0].target, "orders");
  assert.equal(history[0].result, "success");
  assert.equal(typeof history[0].timestamp, "string");
  assert.doesNotThrow(() => new Date(history[0].timestamp).toISOString());

  assert.equal(history[1].result, "denied");
  assert.equal(history[1].detail, "missing permission");
});

test("getHistory starts empty", () => {
  const app = createApplication({ name: "shop" });

  assert.deepEqual(app.getHistory(), []);
});

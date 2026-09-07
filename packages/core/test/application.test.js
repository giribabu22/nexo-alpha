import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "../dist/index.js";

test("creates a Nexo application", () => {
  const app = createApplication({
    name: "shop"
  });

  assert.equal(app.name, "shop");
  assert.equal(app.version, "0.1.0");
  assert.equal(app.state, "created");
});

test("registers modules", () => {
  const app = createApplication({
    name: "shop"
  });

  app.module({
    name: "payments",
    description: "Handle customer payments"
  });

  assert.equal(app.getModules().length, 1);
  assert.equal(app.getModule("payments")?.name, "payments");
});

test("rejects duplicate module registration", () => {
  const app = createApplication({
    name: "shop"
  });

  app.module({ name: "payments" });

  assert.throws(() => {
    app.module({ name: "payments" });
  }, /already registered/);
});

test("runs module lifecycle", async () => {
  const events = [];

  const app = createApplication({
    name: "shop"
  });

  app.module({
    name: "payments",

    initialize() {
      events.push("initialize");
    },

    start() {
      events.push("start");
    },

    stop() {
      events.push("stop");
    }
  });

  await app.start();

  assert.equal(app.state, "running");
  assert.deepEqual(events, [
    "initialize",
    "start"
  ]);

  await app.stop();

  assert.equal(app.state, "stopped");
  assert.deepEqual(events, [
    "initialize",
    "start",
    "stop"
  ]);
});

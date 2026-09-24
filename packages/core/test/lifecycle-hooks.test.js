import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../dist/application.js";

test("runs lifecycle hooks in strict order", async () => {
  const app = createApplication({ name: "hooks-test" });
  const trail = [];

  app.onBeforeInit(() => {
    trail.push("beforeInit");
  });

  app.onAfterInit(() => {
    trail.push("afterInit");
  });

  app.onBeforeStart(() => {
    trail.push("beforeStart");
  });

  app.onAfterStart(() => {
    trail.push("afterStart");
  });

  app.onBeforeStop(() => {
    trail.push("beforeStop");
  });

  app.onAfterStop(() => {
    trail.push("afterStop");
  });

  app.module({
    name: "worker",
    initialize() {
      trail.push("module:initialize");
    },
    start() {
      trail.push("module:start");
    },
    stop() {
      trail.push("module:stop");
    }
  });

  await app.start();

  assert.deepEqual(trail, [
    "beforeInit",
    "module:initialize",
    "afterInit",
    "beforeStart",
    "module:start",
    "afterStart"
  ]);

  await app.stop();

  assert.deepEqual(trail, [
    "beforeInit",
    "module:initialize",
    "afterInit",
    "beforeStart",
    "module:start",
    "afterStart",
    "beforeStop",
    "module:stop",
    "afterStop"
  ]);
});

test("hook failure during start transitions application to failed state", async () => {
  const app = createApplication({ name: "failed-hook-test" });

  app.onBeforeStart(() => {
    throw new Error("Pre-start verification failed");
  });

  await assert.rejects(
    async () => {
      await app.start();
    },
    /Pre-start verification failed/
  );

  assert.equal(app.state, "failed");
  await app.reset();
  assert.equal(app.state, "stopped");
});

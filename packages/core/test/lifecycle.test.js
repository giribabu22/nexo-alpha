import test from "node:test";
import assert from "node:assert/strict";

import { createApplication, NexoLifecycleError } from "../dist/index.js";

function makeModule(name, events, options = {}) {
  return {
    name,

    async initialize() {
      if (options.failOn === "initialize") {
        throw new Error(`${name} failed to initialize`);
      }
      events.push(`${name}:initialize`);
    },

    async start() {
      if (options.failOn === "start") {
        throw new Error(`${name} failed to start`);
      }
      events.push(`${name}:start`);
    },

    async stop() {
      if (options.failOn === "stop") {
        throw new Error(`${name} failed to stop`);
      }
      events.push(`${name}:stop`);
    }
  };
}

// --- Invalid state transitions -------------------------------------------

test("rejects stop() from the created state", async () => {
  const app = createApplication({ name: "shop" });

  await assert.rejects(() => app.stop(), NexoLifecycleError);
  assert.equal(app.state, "created");
});

test("rejects start() while already initializing", async () => {
  const app = createApplication({ name: "shop" });
  let releaseInitialize;

  app.module({
    name: "slow",
    initialize: () =>
      new Promise((resolve) => {
        releaseInitialize = resolve;
      })
  });

  const starting = app.start();

  // Give the event loop a tick so the application has entered "initializing".
  await Promise.resolve();
  assert.equal(app.state, "initializing");

  await assert.rejects(() => app.start(), NexoLifecycleError);

  releaseInitialize();
  await starting;
  assert.equal(app.state, "running");
});

test("rejects start() while stopping", async () => {
  const app = createApplication({ name: "shop" });
  let releaseStop;

  app.module({
    name: "slow",
    stop: () =>
      new Promise((resolve) => {
        releaseStop = resolve;
      })
  });

  await app.start();

  const stopping = app.stop();

  await Promise.resolve();
  assert.equal(app.state, "stopping");

  await assert.rejects(() => app.start(), NexoLifecycleError);

  releaseStop();
  await stopping;
  assert.equal(app.state, "stopped");
});

test("start() and stop() are idempotent no-ops from running/stopped", async () => {
  const events = [];
  const app = createApplication({ name: "shop" });

  app.module(makeModule("payments", events));

  await app.start();
  await app.start(); // no-op, already running
  assert.equal(app.state, "running");
  assert.deepEqual(events, ["payments:initialize", "payments:start"]);

  await app.stop();
  await app.stop(); // no-op, already stopped
  assert.equal(app.state, "stopped");
});

// --- Failure semantics -----------------------------------------------------

test("a module that throws during initialize() moves the application to 'failed'", async () => {
  const events = [];
  const app = createApplication({ name: "shop" });

  app.module(makeModule("a", events));
  app.module(makeModule("b", events, { failOn: "initialize" }));
  app.module(makeModule("c", events));

  await assert.rejects(() => app.start(), /b failed to initialize/);

  assert.equal(app.state, "failed");
  // "a" completed initialize before "b" threw; "c" was never reached.
  assert.deepEqual(events, ["a:initialize"]);
});

test("a module that throws during start() moves the application to 'failed'", async () => {
  const events = [];
  const app = createApplication({ name: "shop" });

  app.module(makeModule("a", events));
  app.module(makeModule("b", events, { failOn: "start" }));

  await assert.rejects(() => app.start(), /b failed to start/);

  assert.equal(app.state, "failed");
  assert.deepEqual(events, ["a:initialize", "b:initialize", "a:start"]);
});

test("a module that throws during stop() moves the application to 'failed'", async () => {
  const events = [];
  const app = createApplication({ name: "shop" });

  app.module(makeModule("a", events));
  app.module(makeModule("b", events, { failOn: "stop" }));

  await app.start();
  await assert.rejects(() => app.stop(), /b failed to stop/);

  assert.equal(app.state, "failed");
});

test("the application cannot be started or stopped again once failed", async () => {
  const events = [];
  const app = createApplication({ name: "shop" });

  app.module(makeModule("broken", events, { failOn: "initialize" }));

  await assert.rejects(() => app.start());
  assert.equal(app.state, "failed");

  await assert.rejects(() => app.start(), NexoLifecycleError);
  await assert.rejects(() => app.stop(), NexoLifecycleError);
  assert.equal(app.state, "failed");
});

// --- reset() ---------------------------------------------------------------

test("reset() is only valid from the 'failed' state", async () => {
  const app = createApplication({ name: "shop" });

  await assert.rejects(() => app.reset(), NexoLifecycleError);
  assert.equal(app.state, "created");

  app.module(makeModule("payments", []));
  await app.start();

  await assert.rejects(() => app.reset(), NexoLifecycleError);
  assert.equal(app.state, "running");
});

test("reset() moves a failed application back to 'stopped' and allows starting again", async () => {
  const events = [];
  const app = createApplication({ name: "shop" });

  app.module(makeModule("a", events));
  app.module(makeModule("b", events, { failOn: "start" }));

  await assert.rejects(() => app.start());
  assert.equal(app.state, "failed");

  const errors = await app.reset();

  assert.deepEqual(errors, []);
  assert.equal(app.state, "stopped");

  events.length = 0;
  await assert.rejects(() => app.start());

  assert.equal(app.state, "failed"); // "b" still fails on start()
  const secondErrors = await app.reset();
  assert.deepEqual(secondErrors, []);
  assert.equal(app.state, "stopped");
});

test("reset() collects (rather than throws) errors from modules that fail to stop during cleanup", async () => {
  const events = [];
  const app = createApplication({ name: "shop" });

  app.module(makeModule("a", events, { failOn: "stop" }));
  app.module(makeModule("b", events, { failOn: "start" }));

  await assert.rejects(() => app.start());
  assert.equal(app.state, "failed");

  const errors = await app.reset();

  assert.equal(app.state, "stopped");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /a failed to stop/);
});

// --- Multi-module ordering ---------------------------------------------

test("initializes and starts modules in registration order, stops in reverse order", async () => {
  const events = [];
  const app = createApplication({ name: "shop" });

  app.module(makeModule("a", events));
  app.module(makeModule("b", events));
  app.module(makeModule("c", events));

  await app.start();

  assert.deepEqual(events, [
    "a:initialize",
    "b:initialize",
    "c:initialize",
    "a:start",
    "b:start",
    "c:start"
  ]);

  events.length = 0;
  await app.stop();

  assert.deepEqual(events, ["c:stop", "b:stop", "a:stop"]);
});

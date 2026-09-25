import test from "node:test";
import assert from "node:assert/strict";

import { permissionRule } from "@nexo-alpha/decision";
import { createApplication, createRequestContext } from "@nexo-alpha/core";
import { collectEvents, createTestAgent, createToolStub, runSteps } from "@nexo-alpha/agent/testing";

test("createToolStub: records calls and supports data, error, throws and respond", async () => {
  const ok = createToolStub("refund", { data: { refunded: true }, permissions: ["orders:refund"], description: "d" });
  assert.deepEqual(ok.permissions, ["orders:refund"]);
  assert.deepEqual(await ok.execute({ intent: { action: "refund", target: "o-1" } }), { success: true, data: { refunded: true }, durationMs: 1 });
  assert.equal(ok.calls[0].intent.target, "o-1");
  ok.reset();
  assert.equal(ok.calls.length, 0);

  assert.equal((await createToolStub("x", { error: "nope" }).execute({ intent: { action: "x" } })).error, "nope");
  await assert.rejects(createToolStub("x", { throws: "crash" }).execute({ intent: { action: "x" } }), /crash/);
  const custom = createToolStub("x", { respond: ({ intent }) => ({ success: true, data: intent.payload, durationMs: 5 }) });
  assert.deepEqual((await custom.execute({ intent: { action: "x", payload: { n: 1 } } })).data, { n: 1 });
});

test("createTestAgent + runSteps + collectEvents: a full workflow in a few lines", async () => {
  const lookup = createToolStub("lookup");
  const refund = createToolStub("refund");
  const { agent } = createTestAgent({ tools: [lookup, refund] });
  const events = collectEvents();

  const run = await runSteps(agent, [{ action: "lookup" }, { action: "refund", target: "o-9" }], {
    actor: "sam",
    workflow: { onEvent: events.listener }
  });

  assert.equal(run.status, "COMPLETED");
  assert.equal(refund.calls[0].intent.actor, "sam");
  assert.deepEqual(events.types(), ["workflow.started", "step.started", "step.completed", "step.started", "step.completed", "workflow.completed"]);
  assert.equal(events.ofType("step.completed").length, 2);
  events.clear();
  assert.deepEqual(events.types(), []);
});

test("createTestAgent: rules apply, so blocked tools never run", async () => {
  const refund = createToolStub("refund");
  const { agent } = createTestAgent({
    tools: [refund],
    rules: [permissionRule({ actions: ["refund"], check: ({ intent }) => intent.actor === "admin" })]
  });

  const run = await runSteps(agent, [{ action: "refund" }], { actor: "guest" });
  assert.equal(run.status, "FAILED");
  assert.equal(refund.calls.length, 0);
});

test("createRequestContext: empty defaults with overrides, for dispatch in tests", async () => {
  assert.deepEqual(createRequestContext(), { params: {}, query: {}, payload: undefined, headers: {} });

  const app = createApplication({ name: "t" });
  app.module({ name: "m", apis: [{ name: "echo", method: "GET", path: "/e/:id", handler: (ctx) => ctx.params.id }] });
  assert.equal(await app.dispatch("echo", createRequestContext({ params: { id: "42" } })), "42");
});

test("tool timeoutMs: a hung tool fails the step instead of stalling the workflow", async () => {
  const hung = { action: "hang", timeoutMs: 20, execute: () => new Promise(() => {}) };
  const { agent } = createTestAgent({ tools: [hung] });

  const started = Date.now();
  const run = await runSteps(agent, [{ action: "hang" }]);
  assert.equal(run.status, "FAILED");
  assert.match(run.error, /timed out after 20ms/);
  assert.ok(Date.now() - started < 2000);
});

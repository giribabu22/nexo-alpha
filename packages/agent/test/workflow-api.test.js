/**
 * Workflow HTTP API tests — served through @nexo-alpha/hapi.
 *
 * Build first:  pnpm --filter @nexo-alpha/agent build
 * Then run:     pnpm --filter @nexo-alpha/agent test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createApplication, createInMemoryDocumentStore } from "@nexo-alpha/core";
import { createJobQueue } from "@nexo-alpha/scheduler";
import { createHapiServer } from "@nexo-alpha/hapi";
import { createDecisionEngine, confirmationRule } from "@nexo-alpha/decision";

import {
  createAgent,
  createWorkflow,
  createStepIntentParser,
  createWorkflowApiModule
} from "../dist/index.js";

function successTool(action) {
  return {
    action,
    execute: async ({ intent }) => ({ success: true, data: { action: intent.action }, durationMs: 1 })
  };
}

async function buildServer(moduleOptions = {}) {
  const engine = createDecisionEngine({ name: "api-test" });
  engine.addRule(confirmationRule({ name: "confirm-refund", actions: ["refund"], requires: () => true, question: "Confirm refund?" }));

  const agent = createAgent({ decisionEngine: engine });
  agent.tools.register(successTool("lookup"));
  agent.tools.register(successTool("refund"));

  const lookup = createWorkflow({
    name: "lookup",
    agent,
    parser: createStepIntentParser([{ action: "lookup" }])
  });
  const refund = createWorkflow({
    name: "refund",
    agent,
    parser: createStepIntentParser([{ action: "refund" }])
  });

  const app = createApplication({ name: "api-test" });
  app.module(createWorkflowApiModule({ workflows: [lookup, refund], ...moduleOptions }));

  return { server: await createHapiServer(app, { logging: false }), engine };
}

async function call(server, method, url, payload) {
  const response = await server.inject({ method, url, ...(payload !== undefined ? { payload } : {}) });
  return { status: response.statusCode, headers: response.headers, body: response.payload ? JSON.parse(response.payload) : undefined };
}

test("Workflow API: lists registered workflows", async () => {
  const { server } = await buildServer();
  const { status, body } = await call(server, "GET", "/workflows");
  assert.equal(status, 200);
  assert.deepEqual(body, { workflows: ["lookup", "refund"] });
});

test("Workflow API: starts a run, then gets and lists it", async () => {
  const { server } = await buildServer();

  const started = await call(server, "POST", "/workflows/lookup/runs", { goal: "Find order 7", initialContext: { orderId: 7 } });
  assert.equal(started.status, 200);
  assert.equal(started.body.status, "COMPLETED");
  assert.equal(started.body.context.orderId, 7);

  const fetched = await call(server, "GET", `/workflows/lookup/runs/${started.body.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.id, started.body.id);

  const completed = await call(server, "GET", "/workflows/lookup/runs?status=COMPLETED");
  assert.deepEqual(completed.body.runs.map((r) => r.id), [started.body.id]);

  const failed = await call(server, "GET", "/workflows/lookup/runs?status=FAILED");
  assert.deepEqual(failed.body.runs, []);
});

test("Workflow API: pauses on ASK_USER, resumes to completion, then refuses a second resume", async () => {
  const { server, engine } = await buildServer();

  const started = await call(server, "POST", "/workflows/refund/runs", { goal: "Refund order 9" });
  assert.equal(started.body.status, "WAITING");

  engine.removeRule("confirm-refund");
  const resumed = await call(server, "POST", `/workflows/refund/runs/${started.body.id}/resume`, { response: { confirmed: true } });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.status, "COMPLETED");
  assert.deepEqual(resumed.body.context.userResponse_step_1, { confirmed: true });

  const again = await call(server, "POST", `/workflows/refund/runs/${started.body.id}/resume`);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "WORKFLOW_NOT_RESUMABLE");
});

test("Workflow API: 404 for unknown workflow, unknown run, and a run of another workflow", async () => {
  const { server } = await buildServer();

  const unknownWorkflow = await call(server, "POST", "/workflows/nope/runs", { goal: "x" });
  assert.equal(unknownWorkflow.status, 404);
  assert.equal(unknownWorkflow.body.code, "WORKFLOW_NOT_FOUND");

  const unknownRun = await call(server, "GET", "/workflows/lookup/runs/wf-missing");
  assert.equal(unknownRun.status, 404);
  assert.equal(unknownRun.body.code, "WORKFLOW_RUN_NOT_FOUND");

  const lookupRun = await call(server, "POST", "/workflows/lookup/runs", { goal: "Find" });
  const crossed = await call(server, "GET", `/workflows/refund/runs/${lookupRun.body.id}`);
  assert.equal(crossed.status, 404);
});

test("Workflow API: 400 for invalid bodies and status filters", async () => {
  const { server } = await buildServer();

  const noGoal = await call(server, "POST", "/workflows/lookup/runs", { initialContext: [] });
  assert.equal(noGoal.status, 400);
  assert.equal(noGoal.body.errors.length, 2);

  const badStatus = await call(server, "GET", "/workflows/lookup/runs?status=DONE");
  assert.equal(badStatus.status, 400);
});

test("Workflow API: resolveActor overrides the body actor", async () => {
  let seenActor;
  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "approve-all" }) });
  agent.tools.register({
    action: "whoami",
    execute: async ({ intent }) => {
      seenActor = intent.actor;
      return { success: true, data: {}, durationMs: 1 };
    }
  });

  const app = createApplication({ name: "actor-test" });
  app.module(createWorkflowApiModule({
    workflows: [createWorkflow({ name: "whoami", agent, parser: createStepIntentParser([{ action: "whoami" }]) })],
    resolveActor: (context) => context.headers["x-user-id"]
  }));
  const server = await createHapiServer(app, { logging: false });

  await server.inject({ method: "POST", url: "/workflows/whoami/runs", headers: { "x-user-id": "u-1" }, payload: { goal: "g", actor: "spoofed" } });
  assert.equal(seenActor, "u-1");
});

test("Workflow API: auth option protects every route", async () => {
  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "approve-all" }) });
  const app = createApplication({ name: "auth-test" });
  app.module(createWorkflowApiModule({
    workflows: [createWorkflow({ name: "w", agent })],
    auth: { required: true, scopes: ["workflows:run"] }
  }));

  const server = await createHapiServer(app, {
    logging: false,
    authenticate: (context) => context.headers.authorization === "Bearer good"
      ? { authenticated: true, scopes: ["workflows:run"] }
      : { authenticated: false }
  });

  assert.equal((await server.inject({ method: "GET", url: "/workflows" })).statusCode, 401);
  assert.equal((await server.inject({ method: "GET", url: "/workflows", headers: { authorization: "Bearer good" } })).statusCode, 200);
});

test("Workflow API: rejects duplicate workflow names", () => {
  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "x" }) });
  assert.throws(
    () => createWorkflowApiModule({ workflows: [createWorkflow({ name: "dup", agent }), createWorkflow({ name: "dup", agent })] }),
    /Duplicate workflow name "dup"/
  );
});

// ---------------------------------------------------------------------------
// Background execution through a job queue
// ---------------------------------------------------------------------------

test("Workflow API (queue): start and resume answer RUNNING immediately; the queue finishes the run", async () => {
  const queue = createJobQueue({ store: createInMemoryDocumentStore(), pollIntervalMs: 10, backoffMs: () => 0 });
  const { server, engine } = await buildServer({ queue });
  await queue.start();
  try {
    const started = await call(server, "POST", "/workflows/lookup/runs", { goal: "Find order 7" });
    assert.equal(started.status, 202);
    assert.equal(started.headers.location, `/workflows/lookup/runs/${started.body.id}`);
    assert.equal(started.body.status, "RUNNING");
    assert.equal(started.body.history.length, 0);

    await queue.whenIdle();
    const finished = await call(server, "GET", `/workflows/lookup/runs/${started.body.id}`);
    assert.equal(finished.body.status, "COMPLETED");

    const waiting = await call(server, "POST", "/workflows/refund/runs", { goal: "Refund 9" });
    await queue.whenIdle();
    assert.equal((await call(server, "GET", `/workflows/refund/runs/${waiting.body.id}`)).body.status, "WAITING");

    engine.removeRule("confirm-refund");
    const resumed = await call(server, "POST", `/workflows/refund/runs/${waiting.body.id}/resume`, { response: { ok: true } });
    assert.equal(resumed.body.status, "RUNNING");
    await queue.whenIdle();
    assert.equal((await call(server, "GET", `/workflows/refund/runs/${waiting.body.id}`)).body.status, "COMPLETED");

    const jobs = await queue.list({ type: "nexo.workflow.execute" });
    assert.equal(jobs.length, 3);
    assert.ok(jobs.every((job) => job.status === "completed"));
  } finally {
    await queue.stop();
  }
});

test("Workflow API (queue): the resolved actor travels with the job, and stale jobs are skipped", async () => {
  const seen = [];
  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "approve-all" }) });
  agent.tools.register({
    action: "whoami",
    execute: async ({ intent }) => {
      seen.push(intent.actor);
      return { success: true, data: {}, durationMs: 1 };
    }
  });
  const workflow = createWorkflow({ name: "whoami", agent, parser: createStepIntentParser([{ action: "whoami" }]) });

  const queue = createJobQueue({ store: createInMemoryDocumentStore(), pollIntervalMs: 10 });
  const app = createApplication({ name: "queue-actor" });
  app.module(createWorkflowApiModule({ workflows: [workflow], queue, resolveActor: (context) => context.headers["x-user"] }));
  const server = await createHapiServer(app, { logging: false });
  await queue.start();
  try {
    const response = await server.inject({ method: "POST", url: "/workflows/whoami/runs", headers: { "x-user": "u-9" }, payload: { goal: "g" } });
    const runId = JSON.parse(response.payload).id;
    await queue.whenIdle();
    assert.deepEqual(seen, ["u-9"]);

    // A duplicate job for an already-finished run is a no-op.
    const stale = await queue.enqueue("nexo.workflow.execute", { workflow: "whoami", runId });
    await queue.whenIdle();
    assert.deepEqual((await queue.get(stale.id)).result, { skipped: true });
    assert.deepEqual(seen, ["u-9"]);
  } finally {
    await queue.stop();
  }
});

test("NexoWorkflow.execute / start / reopen: split lifecycle and guards", async () => {
  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "x" }) });
  agent.tools.register(successTool("lookup"));
  const workflow = createWorkflow({ name: "split", agent, parser: createStepIntentParser([{ action: "lookup" }]) });

  const started = await workflow.start("Find");
  assert.equal(started.status, "RUNNING");
  assert.equal((await workflow.load(started.id)).status, "RUNNING");

  const done = await workflow.execute(started.id);
  assert.equal(done.status, "COMPLETED");

  await assert.rejects(workflow.execute(started.id), /Only "RUNNING" runs can be executed/);
  await assert.rejects(workflow.reopen(started.id), /Resumption is only valid/);
  await assert.rejects(workflow.execute("missing"), /not found/);
});

test("Workflow API: GET /workflows/:name describes limits and callable tools", async () => {
  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "x" }) });
  agent.tools.register({ action: "refund", description: "Refunds an order", permissions: ["orders:refund"], execute: async () => ({ success: true, durationMs: 1 }) });
  agent.tools.register({ action: "lookup", execute: async () => ({ success: true, durationMs: 1 }) });

  const app = createApplication({ name: "describe" });
  app.module(createWorkflowApiModule({
    workflows: [
      createWorkflow({ name: "open", agent }),
      createWorkflow({ name: "limited", agent, maxSteps: 3, allowedActions: ["refund", "ghost"] })
    ]
  }));
  const server = await createHapiServer(app, { logging: false });

  const open = JSON.parse((await server.inject({ method: "GET", url: "/workflows/open" })).payload);
  assert.equal(open.maxSteps, 10);
  assert.equal(open.allowedActions, null);
  assert.deepEqual(open.tools.map((t) => t.action), ["refund", "lookup"]);

  const limited = JSON.parse((await server.inject({ method: "GET", url: "/workflows/limited" })).payload);
  assert.deepEqual(limited.allowedActions, ["refund", "ghost"]);
  assert.deepEqual(limited.tools, [
    { action: "refund", registered: true, description: "Refunds an order", permissions: ["orders:refund"] },
    { action: "ghost", registered: false, permissions: [] }
  ]);

  assert.equal((await server.inject({ method: "GET", url: "/workflows/nope" })).statusCode, 404);
});

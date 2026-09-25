/**
 * Workflow client + components tests. The client tests run against a live
 * Hapi server serving createWorkflowApiModule() from @nexo-alpha/agent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

import { createApplication, createInMemoryDocumentStore } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { createDecisionEngine, confirmationRule } from "@nexo-alpha/decision";
import { createJobQueue } from "@nexo-alpha/scheduler";
import { createAgent, createWorkflow, createStepIntentParser, createWorkflowApiModule } from "@nexo-alpha/agent";

import {
  createNexoClient,
  NexoApiError,
  NexoWorkflowRunList,
  NexoWorkflowRunDetail,
  NexoWorkflowDashboard,
  NexoWorkflowCatalog,
  NexoProvider
} from "../dist/index.js";
import * as clientEntry from "../dist/client-entry.js";

async function startServer({ queue, auth } = {}) {
  const engine = createDecisionEngine({ name: "frontend-test" });
  engine.addRule(confirmationRule({ name: "confirm", actions: ["refund"], requires: () => true, question: "Refund?" }));

  const agent = createAgent({ decisionEngine: engine });
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  for (const action of ["lookup", "refund"]) {
    agent.tools.register({ action, execute: async () => ({ success: true, data: { action }, durationMs: 1 }) });
  }
  agent.tools.register({ action: "slow", execute: async () => { await gate; return { success: true, data: {}, durationMs: 1 }; } });

  const app = createApplication({ name: "frontend-test" });
  app.module(createWorkflowApiModule({
    workflows: ["lookup", "refund", "slow"].map((name) =>
      createWorkflow({ name, agent, parser: createStepIntentParser([{ action: name }]) })
    ),
    ...(queue !== undefined ? { queue } : {}),
    ...(auth ? { auth: { required: true } } : {})
  }));

  const server = await startHapiServer(app, {
    port: 0,
    logging: false,
    bindLifecycle: false,
    ...(auth ? { authenticate: (context) => ({ authenticated: context.headers.authorization === "Bearer secret" }) } : {})
  });
  return { server, engine, release, baseUrl: server.info.uri };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

test("client.workflows: full run lifecycle against a live server", async () => {
  const { server, engine, baseUrl } = await startServer({ auth: true });
  try {
    const client = createNexoClient({ baseUrl, headers: { Authorization: "Bearer secret" } });

    assert.deepEqual(await client.workflows.list(), ["lookup", "refund", "slow"]);

    const run = await client.workflows.startRun("lookup", { goal: "Find order", initialContext: { orderId: 1 } });
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.context.orderId, 1);
    assert.equal(run.history[0].intent.action, "lookup");
    assert.equal((await client.workflows.getRun("lookup", run.id)).id, run.id);
    assert.deepEqual((await client.workflows.listRuns("lookup", { status: "COMPLETED" })).map((r) => r.id), [run.id]);

    const waiting = await client.workflows.startRun("refund", { goal: "Refund order" });
    assert.equal(waiting.status, "WAITING");
    assert.equal(waiting.pendingDecision.question, "Refund?");
    engine.removeRule("confirm");
    assert.equal((await client.workflows.resumeRun("refund", waiting.id, { ok: true })).status, "COMPLETED");
  } finally {
    await server.stop();
  }
});

test("client.workflows: errors carry status and the server's { error, code, errors } payload", async () => {
  const { server, baseUrl } = await startServer({ auth: true });
  try {
    const client = createNexoClient({ baseUrl, headers: { Authorization: "Bearer secret" } });

    await assert.rejects(client.workflows.getRun("lookup", "missing"), (error) => {
      assert.ok(error instanceof NexoApiError);
      assert.equal(error.status, 404);
      assert.equal(error.payload.code, "WORKFLOW_RUN_NOT_FOUND");
      return true;
    });
    await assert.rejects(client.workflows.startRun("lookup", { goal: "" }), (error) => error.status === 400 && error.payload.errors.length === 1);

    const run = await client.workflows.startRun("lookup", { goal: "Find" });
    await assert.rejects(client.workflows.resumeRun("lookup", run.id), (error) => error.status === 409);

    await assert.rejects(createNexoClient({ baseUrl }).workflows.list(), (error) => error.status === 401 && error.message === "Unauthorized");
  } finally {
    await server.stop();
  }
});

test("client.workflows.waitForRun: polls a queued run until it stops, and times out while RUNNING", async () => {
  const queue = createJobQueue({ store: createInMemoryDocumentStore(), pollIntervalMs: 10 });
  const { server, release, baseUrl } = await startServer({ queue });
  await queue.start();
  try {
    const client = createNexoClient({ baseUrl });
    const run = await client.workflows.startRun("slow", { goal: "take your time" });
    assert.equal(run.status, "RUNNING");

    await assert.rejects(client.workflows.waitForRun("slow", run.id, { intervalMs: 10, timeoutMs: 50 }), /still RUNNING/);

    release();
    assert.equal((await client.workflows.waitForRun("slow", run.id, { intervalMs: 10, timeoutMs: 5000 })).status, "COMPLETED");
  } finally {
    release();
    await queue.stop();
    await server.stop();
  }
});

test("client.workflows: custom workflowsPath and URL-encoded segments", async () => {
  const calls = [];
  const client = createNexoClient({
    baseUrl: "http://api.example",
    workflowsPath: "/v1/flows/",
    fetch: async (url, init) => {
      calls.push({ url, method: init.method });
      return new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  await client.workflows.listRuns("a b/c", { status: "FAILED" });
  assert.deepEqual(calls, [{ url: "http://api.example/v1/flows/a%20b%2Fc/runs?status=FAILED", method: "GET" }]);
});

test("React-free entry point exposes the client without components", () => {
  assert.equal(typeof clientEntry.createNexoClient, "function");
  assert.equal(typeof clientEntry.NexoWorkflowsClient, "function");
  assert.equal("NexoWorkflowDashboard" in clientEntry, false);
  assert.ok(clientEntry.createNexoClient({}).workflows instanceof clientEntry.NexoWorkflowsClient);
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const step = (overrides = {}) => ({
  id: "exec-1",
  startedAt: "2026-09-25T00:00:00.000Z",
  completedAt: "2026-09-25T00:00:00.010Z",
  totalDurationMs: 10,
  intent: { action: "refund_order", actor: "sam" },
  decision: { result: "APPROVE" },
  attempt: 1,
  status: "APPROVED_AND_COMPLETE",
  ...overrides
});

const run = (overrides = {}) => ({
  id: "wf-1",
  workflowName: "refund",
  goal: "Refund order 9",
  step: 2,
  status: "COMPLETED",
  history: [step()],
  context: {},
  ...overrides
});

test("NexoWorkflowRunList: renders one row per run with status, goal and step count, or an empty message", () => {
  const html = renderToString(React.createElement(NexoWorkflowRunList, {
    runs: [run(), run({ id: "wf-2", status: "FAILED", goal: "Other goal", history: [] })],
    selectedRunId: "wf-2"
  }));
  assert.ok(html.includes('data-run-id="wf-1"'));
  assert.ok(html.includes("Refund order 9"));
  assert.ok(html.includes("COMPLETED"));
  assert.ok(html.includes("FAILED"));
  assert.match(html, /data-run-id="wf-2" aria-selected="true"/);

  assert.ok(renderToString(React.createElement(NexoWorkflowRunList, { runs: [], emptyMessage: "Nothing here" })).includes("Nothing here"));
});

test("NexoWorkflowRunDetail: shows steps, errors, pending decisions and the resume form only when resumable", () => {
  const completed = renderToString(React.createElement(NexoWorkflowRunDetail, { run: run({ result: "Refunded" }) }));
  assert.ok(completed.includes("refund_order"));
  assert.ok(completed.includes("APPROVED_AND_COMPLETE"));
  assert.ok(completed.includes("by <!-- -->sam"));
  assert.ok(completed.includes("Refunded"));
  assert.ok(!completed.includes("Resume"));

  const failed = renderToString(React.createElement(NexoWorkflowRunDetail, {
    run: run({ status: "FAILED", error: "Actor lacks permission", history: [step({ status: "BLOCKED", decision: { result: "REJECT", reason: "lacks permission" } })] })
  }));
  assert.ok(failed.includes("Actor lacks permission"));
  assert.ok(failed.includes("BLOCKED"));

  const waitingRun = run({ status: "WAITING", pendingDecision: { result: "ASK_USER", question: "Refund over limit?" } });
  const withoutHandler = renderToString(React.createElement(NexoWorkflowRunDetail, { run: waitingRun }));
  assert.ok(withoutHandler.includes("Refund over limit?"));
  assert.ok(!withoutHandler.includes("<textarea"));

  const withHandler = renderToString(React.createElement(NexoWorkflowRunDetail, { run: waitingRun, onResume: () => {} }));
  assert.ok(withHandler.includes("<textarea"));
  assert.ok(withHandler.includes("Resume"));

  const escalated = renderToString(React.createElement(NexoWorkflowRunDetail, {
    run: run({ status: "ESCALATED", pendingDecision: { result: "ESCALATE", to: "finance-lead", reason: "Too large" } })
  }));
  assert.ok(escalated.includes("Escalated to finance-lead"));
});

test("NexoWorkflowDashboard: renders the start form inside a NexoProvider", () => {
  const html = renderToString(
    React.createElement(NexoProvider, { baseUrl: "http://localhost:0" }, React.createElement(NexoWorkflowDashboard, { workflow: "refund" }))
  );
  assert.ok(html.includes("Workflow: refund"));
  assert.ok(html.includes("Start run"));
  assert.ok(html.includes("No runs yet."));
});

test("client.workflows.describe + NexoWorkflowCatalog: tools, permissions and unregistered actions", async () => {
  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "x" }) });
  agent.tools.register({ action: "refund", description: "Refunds an order", permissions: ["orders:refund"], execute: async () => ({ success: true, durationMs: 1 }) });
  const app = createApplication({ name: "catalog" });
  app.module(createWorkflowApiModule({ workflows: [createWorkflow({ name: "refund", agent, maxSteps: 3, allowedActions: ["refund", "ghost"] })] }));
  const server = await startHapiServer(app, { port: 0, logging: false, bindLifecycle: false });
  try {
    const description = await createNexoClient({ baseUrl: server.info.uri }).workflows.describe("refund");
    assert.equal(description.maxSteps, 3);
    assert.equal(description.tools[0].permissions[0], "orders:refund");

    const html = renderToString(React.createElement(NexoWorkflowCatalog, { workflows: [description] }));
    assert.ok(html.includes("max 3 steps"));
    assert.ok(html.includes('data-tool="refund"'));
    assert.ok(html.includes("Refunds an order"));
    assert.ok(html.includes("orders:refund"));
    assert.ok(html.includes("not registered"));
  } finally {
    await server.stop();
  }
});

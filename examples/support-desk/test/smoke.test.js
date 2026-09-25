/**
 * End-to-end smoke test of the support desk: HTTP → auth → RBAC → queue →
 * workflow → human approval → memory → webhooks → metrics.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { createInMemoryDocumentStore, createLogger, runInProject, signToken } from "@nexo-alpha/core";
import { createHapiServer } from "@nexo-alpha/hapi";
import { verifyWebhookSignature } from "@nexo-alpha/webhooks";

import { createSupportDesk, seedDemoProjects } from "../dist/app.js";

const SECRET = "support-desk-test-secret-at-least-32-bytes";

async function setup() {
  const desk = createSupportDesk({
    store: createInMemoryDocumentStore(),
    jwtSecret: SECRET,
    logger: createLogger({ sink: () => {} }),
    pollIntervalMs: 10
  });
  const server = await createHapiServer(desk.app, { authenticate: desk.authenticate, project: desk.project, logging: false });
  await seedDemoProjects(desk.projects);
  await desk.queue.start();

  const token = (user) => signToken({ sub: user, iss: "support-desk" }, SECRET, { expiresInSeconds: 60 });
  /** Calls the API as `user` inside `project` (default "acme"; null for global routes). */
  const call = async (user, method, url, payload, project = "acme") => {
    const response = await server.inject({
      method,
      url,
      headers: {
        ...(user === undefined ? {} : { authorization: `Bearer ${token(user)}` }),
        ...(project === null ? {} : { "x-project-id": project })
      },
      ...(payload !== undefined ? { payload } : {})
    });
    return { status: response.statusCode, body: response.payload ? JSON.parse(response.payload) : undefined };
  };
  const settle = async (runId) => {
    await desk.queue.whenIdle();
    return (await call("max", "GET", `/workflows/refunds/runs/${runId}`)).body;
  };
  return { desk, call, settle };
}

test("support desk: a small refund completes in the background and is remembered", async () => {
  const { desk, call, settle } = await setup();
  try {
    const started = await call("sam", "POST", "/workflows/refunds/runs", { goal: "Refund order o-1" });
    assert.equal(started.status, 202);
    assert.equal(started.body.status, "RUNNING");

    const run = await settle(started.body.id);
    assert.equal(run.status, "COMPLETED");
    assert.deepEqual(run.history.map((step) => step.intent.action), ["lookup_order", "refund_order"]);
    assert.ok(run.history.every((step) => step.intent.actor === "sam"));

    const remembered = await call("ann", "GET", "/memory/refund:o-1");
    assert.deepEqual(remembered.body.value, { amount: 40, by: "sam" });
  } finally {
    await desk.queue.stop();
  }
});

test("support desk: a large refund waits for a manager, who approves by resuming", async () => {
  const { desk, call, settle } = await setup();
  try {
    const started = await call("sam", "POST", "/workflows/refunds/runs", { goal: "Refund order o-2" });
    const waiting = await settle(started.body.id);
    assert.equal(waiting.status, "WAITING");
    assert.match(waiting.pendingDecision.question, /manager's approval/);

    // Support staff can't approve their own large refund; the manager can.
    await call("sam", "POST", `/workflows/refunds/runs/${waiting.id}/resume`);
    assert.equal((await settle(waiting.id)).status, "WAITING");

    await call("max", "POST", `/workflows/refunds/runs/${waiting.id}/resume`, { response: { approved: true } });
    const done = await settle(waiting.id);
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.history.at(-1).intent.actor, "max");
  } finally {
    await desk.queue.stop();
  }
});

test("support desk: viewers cannot refund; auth and scopes guard every API", async () => {
  const { desk, call, settle } = await setup();
  try {
    const started = await call("ann", "POST", "/workflows/refunds/runs", { goal: "Refund order o-1" });
    const run = await settle(started.body.id);
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /lacks permission\(s\): orders:refund/);

    assert.equal((await call(undefined, "GET", "/workflows")).status, 401);
    assert.equal((await call("nobody", "GET", "/workflows")).status, 403);
    assert.equal((await call("sam", "PUT", "/memory/k", { value: 1 })).status, 403);
    assert.equal((await call("max", "PUT", "/memory/k", { value: 1 })).status, 200);
  } finally {
    await desk.queue.stop();
  }
});

test("support desk: workflow events reach webhooks (signed) and metrics", async () => {
  const received = [];
  const receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { received.push({ body, signature: req.headers["x-nexo-signature"] }); res.end(); });
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));

  const { desk, call, settle } = await setup();
  try {
    const { secret } = await runInProject("acme", () =>
      desk.webhooks.subscribe({ url: `http://127.0.0.1:${receiver.address().port}/`, events: ["workflow.completed"] })
    );

    const started = await call("sam", "POST", "/workflows/refunds/runs", { goal: "Refund order o-1" });
    await settle(started.body.id);
    await desk.queue.whenIdle();

    assert.equal(received.length, 1);
    assert.equal(verifyWebhookSignature({ body: received[0].body, signature: received[0].signature, secret }), true);
    assert.equal(JSON.parse(received[0].body).data.workflowId, started.body.id);

    assert.equal((await call("max", "GET", "/metrics", undefined, null)).status, 403); // metrics are platform-wide
    const metrics = (await call("ops", "GET", "/metrics", undefined, null)).body;
    assert.equal(metrics.workflows.refunds.completed, 1);
    assert.equal(metrics.workflows.refunds.stepsCompleted, 2);
    assert.ok(metrics.queues["nexo.workflow.execute"].completed >= 1);
    assert.ok(metrics.apis.startWorkflowRun.calls >= 1);
  } finally {
    await desk.queue.stop();
    await new Promise((resolve) => receiver.close(resolve));
  }
});

test("support desk: projects isolate runs, memory and webhooks; non-members cannot see a project", async () => {
  const { desk, call, settle } = await setup();
  try {
    // max manages both projects; gus supports globex only; sam supports acme only.
    const acmeRun = await call("sam", "POST", "/workflows/refunds/runs", { goal: "Refund order o-1" });
    await settle(acmeRun.body.id);
    const globexRun = await call("gus", "POST", "/workflows/refunds/runs", { goal: "Refund order o-1" }, "globex");
    await desk.queue.whenIdle();

    // Each project sees only its own runs, even for a user in both.
    const acmeRuns = (await call("max", "GET", "/workflows/refunds/runs")).body.runs.map((r) => r.id);
    const globexRuns = (await call("max", "GET", "/workflows/refunds/runs", undefined, "globex")).body.runs.map((r) => r.id);
    assert.deepEqual(acmeRuns, [acmeRun.body.id]);
    assert.deepEqual(globexRuns, [globexRun.body.id]);
    assert.equal((await call("max", "GET", `/workflows/refunds/runs/${acmeRun.body.id}`, undefined, "globex")).status, 404);

    // Memory written by each run stays in its project.
    assert.equal((await call("max", "GET", "/memory/refund:o-1")).body.value.by, "sam");
    assert.equal((await call("max", "GET", "/memory/refund:o-1", undefined, "globex")).body.value.by, "gus");

    // Non-members: the project does not exist for them (404), and they get no roles in it.
    assert.equal((await call("sam", "GET", "/workflows/refunds/runs", undefined, "globex")).status, 403);
    assert.equal((await call("sam", "GET", "/workflows", undefined, "globex")).status, 403);
    const projects = (await call("sam", "GET", "/projects", undefined, null)).body.projects.map((p) => p.id);
    assert.deepEqual(projects, ["acme"]);

    // A missing or unknown project is rejected for tenant routes.
    assert.equal((await call("max", "GET", "/workflows/refunds/runs", undefined, null)).status, 403);
    assert.equal((await call("max", "GET", "/workflows/refunds/runs", undefined, "nope")).status, 403);

    // Webhook subscriptions are per project too.
    await runInProject("globex", () => desk.webhooks.subscribe({ url: "https://example.com/globex", events: ["*"] }));
    assert.equal((await runInProject("acme", () => desk.webhooks.list())).length, 0);
    assert.equal((await runInProject("globex", () => desk.webhooks.list())).length, 1);
  } finally {
    await desk.queue.stop();
  }
});

test("support desk: users create projects and manage members through the API", async () => {
  const { desk, call } = await setup();
  try {
    const created = await call("zoe", "POST", "/projects", { id: "initech", name: "Initech" }, null);
    assert.equal(created.status, 200);
    assert.deepEqual(created.body.members, { zoe: ["owner"] });

    // As owner, zoe can run workflows there; ann cannot until added.
    const run = await call("zoe", "POST", "/workflows/refunds/runs", { goal: "Refund order o-2" }, "initech");
    assert.equal(run.status, 202);
    assert.equal((await call("ann", "GET", "/workflows/refunds/runs", undefined, "initech")).status, 403);

    await call("zoe", "PUT", "/projects/initech/members/ann", { roles: ["viewer"] }, null);
    assert.equal((await call("ann", "GET", "/workflows/refunds/runs", undefined, "initech")).status, 200);
    assert.equal((await call("ann", "PUT", "/projects/initech/members/ann", { roles: ["owner"] }, null)).status, 403);
    assert.equal((await call("ann", "POST", "/projects", { id: "acme", name: "Taken" }, null)).status, 409);
  } finally {
    await desk.queue.stop();
  }
});

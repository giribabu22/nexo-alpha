import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createMetricsApiModule, createMetricsCollector } from "../dist/index.js";

test("a fresh collector reports empty metrics", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  assert.deepEqual(metrics.getMetrics(), { apis: {}, jobs: {}, workflows: {}, queues: {} });
});

test("api.called accumulates calls, errors, and average duration per API", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/orders/:id", statusCode: 200, durationMs: 10 });
  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/orders/:id", statusCode: 200, durationMs: 20 });
  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/orders/:id", statusCode: 404, durationMs: 30 });

  const snapshot = metrics.getMetrics();
  assert.deepEqual(snapshot.apis.getOrder, { calls: 3, errors: 1, averageDurationMs: 20 });
});

test("api.error increments the error count for that API", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  app.events.emit("api.called", { api: "createOrder", method: "POST", path: "/orders", statusCode: 200, durationMs: 5 });
  app.events.emit("api.error", { api: "createOrder", method: "POST", path: "/orders", durationMs: 8, error: "boom" });

  const snapshot = metrics.getMetrics();
  assert.equal(snapshot.apis.createOrder.calls, 1);
  assert.equal(snapshot.apis.createOrder.errors, 1);
});

test("job.ran and job.failed accumulate runs, failures, and average duration per job", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  app.events.emit("job.ran", { job: "retryPayments", durationMs: 100 });
  app.events.emit("job.ran", { job: "retryPayments", durationMs: 200 });
  app.events.emit("job.failed", { job: "retryPayments", durationMs: 50, error: "timeout" });

  const snapshot = metrics.getMetrics();
  assert.deepEqual(snapshot.jobs.retryPayments, { runs: 2, failures: 1, averageDurationMs: 150 });
});

test("reset() zeroes all accumulated metrics", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/orders/:id", statusCode: 200, durationMs: 10 });
  metrics.reset();

  assert.deepEqual(metrics.getMetrics(), { apis: {}, jobs: {}, workflows: {}, queues: {} });
});

test("stop() unsubscribes so further events no longer change the snapshot", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/orders/:id", statusCode: 200, durationMs: 10 });
  metrics.stop();
  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/orders/:id", statusCode: 200, durationMs: 999 });

  assert.deepEqual(metrics.getMetrics(), {
    apis: { getOrder: { calls: 1, errors: 0, averageDurationMs: 10 } },
    jobs: {},
    workflows: {},
    queues: {}
  });
});

test("workflowListener: counts runs, pauses and steps per workflow, averaging finished-run duration", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);
  const on = metrics.workflowListener;

  on({ type: "workflow.started", workflowName: "refund", workflowId: "a", goal: "g" });
  on({ type: "step.completed", workflowName: "refund", workflowId: "a", step: 1 });
  on({ type: "workflow.completed", workflowName: "refund", workflowId: "a", steps: 1, durationMs: 100 });
  on({ type: "workflow.started", workflowName: "refund", workflowId: "b", goal: "g" });
  on({ type: "step.failed", workflowName: "refund", workflowId: "b", step: 1, error: "x" });
  on({ type: "workflow.failed", workflowName: "refund", workflowId: "b", step: 1, error: "x", durationMs: 300 });
  on({ type: "workflow.paused", workflowName: "review", workflowId: "c", step: 1, status: "WAITING" });
  on({ type: "workflow.resumed", workflowName: "review", workflowId: "c", step: 1 });

  const { workflows } = metrics.getMetrics();
  assert.deepEqual(workflows.refund, {
    started: 2, completed: 1, failed: 1, cancelled: 0, paused: 0,
    stepsCompleted: 1, stepsFailed: 1, averageDurationMs: 200
  });
  assert.equal(workflows.review.paused, 1);
});

test("queueListener: counts enqueued, completed, retried and failed jobs per type", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);
  const job = (extra = {}) => ({ type: "send-email", ...extra });

  metrics.queueListener({ type: "job.enqueued", job: job() });
  metrics.queueListener({ type: "job.started", job: job() });
  metrics.queueListener({ type: "job.retrying", job: job() });
  metrics.queueListener({ type: "job.completed", job: job({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.250Z" }) });
  metrics.queueListener({ type: "job.enqueued", job: job() });
  metrics.queueListener({ type: "job.failed", job: job() });

  assert.deepEqual(metrics.getMetrics().queues["send-email"], {
    enqueued: 2, completed: 1, failed: 1, retried: 1, averageDurationMs: 250
  });

  metrics.reset();
  assert.deepEqual(metrics.getMetrics().queues, {});
});

test("toPrometheus: renders every family with HELP/TYPE lines and escaped labels", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/o", statusCode: 200, durationMs: 250 });
  metrics.workflowListener({ type: "workflow.completed", workflowName: 'odd "name"', workflowId: "a", steps: 1, durationMs: 1500 });
  metrics.queueListener({ type: "job.enqueued", job: { type: "nexo.webhook.deliver" } });

  const text = metrics.toPrometheus();
  assert.match(text, /^# HELP nexo_api_calls_total API calls handled\.$/m);
  assert.match(text, /^# TYPE nexo_api_calls_total counter$/m);
  assert.match(text, /^nexo_api_calls_total\{api="getOrder"\} 1$/m);
  assert.match(text, /^nexo_api_duration_seconds_avg\{api="getOrder"\} 0\.25$/m);
  assert.match(text, /^nexo_workflow_runs_completed_total\{workflow="odd \\"name\\""\} 1$/m);
  assert.match(text, /^nexo_workflow_run_duration_seconds_avg\{workflow="odd \\"name\\""\} 1\.5$/m);
  assert.match(text, /^nexo_queue_jobs_enqueued_total\{type="nexo\.webhook\.deliver"\} 1$/m);
  assert.ok(text.endsWith("\n"));
});

test("createMetricsApiModule: GET /metrics returns the live snapshot through dispatch", async () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);
  app.module(createMetricsApiModule(metrics));
  metrics.workflowListener({ type: "workflow.started", workflowName: "refund", workflowId: "a", goal: "g" });

  const snapshot = await app.dispatch("getMetrics", { params: {}, query: {}, payload: undefined, headers: {} });
  assert.equal(snapshot.workflows.refund.started, 1);
  assert.equal(app.getApis().find((api) => api.name === "getMetrics").path, "/metrics");
});

test("createMetricsApiModule: GET /metrics/prometheus serves Prometheus text with the right content type", async () => {
  const { createHapiServer } = await import("@nexo-alpha/hapi");
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);
  app.module(createMetricsApiModule(metrics));
  metrics.workflowListener({ type: "workflow.started", workflowName: "refund", workflowId: "a", goal: "g" });

  const server = await createHapiServer(app, { logging: false });
  const response = await server.inject({ method: "GET", url: "/metrics/prometheus" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/plain; version=0.0.4; charset=utf-8");
  assert.match(response.payload, /^nexo_workflow_runs_started_total\{workflow="refund"\} 1$/m);

  const json = await server.inject({ method: "GET", url: "/metrics" });
  assert.equal(JSON.parse(json.payload).workflows.refund.started, 1);

  const custom = createApplication({ name: "custom" });
  custom.module(createMetricsApiModule(createMetricsCollector(custom), { path: "/ops/metrics", prometheusPath: false }));
  assert.deepEqual(custom.getApis().map((api) => api.path), ["/ops/metrics"]);
});

test("per-project metrics: events inside a project count for it and for the platform totals", async () => {
  const { runInProject } = await import("@nexo-alpha/core");
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  runInProject("acme", () => metrics.workflowListener({ type: "workflow.started", workflowName: "refund", workflowId: "a", goal: "g" }));
  runInProject("globex", () => metrics.workflowListener({ type: "workflow.started", workflowName: "refund", workflowId: "b", goal: "g" }));
  metrics.workflowListener({ type: "workflow.started", workflowName: "refund", workflowId: "c", goal: "g" });
  metrics.queueListener({ type: "job.enqueued", job: { type: "send", projectId: "acme" } });
  runInProject("acme", () => app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/o", statusCode: 200, durationMs: 5 }));
  app.events.emit("job.ran", { job: "nightly", durationMs: 10 });

  assert.equal(metrics.getMetrics().workflows.refund.started, 3);
  assert.equal(metrics.getMetrics({ projectId: "acme" }).workflows.refund.started, 1);
  assert.equal(metrics.getMetrics({ projectId: "acme" }).queues.send.enqueued, 1);
  assert.equal(metrics.getMetrics({ projectId: "acme" }).apis.getOrder.calls, 1);
  assert.deepEqual(metrics.getMetrics({ projectId: "acme" }).jobs, {}); // cron jobs are platform-level
  assert.equal(metrics.getMetrics({ projectId: "globex" }).queues.send, undefined);
  assert.deepEqual(metrics.getMetrics({ projectId: "unknown" }), { apis: {}, jobs: {}, workflows: {}, queues: {} });
  assert.deepEqual(metrics.projectIds().sort(), ["acme", "globex"]);
  assert.match(metrics.toPrometheus({ projectId: "globex" }), /nexo_workflow_runs_started_total\{workflow="refund"\} 1/);

  metrics.reset();
  assert.deepEqual(metrics.projectIds(), []);
});

test("createMetricsApiModule({ scope: 'project' }): tenants see only their project; outside a project it is a 400", async () => {
  const { createHapiServer } = await import("@nexo-alpha/hapi");
  const { runInProject } = await import("@nexo-alpha/core");
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);
  app.module(createMetricsApiModule(metrics, { name: "project-metrics", path: "/project/metrics", scope: "project" }));
  app.module(createMetricsApiModule(metrics));
  runInProject("acme", () => metrics.workflowListener({ type: "workflow.started", workflowName: "refund", workflowId: "a", goal: "g" }));
  metrics.workflowListener({ type: "workflow.started", workflowName: "refund", workflowId: "b", goal: "g" });

  const server = await createHapiServer(app, {
    logging: false,
    project: { resolve: (context) => context.headers["x-project-id"], required: false }
  });
  const get = async (url, headers = {}) => {
    const response = await server.inject({ method: "GET", url, headers });
    return { status: response.statusCode, body: response.payload };
  };

  assert.equal(JSON.parse((await get("/project/metrics", { "x-project-id": "acme" })).body).workflows.refund.started, 1);
  assert.equal(JSON.parse((await get("/project/metrics", { "x-project-id": "globex" })).body).workflows.refund, undefined);
  assert.equal((await get("/project/metrics")).status, 400);
  assert.match((await get("/project/metrics/prometheus", { "x-project-id": "acme" })).body, /started_total\{workflow="refund"\} 1/);
  assert.equal(JSON.parse((await get("/metrics")).body).workflows.refund.started, 2);
  assert.deepEqual(app.getApis().map((api) => api.name).sort(), ["getMetrics", "getProjectMetrics", "getProjectPrometheusMetrics", "getPrometheusMetrics"]);
});

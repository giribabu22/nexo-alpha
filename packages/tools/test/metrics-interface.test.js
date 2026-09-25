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

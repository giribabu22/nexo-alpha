import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createMetricsCollector } from "../dist/index.js";

test("a fresh collector reports empty metrics", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  assert.deepEqual(metrics.getMetrics(), { apis: {}, jobs: {} });
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

  assert.deepEqual(metrics.getMetrics(), { apis: {}, jobs: {} });
});

test("stop() unsubscribes so further events no longer change the snapshot", () => {
  const app = createApplication({ name: "shop" });
  const metrics = createMetricsCollector(app);

  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/orders/:id", statusCode: 200, durationMs: 10 });
  metrics.stop();
  app.events.emit("api.called", { api: "getOrder", method: "GET", path: "/orders/:id", statusCode: 200, durationMs: 999 });

  assert.deepEqual(metrics.getMetrics(), {
    apis: { getOrder: { calls: 1, errors: 0, averageDurationMs: 10 } },
    jobs: {}
  });
});

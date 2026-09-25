/**
 * Memory + metrics client and component tests (client tests run against a live Hapi server).
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

import { createApplication } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { createInMemoryAgentMemory, createMemoryApiModule } from "@nexo-alpha/agent";

import {
  createNexoClient,
  NexoApiError,
  NexoMemoryBrowser,
  NexoMetricsDashboard,
  NexoProvider,
  summarizeMetrics
} from "../dist/index.js";

test("client.memory: remember, get, recall with filters, forget against a live server", async () => {
  const app = createApplication({ name: "memory-client" });
  app.module(createMemoryApiModule({ memory: createInMemoryAgentMemory() }));
  const server = await startHapiServer(app, { port: 0, logging: false, bindLifecycle: false });
  try {
    const client = createNexoClient({ baseUrl: server.info.uri });

    const entry = await client.memory.remember("customer 42/pref", { refund: "cash" }, { tags: ["customer", "vip"], scope: "support" });
    assert.equal(entry.key, "customer 42/pref");
    await client.memory.remember("shipping", "two days", { tags: ["policy"] });

    assert.deepEqual((await client.memory.get("customer 42/pref")).value, { refund: "cash" });
    assert.deepEqual((await client.memory.recall({ text: "refund" })).map((e) => e.key), ["customer 42/pref"]);
    assert.equal((await client.memory.recall({ tags: ["customer", "vip"], scope: "support", limit: 5 })).length, 1);
    assert.equal((await client.memory.recall()).length, 2);

    await client.memory.forget("shipping");
    await assert.rejects(client.memory.get("shipping"), (error) => error instanceof NexoApiError && error.status === 404);
    await assert.rejects(client.memory.forget("shipping"), (error) => error.status === 404);
  } finally {
    await server.stop();
  }
});

const snapshot = {
  apis: { getOrder: { calls: 10, errors: 2, averageDurationMs: 12.4 } },
  jobs: {},
  workflows: {
    refund: { started: 5, completed: 3, failed: 1, cancelled: 0, paused: 1, stepsCompleted: 8, stepsFailed: 1, averageDurationMs: 1500 },
    lookup: { started: 2, completed: 2, failed: 0, cancelled: 0, paused: 0, stepsCompleted: 2, stepsFailed: 0, averageDurationMs: 20 }
  },
  queues: { "nexo.webhook.deliver": { enqueued: 4, completed: 3, failed: 1, retried: 2, averageDurationMs: 80 } }
};

test("summarizeMetrics: totals across entries", () => {
  assert.deepEqual(summarizeMetrics(snapshot), {
    apiCalls: 10, apiErrors: 2, workflowRunsStarted: 7, workflowRunsFailed: 1, queueJobsFailed: 1, queueJobsRetried: 2
  });
});

test("client.getMetrics: GETs the metrics path", async () => {
  const urls = [];
  const client = createNexoClient({
    baseUrl: "http://api.example",
    fetch: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(snapshot), { status: 200 });
    }
  });
  assert.equal((await client.getMetrics()).workflows.refund.started, 5);
  await client.getMetrics("/ops/metrics");
  assert.deepEqual(urls, ["http://api.example/metrics", "http://api.example/ops/metrics"]);
});

test("NexoMetricsDashboard: renders summary tiles and only non-empty sections", () => {
  const html = renderToString(React.createElement(NexoMetricsDashboard, { metrics: snapshot }));
  assert.ok(html.includes("API calls"));
  assert.ok(html.includes("Workflow runs"));
  assert.ok(html.includes("refund"));
  assert.ok(html.includes("nexo.webhook.deliver"));
  assert.ok(html.includes("1500ms"));
  assert.ok(html.includes("8/1"));
  assert.ok(!html.includes("Cron jobs"));

  const loading = renderToString(
    React.createElement(NexoProvider, { baseUrl: "http://localhost:0" }, React.createElement(NexoMetricsDashboard, {}))
  );
  assert.ok(loading.includes("Loading metrics"));
});

test("NexoMemoryBrowser: renders fixed entries with tags, scope and truncated values", () => {
  const long = "x".repeat(200);
  const html = renderToString(React.createElement(NexoMemoryBrowser, {
    entries: [
      { key: "refund-policy", value: { limit: 500 }, tags: ["policy"], scope: "support", createdAt: "2026-09-25T10:00:00.000Z", updatedAt: "2026-09-25T10:00:00.000Z" },
      { key: "long", value: long, tags: [], createdAt: "2026-09-25T10:00:00.000Z", updatedAt: "2026-09-25T11:30:00.000Z" }
    ]
  }));
  assert.ok(html.includes('data-memory-key="refund-policy"'));
  assert.ok(html.includes("{&quot;limit&quot;:500}"));
  assert.ok(html.includes("support"));
  assert.ok(html.includes("policy"));
  assert.ok(html.includes("2026-09-25 11:30:00"));
  assert.ok(html.includes("x".repeat(117) + "…"));
  assert.ok(html.includes("2<!-- --> entries") || html.includes("2 entries"));
  assert.ok(!html.includes("Search memory"));
  assert.ok(!html.includes("Forget"));

  const connected = renderToString(
    React.createElement(NexoProvider, { baseUrl: "http://localhost:0" }, React.createElement(NexoMemoryBrowser, { allowForget: true }))
  );
  assert.ok(connected.includes("Search memory"));
  assert.ok(connected.includes("No memory entries"));
});

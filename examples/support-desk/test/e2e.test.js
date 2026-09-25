/**
 * The complete flow over real TCP:
 * user → frontend client → HTTP API → auth → queue → workflow runtime →
 * decision/RBAC → tools → verification → events → webhooks + metrics → response.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createInMemoryDocumentStore, createLogger, signToken } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { createNexoClient, NexoApiError } from "@nexo-alpha/frontend/client";

import { createSupportDesk, seedDemoProjects } from "../dist/app.js";

const SECRET = "e2e-secret-that-is-at-least-32-bytes-long";

test("end to end: frontend client drives a refund with manager approval over HTTP", async () => {
  const entries = [];
  const logger = createLogger({ sink: (entry) => entries.push(entry) });
  const desk = createSupportDesk({ store: createInMemoryDocumentStore(), jwtSecret: SECRET, logger, pollIntervalMs: 10 });
  const server = await startHapiServer(desk.app, { port: 0, logger, authenticate: desk.authenticate, project: desk.project, bindLifecycle: false });
  await seedDemoProjects(desk.projects);
  await desk.queue.start();

  const clientFor = (user, projectId = "acme") => createNexoClient({
    baseUrl: server.info.uri,
    ...(projectId !== null ? { projectId } : {}),
    headers: { Authorization: `Bearer ${signToken({ sub: user, iss: "support-desk" }, SECRET, { expiresInSeconds: 60 })}` }
  });
  const sam = clientFor("sam");
  const max = clientFor("max");

  try {
    // Discovery
    const [description] = await Promise.all([sam.workflows.describe("refunds")]);
    assert.deepEqual(description.tools.map((t) => [t.action, t.permissions]), [["lookup_order", ["orders:read"]], ["refund_order", ["orders:refund"]]]);

    // Support agent starts a large refund; it runs in the background and pauses for approval.
    const started = await sam.workflows.startRun("refunds", { goal: "Refund order o-2" });
    assert.equal(started.status, "RUNNING");
    const waiting = await sam.workflows.waitForRun("refunds", started.id, { intervalMs: 20, timeoutMs: 5000 });
    assert.equal(waiting.status, "WAITING");

    // The manager approves; verification passes and the run completes.
    await max.workflows.resumeRun("refunds", waiting.id, { approved: true });
    const done = await max.workflows.waitForRun("refunds", waiting.id, { intervalMs: 20, timeoutMs: 5000 });
    assert.equal(done.status, "COMPLETED");
    // History: lookup (approved), refund blocked for approval (ASK_USER), refund approved after resume.
    assert.deepEqual(done.history.map((step) => [step.intent.action, step.status]), [
      ["lookup_order", "APPROVED_AND_COMPLETE"],
      ["refund_order", "BLOCKED"],
      ["refund_order", "APPROVED_AND_COMPLETE"]
    ]);
    assert.ok(done.history.filter((step) => step.status === "APPROVED_AND_COMPLETE").every((step) => step.verificationResult?.status === "COMPLETE"));

    // Memory and metrics reflect the run.
    assert.deepEqual((await sam.memory.get("refund:o-2")).value, { amount: 250, by: "max" });
    const metrics = await clientFor("ops", null).getMetrics();
    assert.equal(metrics.workflows.refunds.completed, 1);
    assert.equal(metrics.workflows.refunds.paused, 1);

    // Permissions are enforced at the HTTP layer too.
    await assert.rejects(sam.memory.remember("k", 1), (error) => error instanceof NexoApiError && error.status === 403);

    // Every HTTP response was logged with a request ID.
    const httpLogs = entries.filter((entry) => entry.msg === "http request");
    assert.ok(httpLogs.length >= 6);
    assert.ok(httpLogs.every((entry) => typeof entry.requestId === "string" && entry.requestId.length > 0));
  } finally {
    await desk.queue.stop();
    await server.stop();
  }
});

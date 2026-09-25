import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { createInMemoryDocumentStore } from "@nexo-alpha/core";
import { createJobQueue } from "@nexo-alpha/scheduler";

import {
  createWebhookDispatcher,
  eventMatches,
  signWebhookPayload,
  verifyWebhookSignature
} from "../dist/index.js";

/** A local HTTP receiver that records requests and answers with scripted statuses. */
async function startReceiver(statuses = []) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      requests.push({ headers: req.headers, body });
      res.statusCode = statuses.shift() ?? 200;
      res.end("ok");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/hooks`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function setup(dispatcherOptions = {}) {
  const store = createInMemoryDocumentStore();
  const queue = createJobQueue({ store, pollIntervalMs: 10, backoffMs: () => 0 });
  const webhooks = createWebhookDispatcher({ store, queue, ...dispatcherOptions });
  return { store, queue, webhooks };
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

test("signatures: verify accepts the original body and rejects tampering, wrong secrets and stale timestamps", () => {
  const body = JSON.stringify({ event: "x" });
  const now = Date.UTC(2026, 8, 25);
  const t = Math.floor(now / 1000);
  const signature = signWebhookPayload(body, "s3cret", t);

  assert.match(signature, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(verifyWebhookSignature({ body, signature, secret: "s3cret", now }), true);
  assert.equal(verifyWebhookSignature({ body: body + " ", signature, secret: "s3cret", now }), false);
  assert.equal(verifyWebhookSignature({ body, signature, secret: "other", now }), false);
  assert.equal(verifyWebhookSignature({ body, signature, secret: "s3cret", now: now + 301_000 }), false);
  assert.equal(verifyWebhookSignature({ body, signature, secret: "s3cret", now: now + 301_000, toleranceSeconds: 600 }), true);
  assert.equal(verifyWebhookSignature({ body, signature: undefined, secret: "s3cret", now }), false);
  assert.equal(verifyWebhookSignature({ body, signature: "garbage", secret: "s3cret", now }), false);
  assert.equal(verifyWebhookSignature({ body, signature: `t=${t},v1=zz`, secret: "s3cret", now }), false);
});

test("eventMatches: exact, '*' and 'prefix.*'", () => {
  assert.equal(eventMatches("workflow.completed", "workflow.completed"), true);
  assert.equal(eventMatches("*", "job.failed"), true);
  assert.equal(eventMatches("workflow.*", "workflow.step.failed"), true);
  assert.equal(eventMatches("workflow.*", "workflowx.completed"), false);
  assert.equal(eventMatches("workflow.*", "workflow"), false);
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

test("subscriptions: secret is returned only on subscribe; update, list, unsubscribe", async () => {
  const { webhooks } = setup();

  const created = await webhooks.subscribe({ url: "https://example.com/a", events: ["workflow.*"], description: "ops" });
  assert.equal(created.secret.length, 64);
  assert.equal(created.active, true);

  assert.equal("secret" in (await webhooks.get(created.id)), false);
  assert.equal("secret" in (await webhooks.list())[0], false);

  const updated = await webhooks.update(created.id, { active: false, events: ["job.*"] });
  assert.equal(updated.active, false);
  assert.deepEqual(updated.events, ["job.*"]);
  assert.equal("secret" in updated, false);
  assert.equal(await webhooks.update("missing", { active: true }), undefined);

  assert.equal(await webhooks.unsubscribe(created.id), true);
  assert.deepEqual(await webhooks.list(), []);
});

test("subscriptions: invalid URLs, non-http schemes, empty events and disallowed URLs are rejected", async () => {
  const { webhooks } = setup({ allowUrl: (url) => url.hostname !== "169.254.169.254" });

  await assert.rejects(webhooks.subscribe({ url: "not a url", events: ["*"] }), /Invalid webhook URL/);
  await assert.rejects(webhooks.subscribe({ url: "file:///etc/passwd", events: ["*"] }), /http or https/);
  await assert.rejects(webhooks.subscribe({ url: "https://example.com", events: [] }), /at least one event/);
  await assert.rejects(webhooks.subscribe({ url: "http://169.254.169.254/latest", events: ["*"] }), /not allowed/);

  const ok = await webhooks.subscribe({ url: "https://example.com", events: ["*"] });
  await assert.rejects(webhooks.update(ok.id, { url: "ftp://example.com" }), /http or https/);
});

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

test("delivery: matching subscribers receive a signed POST the receiver can verify", async () => {
  const receiver = await startReceiver();
  const { queue, webhooks } = setup();
  await queue.start();
  try {
    const sub = await webhooks.subscribe({ url: receiver.url, events: ["workflow.*"] });
    await webhooks.subscribe({ url: receiver.url, events: ["job.*"] });
    await webhooks.subscribe({ url: receiver.url, events: ["*"], active: false });

    const ids = await webhooks.dispatch("workflow.completed", { workflowId: "wf-1" });
    assert.equal(ids.length, 1);
    await queue.whenIdle();

    assert.equal(receiver.requests.length, 1);
    const [request] = receiver.requests;
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["x-nexo-event"], "workflow.completed");
    assert.equal(request.headers["x-nexo-delivery"], ids[0]);
    assert.equal(verifyWebhookSignature({ body: request.body, signature: request.headers["x-nexo-signature"], secret: sub.secret }), true);

    const delivery = JSON.parse(request.body);
    assert.equal(delivery.id, ids[0]);
    assert.equal(delivery.event, "workflow.completed");
    assert.deepEqual(delivery.data, { workflowId: "wf-1" });
  } finally {
    await queue.stop();
    await receiver.close();
  }
});

test("delivery: non-2xx responses are retried with the same delivery ID until they succeed or attempts run out", async () => {
  const receiver = await startReceiver([500, 503, 200, 500, 500, 500]);
  const { queue, webhooks } = setup({ maxAttempts: 3 });
  await queue.start();
  try {
    await webhooks.subscribe({ url: receiver.url, events: ["a"] });

    await webhooks.dispatch("a", { n: 1 });
    await queue.whenIdle();
    assert.equal(receiver.requests.length, 3);
    assert.equal(new Set(receiver.requests.map((r) => r.headers["x-nexo-delivery"])).size, 1);

    await webhooks.dispatch("a", { n: 2 });
    await queue.whenIdle();
    const [failed] = await queue.list({ status: "failed" });
    assert.equal(failed.attempts, 3);
    assert.match(failed.error, /responded 500/);
  } finally {
    await queue.stop();
    await receiver.close();
  }
});

test("delivery: skipped when the subscription is deactivated or removed after dispatch", async () => {
  const receiver = await startReceiver();
  const { queue, webhooks } = setup();
  try {
    const paused = await webhooks.subscribe({ url: receiver.url, events: ["e"] });
    const removed = await webhooks.subscribe({ url: receiver.url, events: ["e"] });
    await webhooks.dispatch("e", {});

    await webhooks.update(paused.id, { active: false });
    await webhooks.unsubscribe(removed.id);
    await queue.start();
    await queue.whenIdle();

    assert.equal(receiver.requests.length, 0);
    const results = (await queue.list({ status: "completed" })).map((job) => job.result);
    assert.deepEqual(results, [{ skipped: true }, { skipped: true }]);
  } finally {
    await queue.stop();
    await receiver.close();
  }
});

test("forward: dispatches event.type with the event as data, and never throws", async () => {
  const receiver = await startReceiver();
  const { queue, webhooks, store } = setup();
  await queue.start();
  try {
    await webhooks.subscribe({ url: receiver.url, events: ["workflow.completed"] });
    await webhooks.forward({ type: "workflow.completed", workflowId: "wf-9", steps: 2 });
    await queue.whenIdle();
    assert.deepEqual(JSON.parse(receiver.requests[0].body).data, { type: "workflow.completed", workflowId: "wf-9", steps: 2 });

    await store.close(); // make dispatch fail
    await webhooks.forward({ type: "workflow.completed" });
  } finally {
    await queue.stop();
    await receiver.close();
  }
});

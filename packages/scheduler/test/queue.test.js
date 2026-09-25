import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { createInMemoryDocumentStore, createSqliteDocumentStore } from "@nexo-alpha/core";
import { createJobQueue } from "../dist/index.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);

function queueWith(overrides = {}) {
  const events = [];
  const store = overrides.store ?? createInMemoryDocumentStore();
  const queue = createJobQueue({
    store,
    pollIntervalMs: 10,
    backoffMs: () => 0,
    onEvent: (event) => events.push(event.type),
    ...overrides
  });
  return { queue, store, events };
}

test("JobQueue: runs an enqueued job and records its result", async () => {
  const { queue, events } = queueWith();
  queue.define("add", async ({ a, b }, context) => ({ sum: a + b, attempt: context.attempt }));
  await queue.start();

  const job = await queue.enqueue("add", { a: 2, b: 3 });
  assert.equal(job.status, "queued");
  await queue.whenIdle();

  const done = await queue.get(job.id);
  assert.equal(done.status, "completed");
  assert.deepEqual(done.result, { sum: 5, attempt: 1 });
  assert.equal(done.attempts, 1);
  assert.ok(done.startedAt && done.finishedAt);
  assert.deepEqual(events, ["job.enqueued", "job.started", "job.completed"]);
  await queue.stop();
});

test("JobQueue: retries failures until maxAttempts, then marks the job failed", async () => {
  const { queue, events } = queueWith();
  let calls = 0;
  queue.define("flaky", async () => {
    calls += 1;
    if (calls < 3) throw new Error(`boom ${calls}`);
    return "ok";
  });
  queue.define("broken", async () => {
    throw new Error("always");
  });
  await queue.start();

  const flaky = await queue.enqueue("flaky", {}, { maxAttempts: 3 });
  const broken = await queue.enqueue("broken", {}, { maxAttempts: 2 });
  await queue.whenIdle();

  const flakyDone = await queue.get(flaky.id);
  assert.equal(flakyDone.status, "completed");
  assert.equal(flakyDone.attempts, 3);
  assert.equal(flakyDone.error, undefined);

  const brokenDone = await queue.get(broken.id);
  assert.equal(brokenDone.status, "failed");
  assert.equal(brokenDone.attempts, 2);
  assert.equal(brokenDone.error, "always");
  assert.ok(events.includes("job.retrying") && events.includes("job.failed"));
  await queue.stop();
});

test("JobQueue: uses backoff delays between attempts", async () => {
  const delays = [];
  const { queue } = queueWith({ backoffMs: (attempt) => { delays.push(attempt); return 60_000; } });
  queue.define("fail", async () => { throw new Error("x"); });
  await queue.start();

  const job = await queue.enqueue("fail", {}, { maxAttempts: 5 });
  await queue.whenIdle();

  const waiting = await queue.get(job.id);
  assert.equal(waiting.status, "queued");
  assert.equal(waiting.attempts, 1);
  assert.deepEqual(delays, [1]);
  assert.ok(new Date(waiting.runAt).getTime() > Date.now() + 50_000);
  await queue.stop();
});

test("JobQueue: respects concurrency", async () => {
  const { queue } = queueWith({ concurrency: 2 });
  let active = 0;
  let peak = 0;
  queue.define("slow", async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
  });
  await queue.start();

  await Promise.all(Array.from({ length: 6 }, () => queue.enqueue("slow", {})));
  await queue.whenIdle();

  assert.equal(peak, 2);
  assert.equal((await queue.list({ status: "completed" })).length, 6);
  await queue.stop();
});

test("JobQueue: delayed jobs wait, cancelled jobs never run, list filters by status and type", async () => {
  const { queue } = queueWith();
  const ran = [];
  queue.define("t", async (payload) => { ran.push(payload.n); });
  await queue.start();

  const later = await queue.enqueue("t", { n: 1 }, { delayMs: 60_000 });
  const cancelled = await queue.enqueue("t", { n: 2 }, { delayMs: 60_000 });
  await queue.enqueue("t", { n: 3 });
  assert.equal(await queue.cancel(cancelled.id), true);
  assert.equal(await queue.cancel(cancelled.id), false);
  await queue.whenIdle();

  assert.deepEqual(ran, [3]);
  assert.equal((await queue.get(later.id)).status, "queued");
  assert.equal((await queue.list({ status: "cancelled" }))[0].id, cancelled.id);
  assert.equal((await queue.list({ type: "other" })).length, 0);
  await queue.stop();
});

test("JobQueue: jobs of undefined types wait until a handler is defined", async () => {
  const { queue } = queueWith();
  await queue.start();
  const job = await queue.enqueue("later-defined", { x: 1 });
  await queue.whenIdle();
  assert.equal((await queue.get(job.id)).status, "queued");

  queue.define("later-defined", async () => "done");
  await queue.whenIdle();
  assert.equal((await queue.get(job.id)).status, "completed");
  await queue.stop();
});

test("JobQueue: duplicate definitions and duplicate job IDs are rejected", async () => {
  const { queue } = queueWith();
  queue.define("a", async () => {});
  assert.throws(() => queue.define("a", async () => {}), /already defined/);

  await queue.enqueue("a", {}, { id: "fixed" });
  await assert.rejects(queue.enqueue("a", {}, { id: "fixed" }), /already exists/);
});

test("JobQueue: stop() waits for running jobs; start() recovers jobs interrupted by a crash", async () => {
  const store = createInMemoryDocumentStore();
  const { queue: first } = queueWith({ store });
  let finished = false;
  first.define("slow", async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    finished = true;
  });
  await first.start();
  const job = await first.enqueue("slow", {});
  await new Promise((resolve) => setTimeout(resolve, 5));
  await first.stop();
  assert.equal(finished, true);
  assert.equal((await first.get(job.id)).status, "completed");

  // Simulate a crash: a record left "running" by a dead process.
  await store.put("nexo_jobs", "crashed", { ...(await first.get(job.id)), id: "crashed", status: "running", attempts: 1, maxAttempts: 3 });

  const { queue: second, events } = queueWith({ store });
  const seen = [];
  second.define("slow", async (_payload, context) => { seen.push(context.attempt); });
  await second.start();
  await second.whenIdle();

  const recovered = await second.get("crashed");
  assert.equal(recovered.status, "completed");
  assert.deepEqual(seen, [2]);
  assert.ok(events.includes("job.recovered"));
  await second.stop();
});

test("JobQueue (SQLite): queued jobs survive a restart", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-queue-"));
  const file = path.join(dir, "jobs.sqlite");
  try {
    const firstStore = await createSqliteDocumentStore(file);
    const producer = createJobQueue({ store: firstStore });
    const job = await producer.enqueue("report", { month: "2026-09" });
    await firstStore.close();

    const secondStore = await createSqliteDocumentStore(file);
    const { queue: worker } = queueWith({ store: secondStore });
    const months = [];
    worker.define("report", async ({ month }) => { months.push(month); });
    await worker.start();
    await worker.whenIdle();
    await worker.stop();

    assert.deepEqual(months, ["2026-09"]);
    assert.equal((await worker.get(job.id)).status, "completed");
    await secondStore.close();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Multiple workers, leases
// ---------------------------------------------------------------------------

async function runTwoWorkers(storeA, storeB, jobs = 30) {
  const runs = new Map();
  const perWorker = { a: 0, b: 0 };
  const make = (store, name) => {
    const queue = createJobQueue({ store, workerId: name, concurrency: 3, pollIntervalMs: 5, backoffMs: () => 0 });
    queue.define("work", async ({ n }) => {
      runs.set(n, (runs.get(n) ?? 0) + 1);
      perWorker[name] += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
    });
    return queue;
  };
  const a = make(storeA, "a");
  const b = make(storeB, "b");
  for (let n = 0; n < jobs; n++) await a.enqueue("work", { n });
  await Promise.all([a.start(), b.start()]);

  const deadline = Date.now() + 15_000;
  while ((await a.list({ status: "completed" })).length < jobs && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await Promise.all([a.stop(), b.stop()]);
  return { runs, perWorker, completed: (await a.list({ status: "completed" })).length };
}

test("JobQueue: two workers sharing a store run every job exactly once", async () => {
  const store = createInMemoryDocumentStore();
  const { runs, perWorker, completed } = await runTwoWorkers(store, store);
  assert.equal(completed, 30);
  assert.equal(runs.size, 30);
  assert.ok([...runs.values()].every((count) => count === 1), JSON.stringify([...runs]));
  assert.ok(perWorker.a > 0 && perWorker.b > 0, JSON.stringify(perWorker));
});

test("JobQueue (SQLite): two workers on separate connections run every job exactly once", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-queue-workers-"));
  const file = path.join(dir, "jobs.sqlite");
  const storeA = await createSqliteDocumentStore(file);
  const storeB = await createSqliteDocumentStore(file);
  try {
    const { runs, perWorker, completed } = await runTwoWorkers(storeA, storeB);
    assert.equal(completed, 30);
    assert.ok([...runs.values()].every((count) => count === 1));
    assert.ok(perWorker.a > 0 && perWorker.b > 0, JSON.stringify(perWorker));
  } finally {
    await storeA.close();
    await storeB.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("JobQueue: expired leases are recovered by any worker; live leases of other workers are left alone", async () => {
  const store = createInMemoryDocumentStore();
  const base = { type: "work", payload: {}, attempts: 1, maxAttempts: 3, runAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "running" };
  await store.put("nexo_jobs", "dead", { ...base, id: "dead", workerId: "crashed-worker", leaseExpiresAt: "2000-01-01T00:00:00.000Z" });
  await store.put("nexo_jobs", "alive", { ...base, id: "alive", workerId: "busy-worker", leaseExpiresAt: "2999-01-01T00:00:00.000Z" });
  await store.put("nexo_jobs", "mine", { ...base, id: "mine", workerId: "me", leaseExpiresAt: "2999-01-01T00:00:00.000Z" });

  const ran = [];
  const events = [];
  const queue = createJobQueue({ store, workerId: "me", pollIntervalMs: 5, onEvent: (event) => events.push(`${event.type}:${event.job.id}`) });
  queue.define("work", async (_payload, context) => { ran.push(context.jobId); });
  await queue.start();
  await queue.whenIdle();
  await queue.stop();

  assert.deepEqual(ran.sort(), ["dead", "mine"]);
  assert.equal((await queue.get("alive")).status, "running");
  assert.equal((await queue.get("dead")).status, "completed");
  assert.equal((await queue.get("dead")).leaseExpiresAt, undefined);
  assert.ok(events.includes("job.recovered:dead") && events.includes("job.recovered:mine"));
});

test("JobQueue: a running job's lease is renewed, so a job longer than leaseMs is not taken over", async () => {
  const store = createInMemoryDocumentStore();
  const runs = [];
  const make = (name) => {
    const queue = createJobQueue({ store, workerId: name, leaseMs: 1000, pollIntervalMs: 20 });
    queue.define("long", async () => {
      runs.push(name);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    return queue;
  };
  const a = make("a");
  const b = make("b");
  await a.start();
  const job = await a.enqueue("long", {});
  await new Promise((resolve) => setTimeout(resolve, 100));
  await b.start(); // b keeps polling while the job on a runs past several lease periods

  await new Promise((resolve) => setTimeout(resolve, 2700));
  await Promise.all([a.stop(), b.stop()]);

  assert.deepEqual(runs, ["a"]);
  const done = await a.get(job.id);
  assert.equal(done.status, "completed");
  assert.equal(done.workerId, "a");
});

test("JobQueue: a worker that lost its lease cannot overwrite the record of the new owner", async () => {
  const store = createInMemoryDocumentStore();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queue = createJobQueue({ store, workerId: "old-owner", pollIntervalMs: 5 });
  queue.define("slow", async () => { await gate; return "stale result"; });
  await queue.start();
  const job = await queue.enqueue("slow", {});
  while ((await queue.get(job.id)).status !== "running") await new Promise((resolve) => setTimeout(resolve, 5));

  // Another worker takes the job over (e.g. after the lease expired during a long pause).
  const takenOver = { ...(await queue.get(job.id)), workerId: "new-owner", attempts: 2 };
  await store.put("nexo_jobs", job.id, takenOver);

  release();
  await queue.stop();
  const record = await queue.get(job.id);
  assert.equal(record.workerId, "new-owner");
  assert.equal(record.status, "running");
  assert.equal(record.result, undefined);
});

test("JobQueue: jobs remember their project and run inside it", async () => {
  const { runInProject, currentProjectId } = await import("@nexo-alpha/core");
  const { queue } = queueWith();
  const seen = [];
  queue.define("where", async () => { seen.push(currentProjectId() ?? "none"); });
  await queue.start();

  const acmeJob = await runInProject("acme", () => queue.enqueue("where", {}));
  await runInProject("globex", () => queue.enqueue("where", {}));
  await queue.enqueue("where", {});
  await queue.whenIdle();
  await queue.stop();

  assert.equal(acmeJob.projectId, "acme");
  assert.deepEqual(seen.sort(), ["acme", "globex", "none"]);
});

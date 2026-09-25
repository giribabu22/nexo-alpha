import test from "node:test";
import assert from "node:assert/strict";

import { createCircuitBreaker, NexoCircuitOpenError, NexoTimeoutError, retry, withTimeout } from "../dist/index.js";

const never = () => new Promise(() => {});

test("withTimeout: resolves in time, rejects with NexoTimeoutError otherwise", async () => {
  assert.equal(await withTimeout(Promise.resolve(1), 50), 1);
  assert.equal(await withTimeout(async () => 2, 50), 2);
  await assert.rejects(withTimeout(never(), 10), (error) => error instanceof NexoTimeoutError && error.timeoutMs === 10);
  await assert.rejects(withTimeout(never(), 10, "slow db"), /slow db/);
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 50), /boom/);
});

test("retry: retries until success, honours attempts, backoff and retryIf", async () => {
  let calls = 0;
  assert.equal(await retry(async (attempt) => { calls += 1; if (attempt < 3) throw new Error("flaky"); return "ok"; }, { backoffMs: 0 }), "ok");
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(retry(async () => { calls += 1; throw new Error("down"); }, { attempts: 2, backoffMs: 0 }), /down/);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(
    retry(async () => { calls += 1; throw new Error("400 bad request"); }, { backoffMs: 0, retryIf: (error) => !/400/.test(error.message) }),
    /400/
  );
  assert.equal(calls, 1);

  const delays = [];
  await assert.rejects(retry(async () => { throw new Error("x"); }, { attempts: 3, backoffMs: (n) => { delays.push(n); return 0; } }));
  assert.deepEqual(delays, [1, 2]);
});

test("circuit breaker: opens after threshold, fails fast, trial call closes or re-opens it", async () => {
  let now = 0;
  const states = [];
  const breaker = createCircuitBreaker({ failureThreshold: 2, resetMs: 1000, now: () => now, onStateChange: (s) => states.push(s) });
  const fail = () => breaker.run(async () => { throw new Error("down"); });

  await assert.rejects(fail(), /down/);
  assert.equal(breaker.state, "closed");
  await assert.rejects(fail(), /down/);
  assert.equal(breaker.state, "open");

  let called = false;
  await assert.rejects(breaker.run(async () => { called = true; }), (error) => error instanceof NexoCircuitOpenError && error.retryAfterMs === 1000);
  assert.equal(called, false);

  now += 1000;
  assert.equal(breaker.state, "half-open");
  await assert.rejects(fail(), /down/); // failed trial re-opens
  assert.equal(breaker.state, "open");

  now += 1000;
  assert.equal(await breaker.run(async () => "recovered"), "recovered");
  assert.equal(breaker.state, "closed");
  assert.deepEqual(states, ["open", "half-open", "open", "half-open", "closed"]);

  await assert.rejects(fail());
  breaker.reset();
  assert.equal(breaker.state, "closed");
});

test("retry does not hammer an open circuit", async () => {
  const breaker = createCircuitBreaker({ failureThreshold: 1, resetMs: 60_000 });
  await assert.rejects(breaker.run(async () => { throw new Error("down"); }));
  let calls = 0;
  await assert.rejects(retry(() => breaker.run(async () => { calls += 1; }), { backoffMs: 0 }), NexoCircuitOpenError);
  assert.equal(calls, 0);
});

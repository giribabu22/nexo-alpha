import test from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "../dist/index.js";

test("createRateLimiter: allows up to max per window per key, then resets", () => {
  let now = 1_000;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => now });

  assert.deepEqual(limiter.hit("a"), { allowed: true, limit: 2, remaining: 1, resetMs: 1000 });
  assert.equal(limiter.hit("a").remaining, 0);
  const blocked = limiter.hit("a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);

  assert.equal(limiter.hit("b").allowed, true); // keys are independent

  now += 400;
  assert.equal(limiter.peek("a").resetMs, 600);
  now += 600;
  assert.equal(limiter.hit("a").allowed, true); // new window
});

test("createRateLimiter: weighted costs, reset(), peek() does not consume, and expired keys are swept", () => {
  let now = 0;
  const limiter = createRateLimiter({ windowMs: 100, max: 10, now: () => now });

  assert.equal(limiter.hit("k", 7).remaining, 3);
  assert.equal(limiter.hit("k", 4).allowed, false);
  assert.equal(limiter.peek("k").remaining, 3);
  limiter.reset("k");
  assert.equal(limiter.peek("k").remaining, 10);

  for (let i = 0; i < 50; i++) limiter.hit(`user-${i}`);
  assert.equal(limiter.size, 50);
  now += 200;
  limiter.hit("fresh");
  assert.equal(limiter.size, 1);
});

test("createRateLimiter: rejects invalid configuration", () => {
  assert.throws(() => createRateLimiter({ windowMs: 0, max: 1 }), RangeError);
  assert.throws(() => createRateLimiter({ windowMs: 1000, max: 0 }), RangeError);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createJobScheduler } from "../dist/index.js";

function createFakeClock(initial) {
  let current = initial.getTime();
  const pending = new Map();
  let nextHandle = 1;

  return {
    clock: {
      now: () => new Date(current),
      setTimeout: (callback, ms) => {
        const handle = nextHandle++;
        pending.set(handle, { fireAt: current + ms, callback });
        return handle;
      },
      clearTimeout: (handle) => {
        pending.delete(handle);
      }
    },
    // Advances the fake clock and fires any timers whose fireAt has passed,
    // in fireAt order, one at a time (so a callback rescheduling a new timer
    // during advance() is itself considered).
    advanceTo: async (targetTime) => {
      current = targetTime;

      while (true) {
        let next;
        for (const [handle, entry] of pending) {
          if (entry.fireAt <= current && (!next || entry.fireAt < next.entry.fireAt)) {
            next = { handle, entry };
          }
        }

        if (!next) {
          break;
        }

        pending.delete(next.handle);
        next.entry.callback();
        // Let the callback's then/catch/finally promise chain fully settle
        // (including any synchronous re-scheduling it triggers) before
        // checking for further due timers. A real macrotask boundary
        // guarantees every pending microtask has drained, regardless of
        // how many .then/.catch/.finally links are in the chain.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    pendingCount: () => pending.size
  };
}

function buildApp(job) {
  const app = createApplication({ name: "shop" });
  app.module({ name: "jobs", jobs: [job] });
  return app;
}

test("a scheduled job with schedule and run fires at its computed next run time", async () => {
  const { clock, advanceTo } = createFakeClock(new Date(2026, 0, 1, 10, 0, 0));
  let runCount = 0;

  const app = buildApp({
    name: "tick",
    schedule: "*/5 * * * *",
    run: () => {
      runCount++;
    }
  });

  const scheduler = createJobScheduler(app, { clock });
  scheduler.start();

  await advanceTo(new Date(2026, 0, 1, 10, 4, 59).getTime());
  assert.equal(runCount, 0);

  await advanceTo(new Date(2026, 0, 1, 10, 5, 0).getTime());
  assert.equal(runCount, 1);

  scheduler.stop();
});

test("a job with no run or no schedule is never scheduled", async () => {
  const { clock, pendingCount } = createFakeClock(new Date(2026, 0, 1, 10, 0, 0));

  const app = createApplication({ name: "shop" });
  app.module({
    name: "jobs",
    jobs: [
      { name: "noRun", schedule: "* * * * *" },
      { name: "noSchedule", run: () => {} }
    ]
  });

  const scheduler = createJobScheduler(app, { clock });
  scheduler.start();

  assert.equal(pendingCount(), 0);
});

test("a thrown/rejected run() invokes onError and the job is rescheduled afterward", async () => {
  const { clock, advanceTo } = createFakeClock(new Date(2026, 0, 1, 10, 0, 0));
  const errors = [];
  let runCount = 0;

  const app = buildApp({
    name: "flaky",
    schedule: "*/5 * * * *",
    run: () => {
      runCount++;
      throw new Error("boom");
    }
  });

  const scheduler = createJobScheduler(app, {
    clock,
    onError: (job, error) => errors.push({ job: job.name, message: error.message })
  });
  scheduler.start();

  await advanceTo(new Date(2026, 0, 1, 10, 5, 0).getTime());
  assert.equal(runCount, 1);
  assert.deepEqual(errors, [{ job: "flaky", message: "boom" }]);

  await advanceTo(new Date(2026, 0, 1, 10, 10, 0).getTime());
  assert.equal(runCount, 2);

  scheduler.stop();
});

test("stop() prevents any further fires", async () => {
  const { clock, advanceTo } = createFakeClock(new Date(2026, 0, 1, 10, 0, 0));
  let runCount = 0;

  const app = buildApp({
    name: "tick",
    schedule: "*/5 * * * *",
    run: () => {
      runCount++;
    }
  });

  const scheduler = createJobScheduler(app, { clock });
  scheduler.start();
  scheduler.stop();

  await advanceTo(new Date(2026, 0, 1, 10, 30, 0).getTime());
  assert.equal(runCount, 0);
});

test("a successful run emits job.ran with a measured duration", async () => {
  const { clock, advanceTo } = createFakeClock(new Date(2026, 0, 1, 10, 0, 0));

  const app = buildApp({
    name: "tick",
    schedule: "*/5 * * * *",
    run: () => {}
  });

  const events = [];
  app.events.on("job.ran", (event) => events.push(event));

  const scheduler = createJobScheduler(app, { clock });
  scheduler.start();

  await advanceTo(new Date(2026, 0, 1, 10, 5, 0).getTime());

  assert.equal(events.length, 1);
  assert.equal(events[0].job, "tick");
  assert.equal(typeof events[0].durationMs, "number");
  assert.ok(events[0].durationMs >= 0);

  scheduler.stop();
});

test("a failing run emits job.failed in addition to calling onError", async () => {
  const { clock, advanceTo } = createFakeClock(new Date(2026, 0, 1, 10, 0, 0));

  const app = buildApp({
    name: "flaky",
    schedule: "*/5 * * * *",
    run: () => {
      throw new Error("boom");
    }
  });

  const failedEvents = [];
  app.events.on("job.failed", (event) => failedEvents.push(event));
  const errors = [];

  const scheduler = createJobScheduler(app, {
    clock,
    onError: (job, error) => errors.push({ job: job.name, message: error.message })
  });
  scheduler.start();

  await advanceTo(new Date(2026, 0, 1, 10, 5, 0).getTime());

  assert.equal(failedEvents.length, 1);
  assert.equal(failedEvents[0].job, "flaky");
  assert.equal(failedEvents[0].error, "boom");
  assert.deepEqual(errors, [{ job: "flaky", message: "boom" }]);

  scheduler.stop();
});

test("start() throws immediately if a scheduled job has an invalid schedule", () => {
  const { clock } = createFakeClock(new Date(2026, 0, 1, 10, 0, 0));

  const app = buildApp({
    name: "broken",
    schedule: "not a cron expression",
    run: () => {}
  });

  const scheduler = createJobScheduler(app, { clock });

  assert.throws(() => scheduler.start(), /Invalid cron expression/);
});

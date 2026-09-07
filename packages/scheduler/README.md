# @nexo-alpha/scheduler

Turns a [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) `NexoApplication`'s declared `NexoJob`s into actually-scheduled, actually-running work. Before this package, `NexoJob` was declaration-only (`name`, `description`, `schedule`) — nothing ran it.

## Install

```bash
npm install @nexo-alpha/scheduler @nexo-alpha/core
```

## Why

Nexo's application model is otherwise purely declarative. `@nexo-alpha/scheduler` is the adapter that turns a `run`-bearing `NexoJob` into a live timer, the same way `@nexo-alpha/hapi` turns a `handler`-bearing `NexoApi` into a live route — keeping `@nexo-alpha/core` itself free of timers and scheduling logic.

## Usage

```ts
import { createApplication } from "@nexo-alpha/core";
import { startJobScheduler } from "@nexo-alpha/scheduler";

const app = createApplication({ name: "shop" });

app.module({
  name: "payments",
  jobs: [
    {
      name: "retryFailedPayments",
      schedule: "*/5 * * * *", // every 5 minutes
      run: async () => {
        console.log("retrying failed payments...");
      }
    }
  ]
});

const scheduler = startJobScheduler(app);
// later:
scheduler.stop();
```

## What's here

- **`createJobScheduler(app, options?)`** — builds a scheduler for every job that has **both** `schedule` and `run`; a job with only one of the two is skipped, same as a handler-less `NexoApi` getting no route in `@nexo-alpha/hapi`.
- **`startJobScheduler(app, options?)`** — `createJobScheduler` plus `.start()`.
- **`.start()`** — parses every scheduled job's cron expression up front. If any job's `schedule` is malformed, `.start()` throws immediately, before scheduling *any* job — a schedule Nexo can't enforce is a loud failure at startup, not a silently-skipped job.
- **`.stop()`** — clears every pending timer. A job's failure (a thrown error or a rejected promise from `run()`) never crashes the scheduler — pass an `onError(job, error)` option to observe it — and the job is rescheduled for its next run regardless.
- **`parseCronExpression(expression)` / `getNextRunTime(schedule, from)`** — the cron engine underneath, exported directly if you want to compute run times yourself.

## Cron syntax

Standard 5-field cron (`minute hour day-of-month month day-of-week`), hand-rolled with **no dependency** — consistent with how the rest of Nexo hand-rolls small parsers (the CLI's argv parsing and `nexo.config.json` discovery) rather than reaching for a library. Supported per field: `*`, an exact number, `*/step`, comma-separated lists, and `a-b` ranges (with an optional `/step`). This is the practical subset used in the wild — no `L`/`W`/named months or weekdays. Day-of-week `7` is treated as `0` (Sunday). When **both** day-of-month and day-of-week are restricted, a match is either one (standard cron OR semantics); when only one is restricted, that one alone must match.

## Observability

Every run emits through `app.events` (`@nexo-alpha/core`'s `NexoEventBus`):

```ts
app.events.on("job.ran", ({ job, durationMs }) => {
  console.log(`${job} ran in ${durationMs}ms`);
});

app.events.on("job.failed", ({ job, error, durationMs }) => {
  console.error(`${job} failed after ${durationMs}ms:`, error);
});
```

`job.failed` fires alongside (not instead of) the `onError` option — use whichever fits: `onError` for handling a specific job's failure inline, the event for aggregate observability. `@nexo-alpha/tools`'s `createMetricsCollector(app)` subscribes to both events to build run/failure counts and average durations per job.

## Design notes

- **No wiring into `NexoApplication.start()`/`stop()`.** Same precedent as `@nexo-alpha/hapi`: creating and starting the scheduler is a separate, explicit step the caller takes alongside the application's own lifecycle.
- **The `clock` option** (`{ now(), setTimeout(), clearTimeout() }`) is the one seam for testability — real `Date`/timers by default. Not meant for production use, just what lets this package's own tests drive time deterministically instead of waiting on real minute boundaries.
- **No persistence.** Restarting the process loses all in-flight schedules and starts clean — consistent with how the rest of Nexo keeps declared state in code, not a database.

## Related packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — the application/module model, including `NexoJob` and `NexoJobRunner`

## Status

**v0.1-alpha.** No job mutators (`createJob`/`modifyJob` on `@nexo-alpha/tools`'s write interface), no distributed/multi-process coordination, no retry-on-crash persistence.

## License

MIT

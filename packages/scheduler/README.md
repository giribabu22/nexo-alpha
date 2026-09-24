# @nexo-alpha/scheduler

> Lightweight, dependency-free cron scheduler and job runner for the Nexo framework.

`@nexo-alpha/scheduler` turns declared `NexoJob` definitions from [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) into running background cron jobs. It features a hand-rolled, zero-dependency cron parser, non-crashing execution, and rich observability.

---

## Installation

```bash
npm install @nexo-alpha/scheduler @nexo-alpha/core
```

Or using pnpm:

```bash
pnpm add @nexo-alpha/scheduler @nexo-alpha/core
```

---

## How to Use

### 1. Declaring Background Jobs in a Module

Jobs are declared with a standard cron schedule expression and an async `run` function:

```ts
import { createApplication } from "@nexo-alpha/core";
import { startJobScheduler } from "@nexo-alpha/scheduler";

export const app = createApplication({ name: "notification-service" });

app.module({
  name: "notifications",
  purpose: "Deliver outbound notifications and emails",
  jobs: [
    {
      name: "sendDigestEmails",
      schedule: "0 8 * * 1-5", // 8:00 AM on weekdays
      run: async () => {
        console.log("Sending daily morning digest emails...");
      }
    },
    {
      name: "cleanStaleTokens",
      schedule: "*/15 * * * *", // Every 15 minutes
      run: async () => {
        console.log("Cleaning up expired session tokens...");
      }
    }
  ]
});

// Start scheduler
const scheduler = startJobScheduler(app);

// Stop scheduler when shutting down
process.on("SIGTERM", () => {
  scheduler.stop();
});
```

---

### 2. Manual Control with `createJobScheduler`

Use `createJobScheduler` if you want to initialize the scheduler before starting it:

```ts
import { createJobScheduler } from "@nexo-alpha/scheduler";

const scheduler = createJobScheduler(app, {
  onError: (jobName, error) => {
    console.error(`Job "${jobName}" encountered an error:`, error);
  }
});

// Starts all pending timers
scheduler.start();

// Stops all timers
scheduler.stop();
```

---

### 3. Observability via Events

The scheduler emits telemetry events over `app.events` (`NexoEventBus`):

```ts
// Fires every time a job completes successfully
app.events.on("job.ran", ({ job, durationMs }) => {
  console.log(`[Job Success] ${job} finished in ${durationMs}ms`);
});

// Fires when a job fails or throws an unhandled error
app.events.on("job.failed", ({ job, error, durationMs }) => {
  console.error(`[Job Error] ${job} failed after ${durationMs}ms:`, error);
});
```

A job failure never crashes the scheduler; the error is caught, logged/emitted, and the job is automatically rescheduled for its next run.

---

### 4. Direct Cron Utilities

If you need to parse cron expressions or compute the next run time independently:

```ts
import { parseCronExpression, getNextRunTime } from "@nexo-alpha/scheduler";

// Parse a standard 5-field cron string
const schedule = parseCronExpression("*/30 * * * *");

// Calculate next run timestamp from a specific date
const nextDate = getNextRunTime(schedule, new Date());
console.log("Next execution at:", nextDate.toISOString());
```

---

## Supported Cron Syntax

Standard 5-field cron expressions:
`┌───────────── minute (0 - 59)`
`│ ┌─────────── hour (0 - 23)`
`│ │ ┌───────── day of month (1 - 31)`
`│ │ │ ┌─────── month (1 - 12)`
`│ │ │ │ ┌───── day of week (0 - 7, 0 or 7 is Sunday)`
`* * * * *`

| Pattern | Example | Meaning |
|---|---|---|
| Wildcard | `* * * * *` | Every minute |
| Exact value | `0 0 1 * *` | Midnight on the 1st of every month |
| Step values | `*/15 * * * *` | Every 15 minutes |
| Ranges | `0 9 * * 1-5` | 9:00 AM Monday through Friday |
| Lists | `0 0,12 * * *` | Midnight and 12:00 PM every day |

---

## Related Packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — Defines the `NexoJob` interface and event bus.
- [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools) — Collects run counts, failure counts, and latency metrics for scheduled jobs.

---

## License

MIT © Nexo Contributors

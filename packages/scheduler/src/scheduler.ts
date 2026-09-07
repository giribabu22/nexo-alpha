import type { NexoApplication, NexoJob } from "@nexo-alpha/core";
import { getNextRunTime, parseCronExpression, type CronSchedule } from "./cron.js";

export interface JobSchedulerClock {
  now(): Date;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface JobSchedulerOptions {
  readonly onError?: (job: NexoJob, error: unknown) => void;
  readonly clock?: JobSchedulerClock;
}

export interface NexoJobScheduler {
  start(): void;
  stop(): void;
}

const realClock: JobSchedulerClock = {
  now: () => new Date(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

interface ScheduledJobEntry {
  readonly job: NexoJob;
  readonly schedule: CronSchedule;
}

export function createJobScheduler(
  app: NexoApplication,
  options: JobSchedulerOptions = {}
): NexoJobScheduler {
  const clock = options.clock ?? realClock;
  const onError = options.onError;

  let entries: ScheduledJobEntry[] = [];
  const timers = new Map<string, unknown>();
  let started = false;

  function scheduleNext(entry: ScheduledJobEntry): void {
    const now = clock.now();
    const next = getNextRunTime(entry.schedule, now);
    const delay = Math.max(0, next.getTime() - now.getTime());

    const handle = clock.setTimeout(() => {
      timers.delete(entry.job.name);
      runJob(entry);
    }, delay);

    timers.set(entry.job.name, handle);
  }

  function runJob(entry: ScheduledJobEntry): void {
    Promise.resolve()
      .then(() => entry.job.run?.())
      .catch((error: unknown) => {
        onError?.(entry.job, error);
      })
      .finally(() => {
        if (started) {
          scheduleNext(entry);
        }
      });
  }

  return {
    start() {
      if (started) {
        return;
      }

      entries = app
        .getJobs()
        .filter((job): job is NexoJob & { schedule: string; run: NonNullable<NexoJob["run"]> } =>
          job.schedule !== undefined && job.run !== undefined
        )
        .map((job) => ({ job, schedule: parseCronExpression(job.schedule) }));

      started = true;

      for (const entry of entries) {
        scheduleNext(entry);
      }
    },

    stop() {
      started = false;

      for (const handle of timers.values()) {
        clock.clearTimeout(handle);
      }

      timers.clear();
    }
  };
}

export function startJobScheduler(
  app: NexoApplication,
  options: JobSchedulerOptions = {}
): NexoJobScheduler {
  const scheduler = createJobScheduler(app, options);
  scheduler.start();
  return scheduler;
}

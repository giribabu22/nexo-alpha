/**
 * DSC integration for @nexo-alpha/scheduler
 *
 * Wraps createJobScheduler() to instrument every job execution through the
 * DSC pipeline, providing:
 *
 *  - Per-job execution latency tracking
 *  - Deduplication of overlapping ticks (if a job is still running when its
 *    next tick fires, the second tick is deduplicated instead of running twice)
 *  - Optional idempotent result caching for pure read-only jobs
 *  - DSC aggregate metrics visible alongside other packages
 *
 * Usage:
 *   import { createDscOrchestrator } from "@nexo-alpha/behavior";
 *   import { createDscJobScheduler, startDscJobScheduler } from "@nexo-alpha/scheduler";
 *
 *   const orchestrator = createDscOrchestrator();
 *   const scheduler = startDscJobScheduler(app, { orchestrator });
 */

import {
  createJobScheduler,
  type JobSchedulerOptions,
  type NexoJobScheduler,
  type JobSchedulerClock
} from "./scheduler.js";
import { NexoEvent, type NexoApplication, type NexoJob } from "@nexo-alpha/core";
import { getNextRunTime, parseCronExpression } from "./cron.js";

// ---------------------------------------------------------------------------
// Minimal interface mirror — avoids direct dep on @nexo-alpha/behavior
// ---------------------------------------------------------------------------

interface DscOrchestratorLike {
  run<TInput, TOutput>(
    operation: {
      name: string;
      idempotent?: boolean;
      ttlMs?: number;
      plan?(ctx: {
        operationId: string;
        operationName: string;
        input: TInput;
        metadata?: Record<string, unknown>;
        stageData: Record<string, unknown>;
      }): { cacheKey?: string } | Promise<{ cacheKey?: string }>;
      execute(ctx: {
        operationId: string;
        operationName: string;
        input: TInput;
        metadata?: Record<string, unknown>;
        stageData: Record<string, unknown>;
      }): Promise<TOutput>;
    },
    input: TInput,
    metadata?: Record<string, unknown>
  ): Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DscJobSchedulerOptions extends JobSchedulerOptions {
  /**
   * DscOrchestrator instance. When provided, every job run is wrapped in the
   * DSC pipeline for tracing and deduplication.
   */
  readonly orchestrator: DscOrchestratorLike;
  /**
   * Deduplicate concurrent ticks of the same job (default: true).
   *
   * When true, if job "foo" is still executing when its next scheduled tick
   * fires, the second invocation is dropped (deduplicated) rather than running
   * a second copy in parallel. This prevents thundering-herd issues.
   */
  readonly deduplicateOverlappingTicks?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const realClock: JobSchedulerClock = {
  now: () => new Date(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
};

/**
 * Creates a DSC-instrumented job scheduler.
 *
 * Each job run is wrapped in orchestrator.run() so:
 *  - Duration is recorded in the DscCollector
 *  - Overlapping ticks of the same job are deduplicated by default
 */
export function createDscJobScheduler(
  app: NexoApplication,
  options: DscJobSchedulerOptions
): NexoJobScheduler {
  const { orchestrator, deduplicateOverlappingTicks = true, ...baseOptions } = options;
  const clock = baseOptions.clock ?? realClock;
  const onError = baseOptions.onError;

  let entries: Array<{ job: NexoJob; schedule: ReturnType<typeof parseCronExpression> }> = [];
  const timers = new Map<string, unknown>();
  let started = false;

  // Track which jobs are currently in-flight for deduplication.
  const inFlight = new Set<string>();

  function scheduleNext(entry: { job: NexoJob; schedule: ReturnType<typeof parseCronExpression> }): void {
    const now = clock.now();
    const next = getNextRunTime(entry.schedule, now);
    const delay = Math.max(0, next.getTime() - now.getTime());

    const handle = clock.setTimeout(() => {
      timers.delete(entry.job.name);
      runJob(entry);
    }, delay);

    timers.set(entry.job.name, handle);
  }

  function runJob(entry: { job: NexoJob; schedule: ReturnType<typeof parseCronExpression> }): void {
    const jobName = entry.job.name;

    // Deduplication guard
    if (deduplicateOverlappingTicks && inFlight.has(jobName)) {
      // The previous tick is still running — skip this one.
      if (started) {
        scheduleNext(entry);
      }
      return;
    }

    inFlight.add(jobName);
    const startedAt = clock.now().getTime();

    orchestrator
      .run(
        {
          name: `job:${jobName}`,
          idempotent: false,
          plan(_ctx) {
            // Use job name as the in-flight deduplication key within orchestrator too.
            return { cacheKey: `job:inflight:${jobName}` };
          },
          async execute(_ctx) {
            await entry.job.run?.();
          }
        },
        { jobName }
      )
      .then(() => {
        app.events.emit(NexoEvent.JOB_RAN, {
          job: jobName,
          durationMs: clock.now().getTime() - startedAt
        });
      })
      .catch((error: unknown) => {
        app.events.emit(NexoEvent.JOB_FAILED, {
          job: jobName,
          durationMs: clock.now().getTime() - startedAt,
          error: error instanceof Error ? error.message : String(error)
        });
        onError?.(entry.job, error);
      })
      .finally(() => {
        inFlight.delete(jobName);
        if (started) {
          scheduleNext(entry);
        }
      });
  }

  return {
    start() {
      if (started) return;

      entries = app
        .getJobs()
        .filter(
          (job): job is NexoJob & { schedule: string; run: NonNullable<NexoJob["run"]> } =>
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

/**
 * Creates AND immediately starts a DSC-instrumented job scheduler.
 * Mirrors the ergonomics of startJobScheduler() from scheduler.ts.
 */
export function startDscJobScheduler(
  app: NexoApplication,
  options: DscJobSchedulerOptions
): NexoJobScheduler {
  const scheduler = createDscJobScheduler(app, options);
  scheduler.start();

  if (options.bindLifecycle !== false) {
    app.events.on(NexoEvent.APPLICATION_STOPPING, () => {
      scheduler.stop();
    });
  }

  return scheduler;
}

/**
 * Persistent background job queue.
 *
 * Jobs are stored in a `@nexo-alpha/core` {@link NexoDocumentStore}
 * (in-memory, JSON file or SQLite), so queued work survives restarts:
 *
 * ```ts
 * const queue = createJobQueue({ store: await createSqliteDocumentStore("data/nexo.sqlite") });
 * queue.define("send-email", async (payload) => mailer.send(payload));
 * await queue.start();
 * await queue.enqueue("send-email", { to: "a@example.com" }, { maxAttempts: 5 });
 * ```
 *
 * Semantics:
 * - Several workers (processes) can share one store: a job is claimed with an
 *   atomic compare-and-swap, so only one worker runs it. With SQLite this
 *   holds across processes; the in-memory and file stores are single-process.
 * - A running job holds a lease (`leaseMs`) that its worker renews while the
 *   handler runs. If the worker dies, any worker re-queues the job once the
 *   lease expires — or immediately on restart when the worker keeps a stable
 *   `workerId` (e.g. the pod name).
 * - At-least-once: a job can run again after a crash or an expired lease, so
 *   handlers should be idempotent.
 * - Failed attempts are retried with backoff until `maxAttempts` is reached.
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { currentProjectId, runInProject, type NexoDocumentStore } from "@nexo-alpha/core";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobRecord<P = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: P;
  readonly status: JobStatus;
  /** Attempts started so far (including the current one while running). */
  readonly attempts: number;
  readonly maxAttempts: number;
  /** ISO-8601 time the job becomes eligible to run. */
  readonly runAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  /** Handler return value (completed jobs; must be JSON-serializable to be kept). */
  readonly result?: unknown;
  /** Message of the latest failure. */
  readonly error?: string;
  /** Worker that ran (or is running) the job. */
  readonly workerId?: string;
  /** ISO-8601; while running, the job belongs to `workerId` until this time. */
  readonly leaseExpiresAt?: string;
  /** Project the job was enqueued in; the handler runs inside it (see runInProject). */
  readonly projectId?: string;
}

export interface JobContext {
  readonly jobId: string;
  /** 1-based attempt number. */
  readonly attempt: number;
}

export type JobHandler<P = unknown> = (payload: P, context: JobContext) => unknown | Promise<unknown>;

export interface EnqueueOptions {
  /** Explicit job ID. Enqueueing an ID that already exists throws. */
  readonly id?: string;
  /** Earliest run time. */
  readonly runAt?: Date;
  /** Delay from now, in milliseconds (ignored when `runAt` is set). */
  readonly delayMs?: number;
  /** Overrides the queue's default `maxAttempts`. */
  readonly maxAttempts?: number;
}

export interface JobFilter {
  readonly status?: JobStatus;
  readonly type?: string;
}

export type JobQueueEvent =
  | { readonly type: "job.enqueued"; readonly job: JobRecord }
  | { readonly type: "job.started"; readonly job: JobRecord }
  | { readonly type: "job.completed"; readonly job: JobRecord }
  | { readonly type: "job.retrying"; readonly job: JobRecord }
  | { readonly type: "job.failed"; readonly job: JobRecord }
  | { readonly type: "job.cancelled"; readonly job: JobRecord }
  | { readonly type: "job.recovered"; readonly job: JobRecord };

export interface JobQueueOptions {
  /**
   * Where jobs are stored. Pass an unscoped store: the queue is shared by all
   * projects and runs each job inside the project it was enqueued in.
   */
  readonly store: NexoDocumentStore;
  /** Collection holding job records. Default: "nexo_jobs" */
  readonly collection?: string;
  /** Maximum jobs running at once. Default: 1 */
  readonly concurrency?: number;
  /** How often to look for due jobs, in ms. Default: 1000 */
  readonly pollIntervalMs?: number;
  /** Default attempts per job. Default: 3 */
  readonly maxAttempts?: number;
  /** Delay before retry number `attempt` (1-based count of failed attempts). Default: 1s doubling, capped at 60s */
  readonly backoffMs?: (attempt: number) => number;
  /** Clock override for due-time checks. */
  readonly now?: () => Date;
  /** Receives queue lifecycle events. Listener errors are ignored. */
  readonly onEvent?: (event: JobQueueEvent) => void;
  /**
   * Identifies this worker. Keep it stable across restarts (e.g. a pod name)
   * so the worker re-queues its own interrupted jobs as soon as it starts.
   * Default: "<hostname>:<pid>:<random>".
   */
  readonly workerId?: string;
  /** How long a running job stays owned without a lease renewal, in ms. Default: 300000 */
  readonly leaseMs?: number;
}

export interface NexoJobQueue {
  /** Registers the handler for a job type. Throws if the type already has one. */
  define<P = unknown>(type: string, handler: JobHandler<P>): this;
  /** Persists a new queued job and returns it. */
  enqueue<P = unknown>(type: string, payload: P, options?: EnqueueOptions): Promise<JobRecord<P>>;
  get<P = unknown>(id: string): Promise<JobRecord<P> | undefined>;
  list(filter?: JobFilter): Promise<JobRecord[]>;
  /** Cancels a queued job. Returns false if it is not queued (running jobs are not interrupted). */
  cancel(id: string): Promise<boolean>;
  /** Re-queues this worker's interrupted jobs (and any with an expired lease), then starts processing. */
  start(): Promise<void>;
  /** Stops taking new jobs and waits for running ones to finish. */
  stop(): Promise<void>;
  /** Resolves once no job is running and no due, handled job is queued. */
  whenIdle(): Promise<void>;
}

const defaultBackoff = (attempt: number): number => Math.min(1000 * 2 ** (attempt - 1), 60_000);

export function createJobQueue(options: JobQueueOptions): NexoJobQueue {
  const store = options.store;
  const collection = options.collection ?? "nexo_jobs";
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const defaultMaxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? defaultBackoff;
  const now = options.now ?? (() => new Date());
  const workerId = options.workerId ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const leaseMs = Math.max(1000, options.leaseMs ?? 300_000);

  const handlers = new Map<string, JobHandler>();
  const running = new Map<string, Promise<void>>();
  let started = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let ticking: Promise<void> | undefined;
  let tickRequested = false;
  let idleWaiters: (() => void)[] = [];

  function emit(event: JobQueueEvent): void {
    try {
      options.onEvent?.(event);
    } catch {
      // Listener failures must not affect job processing.
    }
  }

  function timestamp(): string {
    return now().toISOString();
  }

  async function save(job: JobRecord): Promise<JobRecord> {
    await store.put(collection, job.id, job);
    return job;
  }

  /** Atomically replaces `current` with `next`; undefined if another worker changed it first. */
  async function transition(current: JobRecord, next: JobRecord): Promise<JobRecord | undefined> {
    return (await store.replaceIf(collection, current.id, current, next)) ? next : undefined;
  }

  function leaseUntil(): string {
    return new Date(now().getTime() + leaseMs).toISOString();
  }

  /** The record without lease ownership (for queued/finished states). */
  function released(job: JobRecord): JobRecord {
    const { leaseExpiresAt: _lease, ...rest } = job;
    return rest;
  }

  /** Re-queues running jobs whose lease expired (or that belong to this worker, on start). */
  async function recover(jobs: readonly JobRecord[], includeOwn: boolean): Promise<void> {
    const current = timestamp();
    for (const job of jobs) {
      if (job.status !== "running" || running.has(job.id)) continue;
      const expired = job.leaseExpiresAt === undefined || job.leaseExpiresAt <= current;
      const own = includeOwn && job.workerId === workerId;
      if (!expired && !own) continue;
      const recovered = await transition(job, {
        ...released(job),
        status: "queued",
        error: own
          ? "Interrupted: the worker restarted while this job was running."
          : "Lease expired: the worker running this job stopped responding.",
        updatedAt: timestamp()
      });
      if (recovered !== undefined) emit({ type: "job.recovered", job: recovered });
    }
  }

  function due(jobs: readonly JobRecord[]): JobRecord[] {
    const current = now().toISOString();
    return jobs
      .filter((job) => job.status === "queued" && job.runAt <= current && handlers.has(job.type) && !running.has(job.id))
      .sort((a, b) => a.runAt.localeCompare(b.runAt) || a.createdAt.localeCompare(b.createdAt));
  }

  async function dueJobs(): Promise<JobRecord[]> {
    return due(await store.list<JobRecord>(collection));
  }

  async function settleIdle(): Promise<void> {
    if (idleWaiters.length === 0 || running.size > 0) return;
    if ((await dueJobs()).length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function runJob(claimed: JobRecord): Promise<void> {
    const handler = handlers.get(claimed.type) as JobHandler;
    let current: JobRecord | undefined = claimed;

    // Lease renewals and the final outcome are applied one at a time, each as a
    // compare-and-swap against the last record this worker wrote. Once a swap
    // fails, another worker owns the job and this worker stops writing.
    let updates: Promise<unknown> = Promise.resolve();
    const update = (build: (record: JobRecord) => JobRecord): Promise<JobRecord | undefined> => {
      const result = updates.then(async () => {
        if (current === undefined) return undefined;
        current = await transition(current, build(current));
        return current;
      });
      updates = result.catch(() => undefined);
      return result;
    };

    const heartbeat = setInterval(() => {
      void update((record) => ({ ...record, leaseExpiresAt: leaseUntil(), updatedAt: timestamp() })).catch(() => undefined);
    }, Math.max(250, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();

    try {
      const invoke = () => handler(claimed.payload, { jobId: claimed.id, attempt: claimed.attempts });
      const result = await (claimed.projectId !== undefined ? runInProject(claimed.projectId, invoke) : invoke());
      let storedResult: unknown;
      try {
        storedResult = result === undefined ? undefined : JSON.parse(JSON.stringify(result));
      } catch {
        storedResult = undefined;
      }
      clearInterval(heartbeat);
      const finished = await update((record) => {
        const { error: _previousError, ...rest } = released(record);
        return {
          ...rest,
          status: "completed",
          finishedAt: timestamp(),
          updatedAt: timestamp(),
          ...(storedResult !== undefined ? { result: storedResult } : {})
        };
      });
      if (finished !== undefined) emit({ type: "job.completed", job: finished });
    } catch (error) {
      clearInterval(heartbeat);
      const message = error instanceof Error ? error.message : String(error);
      if (claimed.attempts < claimed.maxAttempts) {
        const retrying = await update((record) => ({
          ...released(record),
          status: "queued",
          error: message,
          runAt: new Date(now().getTime() + backoffMs(claimed.attempts)).toISOString(),
          updatedAt: timestamp()
        }));
        if (retrying !== undefined) emit({ type: "job.retrying", job: retrying });
      } else {
        const failed = await update((record) => ({
          ...released(record),
          status: "failed",
          error: message,
          finishedAt: timestamp(),
          updatedAt: timestamp()
        }));
        if (failed !== undefined) emit({ type: "job.failed", job: failed });
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function tickOnce(): Promise<void> {
    const jobs = await store.list<JobRecord>(collection);
    await recover(jobs, false);
    const available = concurrency - running.size;
    if (available > 0) {
      let claimedCount = 0;
      for (const job of due(await store.list<JobRecord>(collection))) {
        if (claimedCount >= available) break;
        // Atomic claim: if another worker claimed the job first, skip it.
        const claimed = await transition(job, {
          ...job,
          status: "running",
          attempts: job.attempts + 1,
          workerId,
          leaseExpiresAt: leaseUntil(),
          startedAt: timestamp(),
          updatedAt: timestamp()
        });
        if (claimed === undefined) continue;
        claimedCount += 1;
        emit({ type: "job.started", job: claimed });

        const done = runJob(claimed)
          .catch(() => undefined) // store failures while recording the outcome: the lease expires and the job is recovered
          .finally(() => {
            running.delete(claimed.id);
            tick();
          });
        running.set(claimed.id, done);
      }
    }
    await settleIdle();
  }

  /** Runs one tick at a time; a tick requested mid-tick runs right after. */
  function tick(): void {
    if (!started) return;
    if (ticking !== undefined) {
      tickRequested = true;
      return;
    }
    ticking = tickOnce()
      .catch(() => undefined)
      .finally(() => {
        ticking = undefined;
        if (tickRequested) {
          tickRequested = false;
          tick();
        }
      });
  }

  function schedulePoll(): void {
    if (!started) return;
    pollTimer = setTimeout(() => {
      tick();
      schedulePoll();
    }, pollIntervalMs);
    pollTimer.unref?.();
  }

  const queue: NexoJobQueue = {
    define(type, handler) {
      if (handlers.has(type)) {
        throw new Error(`[JobQueue] A handler for job type "${type}" is already defined.`);
      }
      handlers.set(type, handler as JobHandler);
      tick();
      return queue;
    },

    async enqueue(type, payload, enqueueOptions = {}) {
      const id = enqueueOptions.id ?? randomUUID();
      if ((await store.get(collection, id)) !== undefined) {
        throw new Error(`[JobQueue] Job "${id}" already exists.`);
      }
      const created = timestamp();
      const runAt = enqueueOptions.runAt ?? new Date(now().getTime() + (enqueueOptions.delayMs ?? 0));
      const job = await save({
        id,
        type,
        payload,
        status: "queued",
        attempts: 0,
        maxAttempts: Math.max(1, enqueueOptions.maxAttempts ?? defaultMaxAttempts),
        ...(currentProjectId() !== undefined ? { projectId: currentProjectId() as string } : {}),
        runAt: runAt.toISOString(),
        createdAt: created,
        updatedAt: created
      });
      emit({ type: "job.enqueued", job });
      tick();
      return job as JobRecord<typeof payload>;
    },

    get(id) {
      return store.get(collection, id);
    },

    async list(filter = {}) {
      return (await store.list<JobRecord>(collection)).filter(
        (job) => (filter.status === undefined || job.status === filter.status) && (filter.type === undefined || job.type === filter.type)
      );
    },

    async cancel(id) {
      const job = await store.get<JobRecord>(collection, id);
      if (job === undefined || job.status !== "queued") return false;
      // Compare-and-swap so a job claimed concurrently by a worker is not "cancelled" while it runs.
      const cancelled = await transition(job, { ...job, status: "cancelled", finishedAt: timestamp(), updatedAt: timestamp() });
      if (cancelled === undefined) return false;
      emit({ type: "job.cancelled", job: cancelled });
      return true;
    },

    async start() {
      if (started) return;
      await recover(await store.list<JobRecord>(collection), true);
      started = true;
      tick();
      schedulePoll();
    },

    async stop() {
      started = false;
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      await ticking;
      await Promise.all(running.values());
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    },

    whenIdle() {
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        if (!started) {
          // Nothing will make progress; resolve once nothing is in flight.
          void Promise.all(running.values()).then(() => {
            idleWaiters = idleWaiters.filter((waiter) => waiter !== resolve);
            resolve();
          });
          return;
        }
        tick();
      });
    }
  };

  return queue;
}

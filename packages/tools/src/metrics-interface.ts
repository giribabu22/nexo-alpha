import {
  NexoEvent,
  NexoHttpError,
  currentProjectId,
  httpResponse,
  type ApiCalledEvent,
  type ApiErrorEvent,
  type JobFailedEvent,
  type JobRanEvent,
  type NexoApiAuth,
  type NexoApplication,
  type NexoModule
} from "@nexo-alpha/core";

export interface ApiMetrics {
  readonly calls: number;
  readonly errors: number;
  readonly averageDurationMs: number;
}

export interface JobMetrics {
  readonly runs: number;
  readonly failures: number;
  readonly averageDurationMs: number;
}

/** Per-workflow counters, fed by {@link NexoMetricsCollector.workflowListener}. */
export interface WorkflowMetrics {
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  /** Times a run paused (WAITING or ESCALATED). */
  readonly paused: number;
  readonly stepsCompleted: number;
  readonly stepsFailed: number;
  /** Mean wall-clock time of runs that finished (completed, failed or cancelled). */
  readonly averageDurationMs: number;
}

/** Per-job-type counters, fed by {@link NexoMetricsCollector.queueListener}. */
export interface QueueMetrics {
  readonly enqueued: number;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
  /** Mean duration of completed jobs' final attempt. */
  readonly averageDurationMs: number;
}

export interface NexoMetricsSnapshot {
  readonly apis: Readonly<Record<string, ApiMetrics>>;
  readonly jobs: Readonly<Record<string, JobMetrics>>;
  readonly workflows: Readonly<Record<string, WorkflowMetrics>>;
  readonly queues: Readonly<Record<string, QueueMetrics>>;
}

/** The workflow event fields the collector reads (matches `@nexo-alpha/agent`'s WorkflowEvent). */
export interface WorkflowEventLike {
  readonly type: string;
  readonly workflowName: string;
  readonly durationMs?: number;
}

/** The job queue event fields the collector reads (matches `@nexo-alpha/scheduler`'s JobQueueEvent). */
export interface JobQueueEventLike {
  readonly type: string;
  readonly job: { readonly type: string; readonly startedAt?: string; readonly finishedAt?: string; readonly projectId?: string };
}

export interface MetricsFilter {
  /** Only this project's share (events that happened inside it). */
  readonly projectId?: string | undefined;
}

export interface NexoMetricsCollector {
  /** Platform totals, or one project's share with `{ projectId }`. */
  getMetrics(filter?: MetricsFilter): NexoMetricsSnapshot;
  /** Projects that have recorded at least one event. */
  projectIds(): string[];
  /** Pass as `createWorkflow({ onEvent })` to record workflow metrics. */
  readonly workflowListener: (event: WorkflowEventLike) => void;
  /** Pass as `createJobQueue({ onEvent })` to record job queue metrics. */
  readonly queueListener: (event: JobQueueEventLike) => void;
  /** The current snapshot in Prometheus text exposition format (version 0.0.4). */
  toPrometheus(filter?: MetricsFilter): string;
  reset(): void;
  stop(): void;
}

interface MutableCounters {
  calls: number;
  errors: number;
  totalDurationMs: number;
}

interface Rate {
  readonly calls: number;
  readonly errors: number;
  readonly averageDurationMs: number;
}

function toRate(counters: MutableCounters): Rate {
  return {
    calls: counters.calls,
    errors: counters.errors,
    averageDurationMs: counters.calls === 0 ? 0 : counters.totalDurationMs / counters.calls
  };
}

interface MutableWorkflowCounters {
  started: number;
  completed: number;
  failed: number;
  cancelled: number;
  paused: number;
  stepsCompleted: number;
  stepsFailed: number;
  finishedDurationMs: number;
}

interface MutableQueueCounters {
  enqueued: number;
  completed: number;
  failed: number;
  retried: number;
  completedDurationMs: number;
}

function newWorkflowCounters(): MutableWorkflowCounters {
  return { started: 0, completed: 0, failed: 0, cancelled: 0, paused: 0, stepsCompleted: 0, stepsFailed: 0, finishedDurationMs: 0 };
}

function newQueueCounters(): MutableQueueCounters {
  return { enqueued: 0, completed: 0, failed: 0, retried: 0, completedDurationMs: 0 };
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

/**
 * Renders a snapshot in Prometheus text format. Durations are exposed as
 * averages in seconds (gauges); counts as counters.
 */
export function formatPrometheusMetrics(snapshot: NexoMetricsSnapshot): string {
  const lines: string[] = [];

  function family<T>(
    name: string,
    type: "counter" | "gauge",
    help: string,
    label: string,
    entries: Readonly<Record<string, T>>,
    value: (entry: T) => number
  ): void {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [key, entry] of Object.entries(entries)) {
      lines.push(`${name}{${label}="${escapeLabel(key)}"} ${value(entry)}`);
    }
  }

  const { apis, jobs, workflows, queues } = snapshot;
  family("nexo_api_calls_total", "counter", "API calls handled.", "api", apis, (m) => m.calls);
  family("nexo_api_errors_total", "counter", "API calls that errored or returned >= 400.", "api", apis, (m) => m.errors);
  family("nexo_api_duration_seconds_avg", "gauge", "Mean API call duration.", "api", apis, (m) => m.averageDurationMs / 1000);
  family("nexo_cron_job_runs_total", "counter", "Scheduled job runs.", "job", jobs, (m) => m.runs);
  family("nexo_cron_job_failures_total", "counter", "Scheduled job failures.", "job", jobs, (m) => m.failures);
  family("nexo_workflow_runs_started_total", "counter", "Workflow runs started.", "workflow", workflows, (m) => m.started);
  family("nexo_workflow_runs_completed_total", "counter", "Workflow runs completed.", "workflow", workflows, (m) => m.completed);
  family("nexo_workflow_runs_failed_total", "counter", "Workflow runs failed.", "workflow", workflows, (m) => m.failed);
  family("nexo_workflow_runs_cancelled_total", "counter", "Workflow runs cancelled.", "workflow", workflows, (m) => m.cancelled);
  family("nexo_workflow_runs_paused_total", "counter", "Workflow runs paused for a human.", "workflow", workflows, (m) => m.paused);
  family("nexo_workflow_steps_completed_total", "counter", "Workflow steps completed.", "workflow", workflows, (m) => m.stepsCompleted);
  family("nexo_workflow_steps_failed_total", "counter", "Workflow steps failed.", "workflow", workflows, (m) => m.stepsFailed);
  family("nexo_workflow_run_duration_seconds_avg", "gauge", "Mean duration of finished workflow runs.", "workflow", workflows, (m) => m.averageDurationMs / 1000);
  family("nexo_queue_jobs_enqueued_total", "counter", "Queue jobs enqueued.", "type", queues, (m) => m.enqueued);
  family("nexo_queue_jobs_completed_total", "counter", "Queue jobs completed.", "type", queues, (m) => m.completed);
  family("nexo_queue_jobs_failed_total", "counter", "Queue jobs failed after all attempts.", "type", queues, (m) => m.failed);
  family("nexo_queue_jobs_retried_total", "counter", "Queue job attempts that failed and were retried.", "type", queues, (m) => m.retried);
  family("nexo_queue_job_duration_seconds_avg", "gauge", "Mean duration of completed queue jobs.", "type", queues, (m) => m.averageDurationMs / 1000);

  return `${lines.join("\n")}\n`;
}

/** One set of counters: the platform totals, or one project's share. */
interface CounterSet {
  readonly apis: Map<string, MutableCounters>;
  readonly jobs: Map<string, MutableCounters>;
  readonly workflows: Map<string, MutableWorkflowCounters>;
  readonly queues: Map<string, MutableQueueCounters>;
}

function newCounterSet(): CounterSet {
  return { apis: new Map(), jobs: new Map(), workflows: new Map(), queues: new Map() };
}

function entry<T>(map: Map<string, T>, key: string, create: () => T): T {
  let counters = map.get(key);
  if (counters === undefined) {
    counters = create();
    map.set(key, counters);
  }
  return counters;
}

const newApiCounters = (): MutableCounters => ({ calls: 0, errors: 0, totalDurationMs: 0 });

function snapshotOf(set: CounterSet): NexoMetricsSnapshot {
  const apiEntries: Record<string, ApiMetrics> = {};
  for (const [name, counters] of set.apis) {
    apiEntries[name] = toRate(counters);
  }

  const jobEntries: Record<string, JobMetrics> = {};
  for (const [name, counters] of set.jobs) {
    const rate = toRate(counters);
    jobEntries[name] = { runs: rate.calls, failures: rate.errors, averageDurationMs: rate.averageDurationMs };
  }

  const workflowEntries: Record<string, WorkflowMetrics> = {};
  for (const [name, c] of set.workflows) {
    const finished = c.completed + c.failed + c.cancelled;
    workflowEntries[name] = {
      started: c.started,
      completed: c.completed,
      failed: c.failed,
      cancelled: c.cancelled,
      paused: c.paused,
      stepsCompleted: c.stepsCompleted,
      stepsFailed: c.stepsFailed,
      averageDurationMs: finished === 0 ? 0 : c.finishedDurationMs / finished
    };
  }

  const queueEntries: Record<string, QueueMetrics> = {};
  for (const [type, c] of set.queues) {
    queueEntries[type] = {
      enqueued: c.enqueued,
      completed: c.completed,
      failed: c.failed,
      retried: c.retried,
      averageDurationMs: c.completed === 0 ? 0 : c.completedDurationMs / c.completed
    };
  }

  return { apis: apiEntries, jobs: jobEntries, workflows: workflowEntries, queues: queueEntries };
}

/**
 * Collects metrics for APIs and cron jobs (from `app.events`), workflows
 * (`workflowListener`) and job queues (`queueListener`).
 *
 * Every event counts towards the platform totals. Events that happen inside
 * a project (see `runInProject` in `@nexo-alpha/core`) — or queue jobs that
 * belong to one — also count towards that project, readable with
 * `getMetrics({ projectId })`.
 */
export function createMetricsCollector(app: NexoApplication): NexoMetricsCollector {
  let platform = newCounterSet();
  let projects = new Map<string, CounterSet>();

  /** The counter sets an event updates: the platform totals, plus its project's. */
  function targets(projectId: string | undefined): CounterSet[] {
    return projectId === undefined ? [platform] : [platform, entry(projects, projectId, newCounterSet)];
  }

  const workflowListener = (event: WorkflowEventLike): void => {
    const duration = event.durationMs ?? 0;
    for (const set of targets(currentProjectId())) {
      const counters = entry(set.workflows, event.workflowName, newWorkflowCounters);
      switch (event.type) {
        case "workflow.started": counters.started += 1; break;
        case "workflow.completed": counters.completed += 1; counters.finishedDurationMs += duration; break;
        case "workflow.failed": counters.failed += 1; counters.finishedDurationMs += duration; break;
        case "workflow.cancelled": counters.cancelled += 1; counters.finishedDurationMs += duration; break;
        case "workflow.paused": counters.paused += 1; break;
        case "step.completed": counters.stepsCompleted += 1; break;
        case "step.failed": counters.stepsFailed += 1; break;
        default: break;
      }
    }
  };

  const queueListener = (event: JobQueueEventLike): void => {
    const { startedAt, finishedAt } = event.job;
    for (const set of targets(event.job.projectId ?? currentProjectId())) {
      const counters = entry(set.queues, event.job.type, newQueueCounters);
      switch (event.type) {
        case "job.enqueued": counters.enqueued += 1; break;
        case "job.retrying": counters.retried += 1; break;
        case "job.failed": counters.failed += 1; break;
        case "job.completed":
          counters.completed += 1;
          if (startedAt !== undefined && finishedAt !== undefined) {
            counters.completedDurationMs += Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
          }
          break;
        default: break;
      }
    }
  };

  const onApiCalled = (event: ApiCalledEvent): void => {
    for (const set of targets(currentProjectId())) {
      const counters = entry(set.apis, event.api, newApiCounters);
      counters.calls += 1;
      counters.totalDurationMs += event.durationMs;
      if (event.statusCode >= 400) counters.errors += 1;
    }
  };

  const onApiError = (event: ApiErrorEvent): void => {
    for (const set of targets(currentProjectId())) {
      entry(set.apis, event.api, newApiCounters).errors += 1;
    }
  };

  // Cron jobs are platform-level: they don't belong to a project.
  const onJobRan = (event: JobRanEvent): void => {
    const counters = entry(platform.jobs, event.job, newApiCounters);
    counters.calls += 1;
    counters.totalDurationMs += event.durationMs;
  };

  const onJobFailed = (event: JobFailedEvent): void => {
    entry(platform.jobs, event.job, newApiCounters).errors += 1;
  };

  app.events.on(NexoEvent.API_CALLED, onApiCalled as (...args: unknown[]) => void);
  app.events.on(NexoEvent.API_ERROR, onApiError as (...args: unknown[]) => void);
  app.events.on(NexoEvent.JOB_RAN, onJobRan as (...args: unknown[]) => void);
  app.events.on(NexoEvent.JOB_FAILED, onJobFailed as (...args: unknown[]) => void);

  const collector: NexoMetricsCollector = {
    getMetrics(filter = {}) {
      if (filter.projectId === undefined) return snapshotOf(platform);
      return snapshotOf(projects.get(filter.projectId) ?? newCounterSet());
    },

    projectIds() {
      return [...projects.keys()];
    },

    workflowListener,
    queueListener,

    toPrometheus(filter = {}) {
      return formatPrometheusMetrics(collector.getMetrics(filter));
    },

    reset() {
      platform = newCounterSet();
      projects = new Map();
    },

    stop() {
      app.events.off(NexoEvent.API_CALLED, onApiCalled as (...args: unknown[]) => void);
      app.events.off(NexoEvent.API_ERROR, onApiError as (...args: unknown[]) => void);
      app.events.off(NexoEvent.JOB_RAN, onJobRan as (...args: unknown[]) => void);
      app.events.off(NexoEvent.JOB_FAILED, onJobFailed as (...args: unknown[]) => void);
    }
  };

  return collector;
}

export interface MetricsApiModuleOptions {
  /** JSON snapshot route. Default: "/metrics" */
  readonly path?: string;
  /** Prometheus text route; `false` disables it. Default: "<path>/prometheus" */
  readonly prometheusPath?: string | false;
  /** Auth requirement for both routes. */
  readonly auth?: NexoApiAuth;
  /**
   * "platform" (default): totals across all projects — for operators.
   * "project": only the current request's project (see `runInProject`), so
   * tenants can be given their own metrics; outside a project it answers 400.
   */
  readonly scope?: "platform" | "project";
  /** Module name. Default: "metrics" */
  readonly name?: string;
}

/** Content type of the Prometheus text exposition format. */
export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/**
 * A module exposing the collector over HTTP:
 * - `GET /metrics` — JSON snapshot, for dashboards such as
 *   `@nexo-alpha/frontend`'s `NexoMetricsDashboard`.
 * - `GET /metrics/prometheus` — Prometheus text format, for scraping.
 */
export function createMetricsApiModule(collector: NexoMetricsCollector, options: MetricsApiModuleOptions = {}): NexoModule {
  const path = options.path ?? "/metrics";
  const prometheusPath = options.prometheusPath ?? `${path.replace(/\/+$/, "")}/prometheus`;
  const auth = options.auth !== undefined ? { auth: options.auth } : {};
  const filter = (): MetricsFilter => {
    if (options.scope !== "project") return {};
    const projectId = currentProjectId();
    if (projectId === undefined) throw new NexoHttpError(400, "PROJECT_REQUIRED", "Project metrics need a project.");
    return { projectId };
  };

  return {
    name: options.name ?? "metrics",
    description: "Runtime metrics snapshot (APIs, cron jobs, workflows, queues).",
    apis: [
      {
        name: options.scope === "project" ? "getProjectMetrics" : "getMetrics",
        method: "GET",
        path,
        description: "Current metrics snapshot.",
        ...auth,
        handler: () => collector.getMetrics(filter())
      },
      ...(prometheusPath === false
        ? []
        : [{
          name: options.scope === "project" ? "getProjectPrometheusMetrics" : "getPrometheusMetrics",
          method: "GET" as const,
          path: prometheusPath,
          description: "Current metrics in Prometheus text exposition format.",
          ...auth,
          handler: () => httpResponse(200, collector.toPrometheus(filter()), { "content-type": PROMETHEUS_CONTENT_TYPE })
        }])
    ]
  };
}

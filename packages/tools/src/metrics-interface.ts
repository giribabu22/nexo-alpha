import {
  NexoEvent,
  type ApiCalledEvent,
  type ApiErrorEvent,
  type JobFailedEvent,
  type JobRanEvent,
  type NexoApplication
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

export interface NexoMetricsSnapshot {
  readonly apis: Readonly<Record<string, ApiMetrics>>;
  readonly jobs: Readonly<Record<string, JobMetrics>>;
}

export interface NexoMetricsCollector {
  getMetrics(): NexoMetricsSnapshot;
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

export function createMetricsCollector(app: NexoApplication): NexoMetricsCollector {
  let apis = new Map<string, MutableCounters>();
  let jobs = new Map<string, MutableCounters>();

  function bucket(map: Map<string, MutableCounters>, key: string): MutableCounters {
    let counters = map.get(key);
    if (!counters) {
      counters = { calls: 0, errors: 0, totalDurationMs: 0 };
      map.set(key, counters);
    }
    return counters;
  }

  const onApiCalled = (event: ApiCalledEvent): void => {
    const counters = bucket(apis, event.api);
    counters.calls += 1;
    counters.totalDurationMs += event.durationMs;
    if (event.statusCode >= 400) {
      counters.errors += 1;
    }
  };

  const onApiError = (event: ApiErrorEvent): void => {
    bucket(apis, event.api).errors += 1;
  };

  const onJobRan = (event: JobRanEvent): void => {
    const counters = bucket(jobs, event.job);
    counters.calls += 1;
    counters.totalDurationMs += event.durationMs;
  };

  const onJobFailed = (event: JobFailedEvent): void => {
    const counters = bucket(jobs, event.job);
    counters.errors += 1;
  };

  app.events.on(NexoEvent.API_CALLED, onApiCalled as (...args: unknown[]) => void);
  app.events.on(NexoEvent.API_ERROR, onApiError as (...args: unknown[]) => void);
  app.events.on(NexoEvent.JOB_RAN, onJobRan as (...args: unknown[]) => void);
  app.events.on(NexoEvent.JOB_FAILED, onJobFailed as (...args: unknown[]) => void);

  return {
    getMetrics() {
      const apiEntries: Record<string, ApiMetrics> = {};
      for (const [name, counters] of apis) {
        apiEntries[name] = toRate(counters);
      }

      const jobEntries: Record<string, JobMetrics> = {};
      for (const [name, counters] of jobs) {
        const rate = toRate(counters);
        jobEntries[name] = {
          runs: rate.calls,
          failures: rate.errors,
          averageDurationMs: rate.averageDurationMs
        };
      }

      return { apis: apiEntries, jobs: jobEntries };
    },

    reset() {
      apis = new Map();
      jobs = new Map();
    },

    stop() {
      app.events.off(NexoEvent.API_CALLED, onApiCalled as (...args: unknown[]) => void);
      app.events.off(NexoEvent.API_ERROR, onApiError as (...args: unknown[]) => void);
      app.events.off(NexoEvent.JOB_RAN, onJobRan as (...args: unknown[]) => void);
      app.events.off(NexoEvent.JOB_FAILED, onJobFailed as (...args: unknown[]) => void);
    }
  };
}

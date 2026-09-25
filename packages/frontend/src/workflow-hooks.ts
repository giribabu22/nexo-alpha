import { useCallback, useEffect, useRef, useState } from "react";
import { useNexoClient } from "./context.js";
import type { StartRunRequest, WorkflowRun, WorkflowRunStatus } from "./workflows.js";

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

// ---------------------------------------------------------------------------
// useWorkflowRuns
// ---------------------------------------------------------------------------

export interface UseWorkflowRunsOptions {
  readonly status?: WorkflowRunStatus | undefined;
  /** Re-fetch interval in ms. Default: no polling */
  readonly pollInterval?: number | undefined;
  readonly enabled?: boolean | undefined;
}

export interface UseWorkflowRunsResult {
  readonly runs: readonly WorkflowRun[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

/** Saved runs of one workflow, optionally filtered by status and polled. */
export function useWorkflowRuns(workflow: string, options: UseWorkflowRunsOptions = {}): UseWorkflowRunsResult {
  const client = useNexoClient();
  const [runs, setRuns] = useState<readonly WorkflowRun[]>([]);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const status = options.status;

  const refetch = useCallback(async () => {
    try {
      const data = await client.workflows.listRuns(workflow, status !== undefined ? { status } : {});
      if (mountedRef.current) {
        setRuns(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) setError(toError(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [client, workflow, status]);

  useEffect(() => {
    mountedRef.current = true;
    if (options.enabled === false) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }
    void refetch();
    const interval = options.pollInterval !== undefined && options.pollInterval > 0
      ? setInterval(() => void refetch(), options.pollInterval)
      : undefined;
    return () => {
      mountedRef.current = false;
      if (interval !== undefined) clearInterval(interval);
    };
  }, [refetch, options.enabled, options.pollInterval]);

  return { runs, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// useWorkflowRun
// ---------------------------------------------------------------------------

export interface UseWorkflowRunOptions {
  /** Poll interval while the run is RUNNING. Default: 1000 */
  readonly pollInterval?: number | undefined;
}

export interface UseWorkflowRunResult {
  readonly run: WorkflowRun | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

/**
 * One run, polled while it is RUNNING (e.g. executing in a background
 * queue) and left alone once it stops. Pass `undefined` to render nothing.
 */
export function useWorkflowRun(
  workflow: string,
  runId: string | undefined,
  options: UseWorkflowRunOptions = {}
): UseWorkflowRunResult {
  const client = useNexoClient();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(runId !== undefined);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const pollInterval = options.pollInterval ?? 1000;

  const refetch = useCallback(async () => {
    if (runId === undefined) return;
    try {
      const data = await client.workflows.getRun(workflow, runId);
      if (mountedRef.current) {
        setRun(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) setError(toError(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [client, workflow, runId]);

  useEffect(() => {
    mountedRef.current = true;
    setRun(null);
    setLoading(runId !== undefined);
    void refetch();
    return () => {
      mountedRef.current = false;
    };
  }, [refetch, runId]);

  const isRunning = run?.status === "RUNNING";
  useEffect(() => {
    if (!isRunning || pollInterval <= 0) return;
    const interval = setInterval(() => void refetch(), pollInterval);
    return () => clearInterval(interval);
  }, [isRunning, pollInterval, refetch]);

  return { run, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// useWorkflowActions
// ---------------------------------------------------------------------------

export interface UseWorkflowActionsResult {
  /** Starts a run; resolves with its state (RUNNING if the server queues runs). */
  readonly start: (request: StartRunRequest) => Promise<WorkflowRun>;
  /** Resumes a WAITING or ESCALATED run with an optional human response. */
  readonly resume: (runId: string, response?: unknown) => Promise<WorkflowRun>;
  readonly pending: boolean;
  readonly error: Error | null;
}

/** Start and resume actions for one workflow, with pending/error state. */
export function useWorkflowActions(workflow: string): UseWorkflowActionsResult {
  const client = useNexoClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const track = useCallback(async (action: () => Promise<WorkflowRun>): Promise<WorkflowRun> => {
    setPending(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      const failure = toError(err);
      setError(failure);
      throw failure;
    } finally {
      setPending(false);
    }
  }, []);

  const start = useCallback(
    (request: StartRunRequest) => track(() => client.workflows.startRun(workflow, request)),
    [client, workflow, track]
  );
  const resume = useCallback(
    (runId: string, response?: unknown) => track(() => client.workflows.resumeRun(workflow, runId, response)),
    [client, workflow, track]
  );

  return { start, resume, pending, error };
}

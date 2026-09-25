/**
 * Typed client for the workflow HTTP API exposed by
 * `createWorkflowApiModule()` in `@nexo-alpha/agent`. Reached through
 * `client.workflows` on a {@link NexoClient}.
 *
 * Wire types are declared here rather than imported from
 * `@nexo-alpha/agent`, so browser bundles don't pull in server packages.
 */

import type { NexoClient } from "./client.js";

export type WorkflowRunStatus = "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "ESCALATED" | "CANCELLED";

/** One step's execution record: intent → decision → tool result → verification. */
export interface WorkflowStepRecord {
  readonly id: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly totalDurationMs: number;
  readonly intent: { readonly action: string; readonly actor?: string; readonly target?: string; readonly payload?: Record<string, unknown> };
  readonly decision: { readonly result: string; readonly reason?: string; readonly code?: string; readonly rule?: string; readonly question?: string; readonly to?: string };
  readonly toolResult?: { readonly success: boolean; readonly data?: unknown; readonly error?: string; readonly durationMs: number };
  readonly verificationResult?: { readonly status: string; readonly reason?: string };
  readonly attempt: number;
  readonly status: "APPROVED_AND_COMPLETE" | "APPROVED_AND_FAILED" | "BLOCKED" | "ERROR";
  readonly error?: string;
}

export interface WorkflowRun {
  readonly id: string;
  readonly workflowName: string;
  readonly goal: string;
  readonly step: number;
  readonly status: WorkflowRunStatus;
  readonly history: readonly WorkflowStepRecord[];
  readonly context: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: string;
  /** Present while status is WAITING or ESCALATED. */
  readonly pendingDecision?: { readonly result: string; readonly question?: string; readonly reason?: string; readonly to?: string; readonly expectedInput?: string };
}

/** A tool a workflow run may call. */
export interface WorkflowToolInfo {
  readonly action: string;
  /** False when `allowedActions` names an action no tool is registered for. */
  readonly registered: boolean;
  readonly description?: string;
  /** Permissions the actor needs (enforced by `toolPermissionRule`). */
  readonly permissions: readonly string[];
}

/** Response of `GET /workflows/:name`. */
export interface WorkflowDescription {
  readonly name: string;
  readonly maxSteps: number;
  /** `null` when the workflow may call any registered tool. */
  readonly allowedActions: readonly string[] | null;
  readonly tools: readonly WorkflowToolInfo[];
}

export interface StartRunRequest {
  readonly goal: string;
  readonly initialContext?: Record<string, unknown>;
  readonly actor?: string;
}

export interface WaitForRunOptions {
  /** Poll interval. Default: 500 */
  readonly intervalMs?: number;
  /** Give up after this long. Default: 60000 */
  readonly timeoutMs?: number;
}

export class NexoWorkflowsClient {
  private readonly basePath: string;

  constructor(private readonly client: NexoClient, basePath = "/workflows") {
    this.basePath = basePath.replace(/\/+$/, "");
  }

  private path(...segments: string[]): string {
    return [this.basePath, ...segments.map(encodeURIComponent)].join("/");
  }

  /** Names of the workflows the server exposes. */
  async list(): Promise<string[]> {
    return (await this.client.get<{ workflows: string[] }>(this.basePath)).workflows;
  }

  /** Step limit, allowed actions and callable tools of one workflow. */
  describe(workflow: string): Promise<WorkflowDescription> {
    return this.client.get<WorkflowDescription>(this.path(workflow));
  }

  /**
   * Starts a run. Resolves once it stops — or immediately with status
   * RUNNING when the server executes workflows in a background queue
   * (then use {@link waitForRun}).
   */
  startRun(workflow: string, request: StartRunRequest): Promise<WorkflowRun> {
    return this.client.post<WorkflowRun>(this.path(workflow, "runs"), request);
  }

  /** One run. Rejects with NexoApiError (404) if it does not exist. */
  getRun(workflow: string, runId: string): Promise<WorkflowRun> {
    return this.client.get<WorkflowRun>(this.path(workflow, "runs", runId));
  }

  /** Saved runs of a workflow, optionally filtered by status. */
  async listRuns(workflow: string, filter: { readonly status?: WorkflowRunStatus } = {}): Promise<WorkflowRun[]> {
    const query = filter.status !== undefined ? `?status=${encodeURIComponent(filter.status)}` : "";
    return (await this.client.get<{ runs: WorkflowRun[] }>(`${this.path(workflow, "runs")}${query}`)).runs;
  }

  /** Resumes a WAITING or ESCALATED run. Rejects with NexoApiError (409) otherwise. */
  resumeRun(workflow: string, runId: string, response?: unknown): Promise<WorkflowRun> {
    return this.client.post<WorkflowRun>(
      this.path(workflow, "runs", runId, "resume"),
      response !== undefined ? { response } : {}
    );
  }

  /** Polls a run until it is no longer RUNNING. Rejects if `timeoutMs` elapses first. */
  async waitForRun(workflow: string, runId: string, options: WaitForRunOptions = {}): Promise<WorkflowRun> {
    const intervalMs = options.intervalMs ?? 500;
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);

    for (;;) {
      const run = await this.getRun(workflow, runId);
      if (run.status !== "RUNNING") return run;
      if (Date.now() + intervalMs > deadline) {
        throw new Error(`Run "${runId}" of workflow "${workflow}" was still RUNNING when waitForRun timed out.`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

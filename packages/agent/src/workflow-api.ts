/**
 * HTTP API for workflows.
 *
 * Exposes a set of {@link NexoWorkflow}s as a plain `@nexo-alpha/core`
 * {@link NexoModule}, so any Nexo HTTP adapter (e.g. `@nexo-alpha/hapi`)
 * can serve it:
 *
 * ```
 * GET  /workflows                         → names of registered workflows
 * GET  /workflows/:name                   → limits and the tools a run can call
 * POST /workflows/:name/runs              → start a run   { goal, initialContext?, actor? }
 * GET  /workflows/:name/runs?status=...   → list saved runs
 * GET  /workflows/:name/runs/:id          → one run (404 if unknown)
 * POST /workflows/:name/runs/:id/resume   → resume a WAITING/ESCALATED run { response? } (409 otherwise)
 * ```
 *
 * By default `POST .../runs` and `.../resume` answer once the run stops
 * (COMPLETED, FAILED, WAITING, ESCALATED or CANCELLED), with the resulting
 * WorkflowState. With `queue`, they answer immediately with 202 Accepted, the
 * RUNNING state and a Location header, and the run executes in the background.
 */

import {
  NexoHttpError,
  httpResponse,
  type NexoHttpResponse,
  type NexoApi,
  type NexoApiAuth,
  type NexoModule,
  type NexoRequestContext
} from "@nexo-alpha/core";
import type { NexoWorkflow, WorkflowState, WorkflowStatus } from "./workflow.js";

export interface WorkflowApiOptions {
  /** The workflows to expose. Names must be unique. */
  readonly workflows: readonly NexoWorkflow[];
  /** Module name. Default: "workflows" */
  readonly name?: string | undefined;
  /** Route prefix. Default: "/workflows" */
  readonly basePath?: string | undefined;
  /** Auth requirement applied to every route. */
  readonly auth?: NexoApiAuth | undefined;
  /**
   * Resolves the actor from the request (e.g. from an auth header) for new
   * runs and resumes. Takes precedence over `actor` in the request body, and
   * over any actor the intent parser produces.
   */
  readonly resolveActor?: ((context: NexoRequestContext) => string | undefined) | undefined;
  /**
   * Runs workflows in the background. When set, `POST .../runs` and
   * `.../resume` save the run as RUNNING, enqueue its execution, and answer
   * immediately; clients poll `GET .../runs/:id`. Any queue with this shape
   * works, e.g. `createJobQueue()` from `@nexo-alpha/scheduler`.
   */
  readonly queue?: WorkflowJobQueue | undefined;
  /** Job type registered on `queue`. Must be unique per queue. Default: "nexo.workflow.execute" */
  readonly jobType?: string | undefined;
}

/** The part of a job queue the workflow API needs (matches `@nexo-alpha/scheduler`'s `NexoJobQueue`). */
export interface WorkflowJobQueue {
  define(type: string, handler: (payload: WorkflowJobPayload) => unknown): unknown;
  enqueue(type: string, payload: WorkflowJobPayload): Promise<unknown>;
}

/** Payload of a queued workflow execution. */
export interface WorkflowJobPayload {
  readonly workflow: string;
  readonly runId: string;
  readonly actor?: string;
}

const STATUSES: readonly WorkflowStatus[] = ["RUNNING", "WAITING", "COMPLETED", "FAILED", "ESCALATED", "CANCELLED"];

function body(context: NexoRequestContext): Record<string, unknown> {
  const payload = context.payload;
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * Creates a {@link NexoModule} exposing `options.workflows` over HTTP.
 * Register it with `app.module(createWorkflowApiModule({ workflows }))`.
 */
export function createWorkflowApiModule(options: WorkflowApiOptions): NexoModule {
  const basePath = (options.basePath ?? "/workflows").replace(/\/+$/, "");
  const workflows = new Map<string, NexoWorkflow>();

  for (const workflow of options.workflows) {
    if (workflows.has(workflow.name)) {
      throw new Error(`Duplicate workflow name "${workflow.name}" in createWorkflowApiModule().`);
    }
    workflows.set(workflow.name, workflow);
  }

  const auth = options.auth !== undefined ? { auth: options.auth } : {};
  const queue = options.queue;
  const jobType = options.jobType ?? "nexo.workflow.execute";

  if (queue !== undefined) {
    queue.define(jobType, async (payload) => {
      const workflow = workflows.get(payload.workflow);
      const state = await workflow?.load(payload.runId);
      // Already finished (e.g. a retried job) or deleted: nothing to do.
      if (workflow === undefined || state === undefined || state.status !== "RUNNING") {
        return { skipped: true };
      }
      const final = await workflow.execute(state, payload.actor !== undefined ? { actor: payload.actor } : undefined);
      return { status: final.status };
    });
  }

  /**
   * Executes now (200 with the final state), or — with a queue — enqueues
   * execution and answers 202 Accepted with the RUNNING state and a
   * Location header pointing at the run.
   */
  async function executeOrEnqueue(
    workflow: NexoWorkflow,
    state: WorkflowState,
    actor: string | undefined
  ): Promise<WorkflowState | NexoHttpResponse<WorkflowState>> {
    if (queue === undefined) {
      return workflow.execute(state, actor !== undefined ? { actor } : undefined);
    }
    await queue.enqueue(jobType, {
      workflow: workflow.name,
      runId: state.id,
      ...(actor !== undefined ? { actor } : {})
    });
    return httpResponse(202, state, {
      location: `${basePath}/${encodeURIComponent(workflow.name)}/runs/${encodeURIComponent(state.id)}`
    });
  }

  function workflowFor(context: NexoRequestContext): NexoWorkflow {
    const name = context.params.name ?? "";
    const workflow = workflows.get(name);
    if (workflow === undefined) {
      throw new NexoHttpError(404, "WORKFLOW_NOT_FOUND", `Workflow "${name}" not found.`);
    }
    return workflow;
  }

  async function runFor(context: NexoRequestContext): Promise<{ workflow: NexoWorkflow; state: WorkflowState }> {
    const workflow = workflowFor(context);
    const id = context.params.id ?? "";
    const state = await workflow.load(id);
    if (state === undefined || state.workflowName !== workflow.name) {
      throw new NexoHttpError(404, "WORKFLOW_RUN_NOT_FOUND", `Run "${id}" of workflow "${workflow.name}" not found.`);
    }
    return { workflow, state };
  }

  const apis: NexoApi[] = [
    {
      name: "listWorkflows",
      method: "GET",
      path: basePath,
      description: "Lists the names of the registered workflows.",
      ...auth,
      schema: { response: { type: "array", items: { type: "string" } } },
      handler: () => ({ workflows: [...workflows.keys()] })
    },
    {
      name: "describeWorkflow",
      method: "GET",
      path: `${basePath}/:name`,
      description: "Describes a workflow: step limit, allowed actions and the tools it can call.",
      ...auth,
      schema: { params: { name: { type: "string", required: true } } },
      handler: (context) => {
        const workflow = workflowFor(context);
        const actions = workflow.allowedActions ?? workflow.agent.tools.actions;
        return {
          name: workflow.name,
          maxSteps: workflow.maxSteps,
          allowedActions: workflow.allowedActions ?? null,
          tools: actions.map((action) => {
            const tool = workflow.agent.tools.get(action);
            return {
              action,
              registered: tool !== undefined,
              ...(tool?.description !== undefined ? { description: tool.description } : {}),
              permissions: [...(tool?.permissions ?? [])]
            };
          })
        };
      }
    },
    {
      name: "startWorkflowRun",
      method: "POST",
      path: `${basePath}/:name/runs`,
      description: "Starts a workflow run and returns its state once it stops.",
      ...auth,
      schema: {
        params: { name: { type: "string", required: true } },
        body: {
          type: "object",
          properties: {
            goal: { type: "string", required: true },
            initialContext: { type: "object" },
            actor: { type: "string" }
          }
        }
      },
      validate: (context) => {
        const { goal, initialContext, actor } = body(context);
        const errors: string[] = [];
        if (typeof goal !== "string" || goal.trim() === "") errors.push('"goal" must be a non-empty string.');
        if (initialContext !== undefined && (typeof initialContext !== "object" || initialContext === null || Array.isArray(initialContext))) {
          errors.push('"initialContext" must be an object.');
        }
        if (actor !== undefined && typeof actor !== "string") errors.push('"actor" must be a string.');
        return errors.length > 0 ? { valid: false, errors } : { valid: true };
      },
      handler: async (context) => {
        const workflow = workflowFor(context);
        const { goal, initialContext, actor } = body(context);
        const resolvedActor = options.resolveActor?.(context) ?? (actor as string | undefined);
        const state = await workflow.start(goal as string, {
          ...(initialContext !== undefined ? { initialContext: initialContext as Record<string, unknown> } : {}),
          ...(resolvedActor !== undefined ? { actor: resolvedActor } : {})
        });
        return executeOrEnqueue(workflow, state, resolvedActor);
      }
    },
    {
      name: "listWorkflowRuns",
      method: "GET",
      path: `${basePath}/:name/runs`,
      description: "Lists saved runs of a workflow, optionally filtered by status.",
      ...auth,
      schema: {
        params: { name: { type: "string", required: true } },
        query: { status: { type: "string" } }
      },
      validate: (context) => {
        const status = context.query.status;
        return status === undefined || STATUSES.includes(status as WorkflowStatus)
          ? { valid: true }
          : { valid: false, errors: [`"status" must be one of ${STATUSES.join(", ")}.`] };
      },
      handler: async (context) => {
        const workflow = workflowFor(context);
        const status = context.query.status as WorkflowStatus | undefined;
        const runs = await workflow.store.list({
          workflowName: workflow.name,
          ...(status !== undefined ? { status } : {})
        });
        return { runs };
      }
    },
    {
      name: "getWorkflowRun",
      method: "GET",
      path: `${basePath}/:name/runs/:id`,
      description: "Returns one workflow run.",
      ...auth,
      schema: {
        params: { name: { type: "string", required: true }, id: { type: "string", required: true } }
      },
      handler: async (context) => (await runFor(context)).state
    },
    {
      name: "resumeWorkflowRun",
      method: "POST",
      path: `${basePath}/:name/runs/:id/resume`,
      description: "Resumes a WAITING or ESCALATED run with an optional human response.",
      ...auth,
      schema: {
        params: { name: { type: "string", required: true }, id: { type: "string", required: true } },
        body: { type: "object", properties: { response: { type: "object" } } }
      },
      handler: async (context) => {
        const { workflow, state } = await runFor(context);
        if (state.status !== "WAITING" && state.status !== "ESCALATED") {
          throw new NexoHttpError(
            409,
            "WORKFLOW_NOT_RESUMABLE",
            `Run "${state.id}" is ${state.status}; only WAITING or ESCALATED runs can be resumed.`
          );
        }
        const resolvedActor = options.resolveActor?.(context);
        return executeOrEnqueue(workflow, await workflow.reopen(state, body(context).response), resolvedActor);
      }
    }
  ];

  return {
    name: options.name ?? "workflows",
    description: "HTTP API for starting, inspecting and resuming agent workflows.",
    apis
  };
}

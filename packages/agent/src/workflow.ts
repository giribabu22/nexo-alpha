/**
 * Phase 6 — Autonomous Workflow Engine.
 *
 * Orchestrates multi-step goal execution across the 5 layers:
 * `UNDERSTAND → KNOW → DECIDE → ACT → VERIFY`.
 *
 * Key invariants:
 * - Every single step MUST pass through the Decision Engine (`agent.execute()`).
 * - AI cannot bypass DECIDE, alter rules, or increase its permissions.
 * - Workflow execution is bounded by safety limits (`maxSteps`, `allowedActions`, `timeoutMs`).
 * - Supports human interruption (`ASK_USER` → `WAITING`, `ESCALATE` → `ESCALATED`) and resumption.
 */

import type { DecisionOutcome } from "@nexo-alpha/decision";
import type { ExecutionRecord } from "./audit.js";
import type { NexoAgent } from "./agent.js";
import type { IntentParser } from "./understand.js";
import type { AgentMemory, RecallQuery } from "./memory.js";
import { createInMemoryWorkflowStore, type WorkflowStore } from "./workflow-store.js";

export type WorkflowStatus =
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "ESCALATED"
  | "CANCELLED";

export interface WorkflowState {
  /** Unique execution instance ID for this workflow run */
  readonly id: string;
  /** Name of the workflow definition */
  readonly workflowName: string;
  /** Natural-language goal statement */
  readonly goal: string;
  /** Current step number (1-indexed) */
  step: number;
  /** Current execution status */
  status: WorkflowStatus;
  /** Chronological list of execution records for each step */
  history: ExecutionRecord[];
  /** Accumulated key-value context store across steps */
  context: Record<string, unknown>;
  /** Final result data upon completion */
  result?: unknown;
  /** Human-readable error message if status is FAILED */
  error?: string | undefined;
  /** Pending decision outcome if status is WAITING or ESCALATED */
  pendingDecision?: DecisionOutcome | undefined;
}

/**
 * Step-lifecycle events emitted while a workflow runs. Every event carries the
 * workflow execution ID; step events also carry the 1-indexed step number.
 */
export type WorkflowEvent =
  | { readonly type: "workflow.started"; readonly workflowId: string; readonly workflowName: string; readonly goal: string }
  | { readonly type: "workflow.resumed"; readonly workflowId: string; readonly workflowName: string; readonly step: number }
  | { readonly type: "step.started"; readonly workflowId: string; readonly workflowName: string; readonly step: number; readonly action: string }
  | { readonly type: "step.completed"; readonly workflowId: string; readonly workflowName: string; readonly step: number; readonly record: ExecutionRecord }
  | { readonly type: "step.failed"; readonly workflowId: string; readonly workflowName: string; readonly step: number; readonly error: string; readonly record?: ExecutionRecord | undefined }
  | { readonly type: "workflow.paused"; readonly workflowId: string; readonly workflowName: string; readonly step: number; readonly status: "WAITING" | "ESCALATED" }
  | { readonly type: "workflow.completed"; readonly workflowId: string; readonly workflowName: string; readonly steps: number; readonly durationMs: number }
  | { readonly type: "workflow.failed"; readonly workflowId: string; readonly workflowName: string; readonly step: number; readonly error: string; readonly durationMs: number }
  | { readonly type: "workflow.cancelled"; readonly workflowId: string; readonly workflowName: string; readonly step: number; readonly durationMs: number };

/**
 * Receives {@link WorkflowEvent}s. Listener errors are swallowed so that
 * observability can never change the outcome of a workflow.
 */
export type WorkflowEventListener = (event: WorkflowEvent) => void | Promise<void>;

export interface WorkflowOptions {
  /** Human-readable name for this workflow definition */
  readonly name: string;
  /** The NexoAgent instance used to execute individual steps */
  readonly agent: NexoAgent;
  /** Maximum number of steps allowed before auto-failing (default: 10) */
  readonly maxSteps?: number | undefined;
  /** Allowed actions for this workflow. Any intent targeting an action outside this list is BLOCKED. */
  readonly allowedActions?: readonly string[] | undefined;
  /** Maximum wall-clock time in milliseconds allowed for full workflow execution */
  readonly timeoutMs?: number | undefined;
  /** Custom IntentParser / planner for goal step resolution */
  readonly parser?: IntentParser | undefined;
  /** Optional WorkflowStore for persisting state across steps or process restarts */
  readonly store?: WorkflowStore | undefined;
  /** Optional listener for step-lifecycle events */
  readonly onEvent?: WorkflowEventListener | undefined;
  /**
   * Optional cross-run memory. When set, each `run()` preloads matching
   * entries into `context.memory` (as `{ [key]: value }`), and tools receive
   * the memory as `extras.memory` so they can remember new facts.
   */
  readonly memory?: AgentMemory | undefined;
  /** Builds the recall query for a goal. Default: `{ text: goal, limit: 10 }` */
  readonly recallMemory?: ((goal: string) => RecallQuery) | undefined;
}

export interface RunWorkflowOptions {
  /** Initial context data passed into the workflow */
  readonly initialContext?: Record<string, unknown> | undefined;
  /** Per-run parser override */
  readonly parser?: IntentParser | undefined;
  /**
   * Actor ID performing the workflow. When set, it is authoritative: it
   * replaces any `actor` the parser puts on an intent, so a parsed (possibly
   * user-influenced) intent cannot impersonate another actor. When unset,
   * the intent's actor is used, falling back to "user".
   */
  readonly actor?: string | undefined;
  /** Aborting this signal cancels the workflow before its next step (status "CANCELLED") */
  readonly signal?: AbortSignal | undefined;
}

export interface NexoWorkflow {
  readonly name: string;
  readonly maxSteps: number;
  readonly allowedActions: readonly string[] | undefined;
  readonly store: WorkflowStore;
  /** The agent that executes each step (its `tools` are the actions a run can take). */
  readonly agent: NexoAgent;
  /**
   * Runs a new workflow execution to achieve the given natural-language goal.
   * Equivalent to `execute(await start(goal, options), options)`.
   */
  run(goal: string, options?: RunWorkflowOptions): Promise<WorkflowState>;
  /**
   * Creates and saves a new RUNNING run (recalling memory into its context)
   * without executing any step. Pair with {@link execute}, e.g. from a
   * background job, to answer callers with the run ID immediately.
   */
  start(goal: string, options?: RunWorkflowOptions): Promise<WorkflowState>;
  /**
   * Executes the steps of a RUNNING run (by object or ID) until it stops.
   * Continues from the saved step, so a run interrupted by a crash can be
   * executed again; the step in progress at the crash is re-executed
   * (at-least-once). Throws if the run is not RUNNING.
   */
  execute(stateOrId: WorkflowState | string, options?: RunWorkflowOptions): Promise<WorkflowState>;
  /**
   * Moves a WAITING or ESCALATED run back to RUNNING, recording
   * `userResponse`, without executing any step. `resume()` is
   * `execute(await reopen(...))`.
   */
  reopen(stateOrId: WorkflowState | string, userResponse?: unknown): Promise<WorkflowState>;
  /**
   * Loads a saved WorkflowState instance by ID from `store`.
   */
  load(id: string): Promise<WorkflowState | undefined>;
  /**
   * Resumes a paused workflow (by object or ID string) with user or human input.
   */
  resume(
    stateOrId: WorkflowState | string,
    userResponse?: unknown,
    options?: RunWorkflowOptions
  ): Promise<WorkflowState>;
}

export function generateWorkflowId(): string {
  return `wf-exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Creates a new bounded, resumable {@link NexoWorkflow}.
 *
 * ```ts
 * const workflow = createWorkflow({
 *   name: "order-cancellation",
 *   agent,
 *   maxSteps: 5,
 *   allowedActions: ["find_order", "cancel_order", "issue_refund"]
 * });
 *
 * const state = await workflow.run("Process order cancellation for order #123");
 * ```
 */
export function createWorkflow(options: WorkflowOptions): NexoWorkflow {
  const workflowName = options.name;
  const agent = options.agent;
  const maxSteps = options.maxSteps ?? 10;
  const allowedActions = options.allowedActions;
  const timeoutMs = options.timeoutMs;
  const defaultParser = options.parser;
  const store = options.store ?? createInMemoryWorkflowStore();
  const onEvent = options.onEvent;
  const memory = options.memory;
  const recallMemory = options.recallMemory ?? ((goal: string): RecallQuery => ({ text: goal, limit: 10 }));

  async function emit(event: WorkflowEvent): Promise<void> {
    if (onEvent === undefined) return;
    try {
      await onEvent(event);
    } catch {
      // Listener failures must not affect workflow execution.
    }
  }

  async function executeStepLoop(
    state: WorkflowState,
    runOptions?: RunWorkflowOptions
  ): Promise<WorkflowState> {
    const activeParser = runOptions?.parser ?? defaultParser ?? agent;
    const explicitActor = runOptions?.actor;
    const actor = explicitActor ?? "user";
    const signal = runOptions?.signal;
    const startMs = Date.now();

    async function fail(error: string, record?: ExecutionRecord): Promise<WorkflowState> {
      state.status = "FAILED";
      state.error = error;
      await store.save(state);
      if (record !== undefined) {
        await emit({ type: "step.failed", workflowId: state.id, workflowName: state.workflowName, step: state.step, error, record });
      }
      await emit({ type: "workflow.failed", workflowId: state.id, workflowName: state.workflowName, step: state.step, error, durationMs: Date.now() - startMs });
      return state;
    }

    while (state.status === "RUNNING") {
      // ─── CANCELLATION ───────────────────────────────────────────────────
      if (signal?.aborted === true) {
        state.status = "CANCELLED";
        await store.save(state);
        await emit({ type: "workflow.cancelled", workflowId: state.id, workflowName: state.workflowName, step: state.step, durationMs: Date.now() - startMs });
        return state;
      }

      // ─── SAFETY CHECK 1: Max steps ──────────────────────────────────────
      if (state.step > maxSteps) {
        return fail(`Maximum step limit reached (${maxSteps} steps).`);
      }

      // ─── SAFETY CHECK 2: Timeout ────────────────────────────────────────
      if (timeoutMs !== undefined && Date.now() - startMs > timeoutMs) {
        return fail(`Workflow execution timed out after ${timeoutMs}ms.`);
      }

      // ─── UNDERSTAND & PLAN ──────────────────────────────────────────────
      let intent;
      try {
        if ("parse" in activeParser && typeof activeParser.parse === "function") {
          intent = await activeParser.parse(state.goal, {
            workflowState: state,
            availableActions: allowedActions ?? agent.tools.actions
          });
        } else {
          // If agent is passed without custom parser, fallback to simple action parsing
          intent = { action: state.goal, actor };
        }
      } catch (error) {
        return fail(`Intent parsing / planning failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // ─── COMPLETION SIGNAL ──────────────────────────────────────────────
      if (
        intent.action === "complete" ||
        intent.action === "finish" ||
        intent.payload?.isComplete === true
      ) {
        state.status = "COMPLETED";
        state.result = intent.payload?.result ?? intent.payload?.data ?? "Goal completed successfully.";
        await store.save(state);
        await emit({ type: "workflow.completed", workflowId: state.id, workflowName: state.workflowName, steps: state.history.length, durationMs: Date.now() - startMs });
        return state;
      }

      // ─── SAFETY CHECK 3: Allowed actions boundary ───────────────────────
      if (allowedActions !== undefined && !allowedActions.includes(intent.action)) {
        return fail(`Action "${intent.action}" is not allowed in workflow "${workflowName}". Allowed: [${allowedActions.join(", ")}].`);
      }

      await emit({ type: "step.started", workflowId: state.id, workflowName: state.workflowName, step: state.step, action: intent.action });

      // Ensure actor is attached
      const intentWithActor = {
        ...intent,
        actor: explicitActor ?? intent.actor ?? actor
      };

      // ─── DECIDE → ACT → VERIFY → AUDIT ──────────────────────────────────
      const record = await agent.execute(intentWithActor, {
        extras: {
          workflowId: state.id, workflowName: state.workflowName,
          step: state.step,
          workflowContext: state.context,
          ...(memory !== undefined ? { memory } : {})
        }
      });

      state.history.push(record);

      // ─── EVALUATE RECORD OUTCOME ────────────────────────────────────────
      if (record.status === "BLOCKED") {
        if (record.decision.result === "ASK_USER" || record.decision.result === "ESCALATE") {
          const status = record.decision.result === "ASK_USER" ? "WAITING" : "ESCALATED";
          state.status = status;
          state.pendingDecision = record.decision;
          await store.save(state);
          await emit({ type: "workflow.paused", workflowId: state.id, workflowName: state.workflowName, step: state.step, status });
          return state;
        }

        // REJECT / DEFER
        return fail(
          `Step ${state.step} blocked by Decision Engine: ${record.decision.result}${
            "reason" in record.decision ? ` — ${record.decision.reason}` : ""
          }.`,
          record
        );
      }

      if (record.status === "APPROVED_AND_FAILED" || record.status === "ERROR") {
        return fail(record.error ?? record.verificationResult?.reason ?? `Step ${state.step} execution failed.`, record);
      }

      await emit({ type: "step.completed", workflowId: state.id, workflowName: state.workflowName, step: state.step, record });

      // ─── STEP SUCCESS: Accumulate context & advance ────────────────────
      if (record.toolResult?.data !== undefined && typeof record.toolResult.data === "object" && record.toolResult.data !== null) {
        state.context = {
          ...state.context,
          [intent.action]: record.toolResult.data
        };
      }

      state.step += 1;
      await store.save(state);
    }

    await store.save(state);
    return state;
  }

  async function loadState(stateOrId: WorkflowState | string): Promise<WorkflowState> {
    if (typeof stateOrId !== "string") return stateOrId;
    const loaded = await store.load(stateOrId);
    if (!loaded) {
      throw new Error(
        `Workflow with ID "${stateOrId}" not found in workflow store.`
      );
    }
    return loaded;
  }

  const workflow: NexoWorkflow = {
    name: workflowName,
    maxSteps,
    allowedActions,
    store,
    agent,

    async run(goal, runOptions) {
      return executeStepLoop(await workflow.start(goal, runOptions), runOptions);
    },

    async start(goal, runOptions) {
      const state: WorkflowState = {
        id: generateWorkflowId(),
        workflowName,
        goal,
        step: 1,
        status: "RUNNING",
        history: [],
        context: { ...(runOptions?.initialContext ?? {}) }
      };

      // Caller-supplied `initialContext.memory` takes precedence over recall.
      if (memory !== undefined && !("memory" in state.context)) {
        const recalled = await memory.recall(recallMemory(goal));
        if (recalled.length > 0) {
          state.context.memory = Object.fromEntries(recalled.map((entry) => [entry.key, entry.value]));
        }
      }

      await store.save(state);
      await emit({ type: "workflow.started", workflowId: state.id, workflowName: state.workflowName, goal });
      return state;
    },

    async execute(stateOrId, runOptions) {
      const state = await loadState(stateOrId);
      if (state.status !== "RUNNING") {
        throw new Error(
          `Cannot execute workflow "${state.id}" because its status is "${state.status}". Only "RUNNING" runs can be executed.`
        );
      }
      return executeStepLoop(state, runOptions);
    },

    async load(id) {
      return store.load(id);
    },

    async resume(stateOrId, userResponse, runOptions) {
      return executeStepLoop(await workflow.reopen(stateOrId, userResponse), runOptions);
    },

    async reopen(stateOrId, userResponse) {
      const state = await loadState(stateOrId);

      if (state.status !== "WAITING" && state.status !== "ESCALATED") {
        throw new Error(
          `Cannot resume workflow "${state.id}" because its status is "${state.status}". Resumption is only valid for "WAITING" or "ESCALATED".`
        );
      }

      state.status = "RUNNING";
      state.pendingDecision = undefined;

      if (userResponse !== undefined) {
        state.context[`userResponse_step_${state.step}`] = userResponse;
      }

      await store.save(state);
      await emit({ type: "workflow.resumed", workflowId: state.id, workflowName: state.workflowName, step: state.step });
      return state;
    }
  };

  return workflow;
}

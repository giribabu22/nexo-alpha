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
import { createInMemoryWorkflowStore, type WorkflowStore } from "./workflow-store.js";

export type WorkflowStatus =
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "ESCALATED";

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
}

export interface RunWorkflowOptions {
  /** Initial context data passed into the workflow */
  readonly initialContext?: Record<string, unknown> | undefined;
  /** Per-run parser override */
  readonly parser?: IntentParser | undefined;
  /** Actor ID performing the workflow */
  readonly actor?: string | undefined;
}

export interface NexoWorkflow {
  readonly name: string;
  readonly maxSteps: number;
  readonly allowedActions: readonly string[] | undefined;
  readonly store: WorkflowStore;
  /**
   * Runs a new workflow execution to achieve the given natural-language goal.
   */
  run(goal: string, options?: RunWorkflowOptions): Promise<WorkflowState>;
  /**
   * Loads a saved WorkflowState instance by ID from `store`.
   */
  load(id: string): Promise<WorkflowState | undefined>;
  /**
   * Resumes a paused workflow (by object or ID string) with user or human input.
   */
  resume(stateOrId: WorkflowState | string, userResponse?: unknown): Promise<WorkflowState>;
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

  async function executeStepLoop(
    state: WorkflowState,
    runOptions?: RunWorkflowOptions
  ): Promise<WorkflowState> {
    const activeParser = runOptions?.parser ?? defaultParser ?? agent;
    const actor = runOptions?.actor ?? "user";
    const startMs = Date.now();

    while (state.status === "RUNNING") {
      // ─── SAFETY CHECK 1: Max steps ──────────────────────────────────────
      if (state.step > maxSteps) {
        state.status = "FAILED";
        state.error = `Maximum step limit reached (${maxSteps} steps).`;
        await store.save(state);
        return state;
      }

      // ─── SAFETY CHECK 2: Timeout ────────────────────────────────────────
      if (timeoutMs !== undefined && Date.now() - startMs > timeoutMs) {
        state.status = "FAILED";
        state.error = `Workflow execution timed out after ${timeoutMs}ms.`;
        await store.save(state);
        return state;
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
        state.status = "FAILED";
        state.error = `Intent parsing / planning failed: ${error instanceof Error ? error.message : String(error)}`;
        await store.save(state);
        return state;
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
        return state;
      }

      // ─── SAFETY CHECK 3: Allowed actions boundary ───────────────────────
      if (allowedActions !== undefined && !allowedActions.includes(intent.action)) {
        state.status = "FAILED";
        state.error = `Action "${intent.action}" is not allowed in workflow "${workflowName}". Allowed: [${allowedActions.join(", ")}].`;
        await store.save(state);
        return state;
      }

      // Ensure actor is attached
      const intentWithActor = {
        ...intent,
        actor: intent.actor ?? actor
      };

      // ─── DECIDE → ACT → VERIFY → AUDIT ──────────────────────────────────
      const record = await agent.execute(intentWithActor, {
        extras: { workflowId: state.id, step: state.step, workflowContext: state.context }
      });

      state.history.push(record);

      // ─── EVALUATE RECORD OUTCOME ────────────────────────────────────────
      if (record.status === "BLOCKED") {
        if (record.decision.result === "ASK_USER") {
          state.status = "WAITING";
          state.pendingDecision = record.decision;
          await store.save(state);
          return state;
        }

        if (record.decision.result === "ESCALATE") {
          state.status = "ESCALATED";
          state.pendingDecision = record.decision;
          await store.save(state);
          return state;
        }

        // REJECT / DEFER
        state.status = "FAILED";
        state.error = `Step ${state.step} blocked by Decision Engine: ${record.decision.result}${
          "reason" in record.decision ? ` — ${record.decision.reason}` : ""
        }.`;
        await store.save(state);
        return state;
      }

      if (record.status === "APPROVED_AND_FAILED" || record.status === "ERROR") {
        state.status = "FAILED";
        state.error = record.error ?? record.verificationResult?.reason ?? `Step ${state.step} execution failed.`;
        await store.save(state);
        return state;
      }

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

  const workflow: NexoWorkflow = {
    name: workflowName,
    maxSteps,
    allowedActions,
    store,

    async run(goal, runOptions) {
      const state: WorkflowState = {
        id: generateWorkflowId(),
        workflowName,
        goal,
        step: 1,
        status: "RUNNING",
        history: [],
        context: { ...(runOptions?.initialContext ?? {}) }
      };

      await store.save(state);
      return executeStepLoop(state, runOptions);
    },

    async load(id) {
      return store.load(id);
    },

    async resume(stateOrId, userResponse) {
      let state: WorkflowState;

      if (typeof stateOrId === "string") {
        const loaded = await store.load(stateOrId);
        if (!loaded) {
          throw new Error(
            `Workflow with ID "${stateOrId}" not found in workflow store.`
          );
        }
        state = loaded;
      } else {
        state = stateOrId;
      }

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
      return executeStepLoop(state);
    }
  };

  return workflow;
}

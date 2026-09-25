/**
 * Test helpers for agents, tools and workflows:
 * `import { createToolStub, createTestAgent, runSteps, collectEvents } from "@nexo-alpha/agent/testing"`.
 *
 * ```ts
 * const refund = createToolStub("refund_order", { data: { refunded: true } });
 * const { agent } = createTestAgent({ tools: [refund] });
 * const run = await runSteps(agent, [{ action: "refund_order", target: "o-1" }]);
 * assert.equal(run.status, "COMPLETED");
 * assert.equal(refund.calls[0].intent.target, "o-1");
 * ```
 */

import { createDecisionEngine, type DecisionEngine, type DecisionIntent, type DecisionRule } from "@nexo-alpha/decision";
import { createAgent, type NexoAgent } from "./agent.js";
import type { NexoTool, ToolContext, ToolResult } from "./tool-registry.js";
import { createStepIntentParser } from "./understand.js";
import { createWorkflow, type RunWorkflowOptions, type WorkflowEvent, type WorkflowOptions, type WorkflowState } from "./workflow.js";

// ---------------------------------------------------------------------------
// Tool stubs
// ---------------------------------------------------------------------------

export interface ToolStubOptions {
  /** Data returned on success. Default: `{ action }` */
  readonly data?: unknown;
  /** Makes every call fail with this error message. */
  readonly error?: string;
  /** Makes every call throw this error (simulates a crashing tool). */
  readonly throws?: Error | string;
  /** Delay before responding, in ms. */
  readonly delayMs?: number;
  readonly permissions?: readonly string[];
  readonly description?: string;
  /** Full control: compute each result from the call context. */
  readonly respond?: (context: ToolContext) => ToolResult | Promise<ToolResult>;
}

/** A tool that records every call. */
export interface ToolStub extends NexoTool {
  readonly calls: readonly ToolContext[];
  /** Clears recorded calls. */
  reset(): void;
}

export function createToolStub(action: string, options: ToolStubOptions = {}): ToolStub {
  const calls: ToolContext[] = [];
  return {
    action,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.permissions !== undefined ? { permissions: options.permissions } : {}),
    calls,
    reset() {
      calls.length = 0;
    },
    async execute(context) {
      calls.push(context);
      if (options.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.throws !== undefined) {
        throw typeof options.throws === "string" ? new Error(options.throws) : options.throws;
      }
      if (options.respond !== undefined) return options.respond(context);
      if (options.error !== undefined) return { success: false, error: options.error, durationMs: 1 };
      return { success: true, data: options.data ?? { action }, durationMs: 1 };
    }
  };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface TestAgentOptions {
  readonly tools?: readonly NexoTool[];
  /** Decision rules. Default: none, so every intent is approved. */
  readonly rules?: readonly DecisionRule[];
  readonly name?: string;
  readonly maxRetries?: number;
}

export interface TestAgent {
  readonly agent: NexoAgent;
  readonly engine: DecisionEngine;
}

/** An agent with the given tools and rules (approve-all when no rules are given). */
export function createTestAgent(options: TestAgentOptions = {}): TestAgent {
  const engine = createDecisionEngine({ name: `${options.name ?? "test"}-engine` });
  for (const rule of options.rules ?? []) engine.addRule(rule);
  const agent = createAgent({
    name: options.name ?? "test-agent",
    decisionEngine: engine,
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {})
  });
  for (const tool of options.tools ?? []) agent.tools.register(tool);
  return { agent, engine };
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export interface RunStepsOptions extends RunWorkflowOptions {
  readonly goal?: string;
  /** Extra workflow options (store, memory, onEvent, maxSteps, …). */
  readonly workflow?: Omit<WorkflowOptions, "agent" | "parser" | "name"> & { readonly name?: string };
}

/** Runs a workflow whose steps are exactly `steps`, in order, and returns the final state. */
export function runSteps(agent: NexoAgent, steps: readonly DecisionIntent[], options: RunStepsOptions = {}): Promise<WorkflowState> {
  const { goal, workflow: workflowOptions, ...runOptions } = options;
  const workflow = createWorkflow({
    name: workflowOptions?.name ?? "test-workflow",
    ...workflowOptions,
    agent,
    parser: createStepIntentParser(steps)
  });
  return workflow.run(goal ?? "test goal", runOptions);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventCollector<E extends { readonly type: string }> {
  /** Pass as `onEvent`. */
  readonly listener: (event: E) => void;
  readonly events: readonly E[];
  /** The collected event types, in order. */
  types(): string[];
  /** Collected events of one type. */
  ofType<T extends E["type"]>(type: T): Extract<E, { type: T }>[];
  clear(): void;
}

/** Collects events from `onEvent` hooks (workflows by default; works for job queues too). */
export function collectEvents<E extends { readonly type: string } = WorkflowEvent>(): EventCollector<E> {
  const events: E[] = [];
  return {
    listener: (event) => {
      events.push(event);
    },
    events,
    types: () => events.map((event) => event.type),
    ofType: <T extends E["type"]>(type: T) => events.filter((event) => event.type === type) as Extract<E, { type: T }>[],
    clear: () => {
      events.length = 0;
    }
  };
}

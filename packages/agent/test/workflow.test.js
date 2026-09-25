/**
 * Phase 6 — NexoWorkflow tests
 *
 * Build first:  pnpm --filter @nexo-alpha/agent build
 * Then run:     pnpm --filter @nexo-alpha/agent test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createAgent,
  createWorkflow,
  createStepIntentParser
} from "../dist/index.js";

import {
  createDecisionEngine,
  permissionRule,
  confirmationRule,
  escalationRule
} from "@nexo-alpha/decision";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approveAllEngine() {
  return createDecisionEngine({ name: "approve-all" });
}

function successTool(action) {
  return {
    action,
    execute: async ({ intent }) => ({
      success: true,
      data: { action: intent.action, processed: true },
      durationMs: 1
    })
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("Workflow: multi-step sequence executes DECIDE → ACT → VERIFY for each step", async () => {
  const engine = approveAllEngine();
  const agent = createAgent({ name: "payment-agent", decisionEngine: engine });

  agent.tools.register(successTool("find_payment"));
  agent.tools.register(successTool("retry_payment"));
  agent.tools.register(successTool("activate_subscription"));

  const parser = createStepIntentParser([
    { action: "find_payment", target: "pay_100" },
    { action: "retry_payment", target: "pay_100" },
    { action: "activate_subscription", target: "sub_200" }
  ]);

  const workflow = createWorkflow({
    name: "payment-recovery",
    agent,
    parser,
    maxSteps: 10
  });

  const state = await workflow.run("Fix failed payment and activate subscription #sub_200");

  assert.equal(state.status, "COMPLETED");
  assert.equal(state.history.length, 3);
  assert.equal(state.history[0].intent.action, "find_payment");
  assert.equal(state.history[1].intent.action, "retry_payment");
  assert.equal(state.history[2].intent.action, "activate_subscription");
  assert.equal(state.history.every(r => r.status === "APPROVED_AND_COMPLETE"), true);
  assert.ok(state.context.find_payment !== undefined);
  assert.ok(state.context.activate_subscription !== undefined);
});

test("Workflow: safety boundary maxSteps halts execution when exceeded", async () => {
  const engine = approveAllEngine();
  const agent = createAgent({ decisionEngine: engine });

  agent.tools.register(successTool("step_1"));
  agent.tools.register(successTool("step_2"));
  agent.tools.register(successTool("step_3"));

  const parser = createStepIntentParser([
    { action: "step_1" },
    { action: "step_2" },
    { action: "step_3" }
  ]);

  const workflow = createWorkflow({
    name: "bounded-workflow",
    agent,
    parser,
    maxSteps: 2 // Max 2 steps allowed
  });

  const state = await workflow.run("Run sequence");

  assert.equal(state.status, "FAILED");
  assert.equal(state.history.length, 2);
  assert.ok(state.error?.includes("Maximum step limit reached"));
});

test("Workflow: safety boundary allowedActions blocks unlisted actions", async () => {
  const engine = approveAllEngine();
  const agent = createAgent({ decisionEngine: engine });

  agent.tools.register(successTool("allowed_action"));
  agent.tools.register(successTool("forbidden_action"));

  const parser = createStepIntentParser([
    { action: "allowed_action" },
    { action: "forbidden_action" }
  ]);

  const workflow = createWorkflow({
    name: "restricted-workflow",
    agent,
    parser,
    allowedActions: ["allowed_action"]
  });

  const state = await workflow.run("Run restricted sequence");

  assert.equal(state.status, "FAILED");
  assert.equal(state.history.length, 1);
  assert.ok(state.error?.includes('Action "forbidden_action" is not allowed'));
});

test("Workflow: Decision Engine REJECT halts workflow immediately without tool call", async () => {
  const engine = createDecisionEngine();
  engine.addRule(permissionRule({
    name: "admin-only",
    actions: ["dangerous_action"],
    check: ({ intent }) => intent.actor === "admin"
  }));

  const agent = createAgent({ decisionEngine: engine });
  let toolCalled = false;
  agent.tools.register({
    action: "dangerous_action",
    execute() { toolCalled = true; return { success: true, durationMs: 0 }; }
  });

  const parser = createStepIntentParser([
    { action: "dangerous_action", actor: "user" }
  ]);

  const workflow = createWorkflow({
    name: "secure-workflow",
    agent,
    parser
  });

  const state = await workflow.run("Perform dangerous action");

  assert.equal(state.status, "FAILED");
  assert.equal(toolCalled, false);
  assert.ok(state.error?.includes("blocked by Decision Engine"));
});

test("Workflow: human interruption ASK_USER → WAITING → resume completes workflow", async () => {
  const engine = createDecisionEngine();
  engine.addRule(confirmationRule({
    name: "confirm-transfer",
    actions: ["transfer_funds"],
    requires: () => true,
    question: "Do you confirm transferring $5000?"
  }));

  const agent = createAgent({ decisionEngine: engine });
  agent.tools.register(successTool("prepare_transfer"));
  agent.tools.register(successTool("transfer_funds"));

  // First run needs confirmation on step 2
  const steps = [
    { action: "prepare_transfer" },
    { action: "transfer_funds" }
  ];

  const dynamicParser = {
    async parse(_goal, options) {
      const stepNum = options?.workflowState?.step ?? 1;
      if (stepNum === 1) {
        return steps[0];
      }
      if (stepNum === 2) {
        return steps[1];
      }
      return { action: "complete" };
    }
  };

  const workflow = createWorkflow({
    name: "transfer-workflow",
    agent,
    parser: dynamicParser
  });

  // Run 1: Pauses at step 2 with ASK_USER
  const pausedState = await workflow.run("Transfer money");

  assert.equal(pausedState.status, "WAITING");
  assert.equal(pausedState.pendingDecision?.result, "ASK_USER");
  assert.equal(pausedState.pendingDecision?.question, "Do you confirm transferring $5000?");

  // Now remove confirmation rule to simulate human approval for resumption
  engine.removeRule("confirm-transfer");

  // Resume workflow
  const resumedState = await workflow.resume(pausedState, "User clicked YES");

  assert.equal(resumedState.status, "COMPLETED");
  assert.equal(resumedState.context.userResponse_step_2, "User clicked YES");
  assert.equal(resumedState.history.length, 3);
  assert.equal(resumedState.history[1].status, "BLOCKED");
  assert.equal(resumedState.history[2].status, "APPROVED_AND_COMPLETE");
});

test("Workflow: human escalation ESCALATE → ESCALATED → resume completes workflow", async () => {
  const engine = createDecisionEngine();
  engine.addRule(escalationRule({
    name: "manager-approval",
    actions: ["high_refund"],
    requires: () => true,
    to: "finance-lead",
    reason: "Refund over limit."
  }));

  const agent = createAgent({ decisionEngine: engine });
  agent.tools.register(successTool("high_refund"));

  let escalated = true;
  const parser = {
    async parse() {
      if (escalated) return { action: "high_refund" };
      return { action: "complete" };
    }
  };

  const workflow = createWorkflow({
    name: "escalation-workflow",
    agent,
    parser
  });

  const state = await workflow.run("Refund order #999");

  assert.equal(state.status, "ESCALATED");
  assert.equal(state.pendingDecision?.result, "ESCALATE");
  assert.equal(state.pendingDecision?.to, "finance-lead");

  // Manager approves -> remove rule & resume
  engine.removeRule("manager-approval");
  escalated = false;

  const finalState = await workflow.resume(state, { managerId: "mgr_77", decision: "APPROVED" });

  assert.equal(finalState.status, "COMPLETED");
});

test("Workflow: onEvent receives the step lifecycle in order", async () => {
  const agent = createAgent({ name: "events-agent", decisionEngine: approveAllEngine() });
  agent.tools.register(successTool("step_a"));
  agent.tools.register(successTool("step_b"));

  const events = [];
  const workflow = createWorkflow({
    name: "events-workflow",
    agent,
    parser: createStepIntentParser([{ action: "step_a" }, { action: "step_b" }]),
    onEvent: (event) => { events.push(event); }
  });

  const state = await workflow.run("Run two steps");

  assert.equal(state.status, "COMPLETED");
  assert.deepEqual(events.map(e => e.type), [
    "workflow.started",
    "step.started",
    "step.completed",
    "step.started",
    "step.completed",
    "workflow.completed"
  ]);
  assert.ok(events.every(e => e.workflowId === state.id));
  assert.equal(events[1].action, "step_a");
  assert.equal(events[2].record.intent.action, "step_a");
  assert.equal(events[5].steps, 2);
});

test("Workflow: failed step emits step.failed and workflow.failed", async () => {
  const agent = createAgent({ decisionEngine: approveAllEngine() });
  agent.tools.register({
    action: "broken",
    execute: async () => ({ success: false, error: "boom", durationMs: 1 })
  });

  const events = [];
  const workflow = createWorkflow({
    name: "failing-workflow",
    agent,
    parser: createStepIntentParser([{ action: "broken" }]),
    onEvent: (event) => { events.push(event); }
  });

  const state = await workflow.run("Break");

  assert.equal(state.status, "FAILED");
  const types = events.map(e => e.type);
  assert.deepEqual(types.slice(-2), ["step.failed", "workflow.failed"]);
  assert.equal(events.at(-1).error, state.error);
});

test("Workflow: aborting the signal cancels before the next step", async () => {
  const agent = createAgent({ decisionEngine: approveAllEngine() });
  const controller = new AbortController();
  agent.tools.register({
    action: "first",
    execute: async () => {
      controller.abort();
      return { success: true, data: { ok: true }, durationMs: 1 };
    }
  });
  agent.tools.register(successTool("second"));

  const events = [];
  const workflow = createWorkflow({
    name: "cancel-workflow",
    agent,
    parser: createStepIntentParser([{ action: "first" }, { action: "second" }]),
    onEvent: (event) => { events.push(event); }
  });

  const state = await workflow.run("Cancel midway", { signal: controller.signal });

  assert.equal(state.status, "CANCELLED");
  assert.equal(state.history.length, 1);
  assert.equal(events.at(-1).type, "workflow.cancelled");
  assert.equal((await workflow.load(state.id)).status, "CANCELLED");
});

test("Workflow: a throwing onEvent listener does not affect the outcome", async () => {
  const agent = createAgent({ decisionEngine: approveAllEngine() });
  agent.tools.register(successTool("only"));

  const workflow = createWorkflow({
    name: "listener-isolation",
    agent,
    parser: createStepIntentParser([{ action: "only" }]),
    onEvent: () => { throw new Error("listener exploded"); }
  });

  const state = await workflow.run("Stay healthy");

  assert.equal(state.status, "COMPLETED");
});

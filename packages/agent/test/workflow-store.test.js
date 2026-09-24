/**
 * Phase 7 — WorkflowStore & Persistent State tests
 *
 * Build first:  pnpm --filter @nexo-alpha/agent build
 * Then run:     pnpm --filter @nexo-alpha/agent test
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  createAgent,
  createWorkflow,
  createInMemoryWorkflowStore,
  createKnowledgeWorkflowStore,
  createFileWorkflowStore,
  createStepIntentParser
} from "../dist/index.js";

import { createKnowledge } from "@nexo-alpha/context";
import { createDecisionEngine, confirmationRule } from "@nexo-alpha/decision";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approveAllEngine() {
  return createDecisionEngine({ name: "approve-all" });
}

function successTool(action) {
  return {
    action,
    execute: async () => ({ success: true, data: { done: true }, durationMs: 1 })
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("WorkflowStore (InMemory): save, load, list, delete", async () => {
  const store = createInMemoryWorkflowStore();

  const state1 = {
    id: "wf-1",
    workflowName: "test-wf",
    goal: "Goal 1",
    step: 1,
    status: "RUNNING",
    history: [],
    context: { k: "v" }
  };

  const state2 = {
    id: "wf-2",
    workflowName: "test-wf",
    goal: "Goal 2",
    step: 2,
    status: "COMPLETED",
    history: [],
    context: {}
  };

  await store.save(state1);
  await store.save(state2);

  const loaded1 = await store.load("wf-1");
  assert.equal(loaded1?.id, "wf-1");
  assert.equal(loaded1?.goal, "Goal 1");

  const runningList = await store.list({ status: "RUNNING" });
  assert.equal(runningList.length, 1);
  assert.equal(runningList[0].id, "wf-1");

  const allList = await store.list({ workflowName: "test-wf" });
  assert.equal(allList.length, 2);

  const deleted = await store.delete("wf-1");
  assert.equal(deleted, true);
  assert.equal(await store.load("wf-1"), undefined);
});

test("WorkflowStore (Knowledge): writes execution progress to ApplicationKnowledge history journal", async () => {
  const knowledge = createKnowledge({ appName: "test-app" });
  const store = createKnowledgeWorkflowStore(knowledge);

  const state = {
    id: "wf-100",
    workflowName: "order-workflow",
    goal: "Cancel order #100",
    step: 1,
    status: "COMPLETED",
    history: [],
    context: {}
  };

  await store.save(state);

  const history = knowledge.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].target, "wf-100");
  assert.equal(history[0].result, "success");
  assert.ok(history[0].detail.includes("order-workflow"));
});

test("WorkflowStore (File): persists state snapshots across process restarts", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-wf-test-"));
  const jsonPath = path.join(tmpDir, "workflows.json");

  try {
    const storeInstance1 = createFileWorkflowStore(jsonPath);

    const state = {
      id: "wf-persistent-1",
      workflowName: "background-job",
      goal: "Process heavy tasks",
      step: 3,
      status: "WAITING",
      history: [],
      context: { count: 42 }
    };

    await storeInstance1.save(state);

    // Simulate new process by instantiating fresh store reading same file
    const storeInstance2 = createFileWorkflowStore(jsonPath);

    const loaded = await storeInstance2.load("wf-persistent-1");
    assert.equal(loaded?.id, "wf-persistent-1");
    assert.equal(loaded?.status, "WAITING");
    assert.equal(loaded?.context.count, 42);

    const list = await storeInstance2.list();
    assert.equal(list.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("NexoWorkflow + WorkflowStore: automatically persists steps and supports workflow.resume(id)", async () => {
  const engine = createDecisionEngine();
  engine.addRule(confirmationRule({
    name: "confirm-payment",
    actions: ["pay"],
    requires: () => true,
    question: "Confirm payment?"
  }));

  const agent = createAgent({ decisionEngine: engine });
  agent.tools.register(successTool("pay"));

  const store = createInMemoryWorkflowStore();

  const steps = [{ action: "pay" }];
  const parser = {
    async parse(_goal, options) {
      if (options?.workflowState?.step === 1) return steps[0];
      return { action: "complete" };
    }
  };

  const workflow = createWorkflow({
    name: "resumable-workflow",
    agent,
    parser,
    store
  });

  // Run 1: Pauses at step 1 with ASK_USER
  const paused = await workflow.run("Pay invoice");

  assert.equal(paused.status, "WAITING");
  const storedPaused = await workflow.load(paused.id);
  assert.equal(storedPaused?.status, "WAITING");

  // Remove rule and resume BY ID STRING
  engine.removeRule("confirm-payment");
  const resumed = await workflow.resume(paused.id, "Human confirmed payment");

  assert.equal(resumed.status, "COMPLETED");

  // Verify updated state in store
  const storedFinal = await workflow.load(paused.id);
  assert.equal(storedFinal?.status, "COMPLETED");
  assert.equal(storedFinal?.context.userResponse_step_1, "Human confirmed payment");
});

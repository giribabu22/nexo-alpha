/**
 * @nexo-alpha/agent — lifecycle tests
 *
 * Build first:  pnpm --filter @nexo-alpha/agent build
 * Then run:     pnpm --filter @nexo-alpha/agent test
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createAgent,
  createToolRegistry,
  createVerifierRegistry,
  createSimpleIntentParser
} from "../dist/index.js";

import {
  createDecisionEngine,
  permissionRule,
  stateRule,
  constraintRule,
  confirmationRule,
  escalationRule
} from "@nexo-alpha/decision";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEngine() {
  return createDecisionEngine({ name: "test-engine" });
}

function approveAll() {
  return makeEngine(); // no rules → always APPROVE
}

function rejectAll() {
  const engine = makeEngine();
  engine.addRule({
    name: "always-reject",
    evaluate: () => ({ result: "REJECT", reason: "Blocked.", code: "TEST_REJECT" })
  });
  return engine;
}

function askAll() {
  const engine = makeEngine();
  engine.addRule({
    name: "always-ask",
    evaluate: () => ({ result: "ASK_USER", question: "Are you sure?" })
  });
  return engine;
}

function successTool(action) {
  return {
    action,
    execute: async () => ({ success: true, data: { done: true }, durationMs: 1 })
  };
}

function failTool(action) {
  return {
    action,
    execute: async () => ({ success: false, error: "Tool exploded.", durationMs: 1 })
  };
}

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

test("ToolRegistry: registers and runs a tool", async () => {
  const registry = createToolRegistry();
  registry.register(successTool("do_thing"));

  const result = await registry.run({ action: "do_thing" });
  assert.equal(result.success, true);
  assert.deepEqual(result.data, { done: true });
});

test("ToolRegistry: returns failure for unregistered action", async () => {
  const registry = createToolRegistry();
  const result = await registry.run({ action: "unknown" });
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("No tool registered"));
});

test("ToolRegistry: rejects duplicate action names", () => {
  const registry = createToolRegistry();
  registry.register(successTool("do_thing"));
  assert.throws(() => registry.register(successTool("do_thing")), /already registered/);
});

test("ToolRegistry: unregister removes a tool", () => {
  const registry = createToolRegistry();
  registry.register(successTool("do_thing"));
  assert.equal(registry.has("do_thing"), true);
  assert.equal(registry.unregister("do_thing"), true);
  assert.equal(registry.has("do_thing"), false);
});

test("ToolRegistry: captures thrown errors as failed results", async () => {
  const registry = createToolRegistry();
  registry.register({
    action: "explode",
    execute() { throw new Error("BOOM"); }
  });

  const result = await registry.run({ action: "explode" });
  assert.equal(result.success, false);
  assert.equal(result.error, "BOOM");
});

// ---------------------------------------------------------------------------
// VerifierRegistry
// ---------------------------------------------------------------------------

test("VerifierRegistry: default passes on success", async () => {
  const registry = createVerifierRegistry();
  const result = await registry.verify({
    intent: { action: "x" },
    result: { success: true, durationMs: 0 },
    attempt: 1
  });
  assert.equal(result.status, "COMPLETE");
});

test("VerifierRegistry: default fails on tool failure (ABORT)", async () => {
  const registry = createVerifierRegistry();
  const result = await registry.verify({
    intent: { action: "x" },
    result: { success: false, error: "DB timeout.", durationMs: 0 },
    attempt: 1
  });
  assert.equal(result.status, "FAILURE");
  assert.equal(result.recovery, "ABORT");
});

test("VerifierRegistry: empty error → RETRY", async () => {
  const registry = createVerifierRegistry();
  const result = await registry.verify({
    intent: { action: "x" },
    result: { success: false, durationMs: 0 },
    attempt: 1
  });
  assert.equal(result.status, "FAILURE");
  assert.equal(result.recovery, "RETRY");
});

test("VerifierRegistry: custom verifier overrides default", async () => {
  const registry = createVerifierRegistry();
  registry.register({
    action: "special",
    verify({ result }) {
      // even a successful tool requires a refundId
      const data = result.data;
      if (typeof data === "object" && data !== null && "refundId" in data) {
        return { status: "COMPLETE" };
      }
      return { status: "FAILURE", reason: "Missing refundId.", recovery: "ESCALATE" };
    }
  });

  const pass = await registry.verify({
    intent: { action: "special" },
    result: { success: true, data: { refundId: "r_123" }, durationMs: 0 },
    attempt: 1
  });
  assert.equal(pass.status, "COMPLETE");

  const fail = await registry.verify({
    intent: { action: "special" },
    result: { success: true, data: {}, durationMs: 0 },
    attempt: 1
  });
  assert.equal(fail.status, "FAILURE");
  assert.equal(fail.recovery, "ESCALATE");
});

test("VerifierRegistry: wildcard * applies when no specific verifier found", async () => {
  const registry = createVerifierRegistry();
  registry.register({
    action: "*",
    verify: () => ({ status: "FAILURE", reason: "Global block.", recovery: "ABORT" })
  });

  const result = await registry.verify({
    intent: { action: "anything" },
    result: { success: true, durationMs: 0 },
    attempt: 1
  });
  assert.equal(result.status, "FAILURE");
});

// ---------------------------------------------------------------------------
// Agent — BLOCKED paths
// ---------------------------------------------------------------------------

test("Agent: REJECT → status BLOCKED, no tool called", async () => {
  const agent = createAgent({ decisionEngine: rejectAll() });
  let toolCalled = false;
  agent.tools.register({ action: "x", execute() { toolCalled = true; return { success: true, durationMs: 0 }; } });

  const record = await agent.execute({ action: "x" });

  assert.equal(record.status, "BLOCKED");
  assert.equal(record.decision.result, "REJECT");
  assert.equal(toolCalled, false);
  assert.equal(record.toolResult, undefined);
  assert.equal(record.verificationResult, undefined);
});

test("Agent: ASK_USER → status BLOCKED", async () => {
  const agent = createAgent({ decisionEngine: askAll() });
  const record = await agent.execute({ action: "x" });
  assert.equal(record.status, "BLOCKED");
  assert.equal(record.decision.result, "ASK_USER");
});

// ---------------------------------------------------------------------------
// Agent — APPROVED paths
// ---------------------------------------------------------------------------

test("Agent: APPROVE + success + verify → APPROVED_AND_COMPLETE", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  agent.tools.register(successTool("cancel_order"));

  const record = await agent.execute({ action: "cancel_order", actor: "u1", target: "o1" });

  assert.equal(record.status, "APPROVED_AND_COMPLETE");
  assert.equal(record.decision.result, "APPROVE");
  assert.equal(record.toolResult?.success, true);
  assert.equal(record.verificationResult?.status, "COMPLETE");
  assert.equal(record.attempt, 1);
});

test("Agent: APPROVE + tool failure → APPROVED_AND_FAILED", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  agent.tools.register(failTool("cancel_order"));

  const record = await agent.execute({ action: "cancel_order" });

  assert.equal(record.status, "APPROVED_AND_FAILED");
  assert.equal(record.toolResult?.success, false);
  assert.equal(record.verificationResult?.status, "FAILURE");
});

test("Agent: unregistered tool → APPROVED_AND_FAILED", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  // No tool registered for "mystery"
  const record = await agent.execute({ action: "mystery" });

  assert.equal(record.status, "APPROVED_AND_FAILED");
  assert.ok(record.toolResult?.error?.includes("No tool registered"));
});

// ---------------------------------------------------------------------------
// Agent — Retry
// ---------------------------------------------------------------------------

test("Agent: retries on RETRY recovery (maxRetries respected)", async () => {
  const engine = approveAll();
  const agent = createAgent({ decisionEngine: engine, maxRetries: 3 });

  let callCount = 0;
  agent.tools.register({
    action: "flaky",
    execute() {
      callCount += 1;
      // Succeed on 3rd attempt
      return { success: callCount >= 3, durationMs: 0 };
    }
  });

  // Empty error → RETRY recovery from default verifier
  const record = await agent.execute({ action: "flaky" });

  assert.equal(callCount, 3);
  assert.equal(record.status, "APPROVED_AND_COMPLETE");
  assert.equal(record.attempt, 3);
});

test("Agent: no retry when recovery is ABORT (maxRetries=3 but ABORT)", async () => {
  const agent = createAgent({ decisionEngine: approveAll(), maxRetries: 3 });
  agent.tools.register(failTool("x")); // error message → ABORT recovery

  const record = await agent.execute({ action: "x" });
  assert.equal(record.attempt, 1); // did not retry
  assert.equal(record.status, "APPROVED_AND_FAILED");
  assert.equal(record.verificationResult?.recovery, "ABORT");
});

test("Agent: default maxRetries=1 means no retry", async () => {
  const agent = createAgent({ decisionEngine: approveAll() }); // maxRetries defaults to 1
  let callCount = 0;
  agent.tools.register({
    action: "flaky",
    execute() { callCount++; return { success: false, durationMs: 0 }; }
  });

  await agent.execute({ action: "flaky" });
  assert.equal(callCount, 1);
});

// ---------------------------------------------------------------------------
// Agent — Audit log
// ---------------------------------------------------------------------------

test("Agent: every execute() call is recorded in auditLog", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  agent.tools.register(successTool("a"));
  agent.tools.register(successTool("b"));

  await agent.execute({ action: "a" });
  await agent.execute({ action: "b" });
  await agent.execute({ action: "a" });

  assert.equal(agent.auditLog.size, 3);
  assert.equal(agent.auditLog.filterByAction("a").length, 2);
  assert.equal(agent.auditLog.filterByAction("b").length, 1);
});

test("Agent: auditLog filterByStatus", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  agent.tools.register(successTool("ok"));
  agent.tools.register(failTool("bad"));

  await agent.execute({ action: "ok" });
  await agent.execute({ action: "bad" });

  assert.equal(agent.auditLog.filterByStatus("APPROVED_AND_COMPLETE").length, 1);
  assert.equal(agent.auditLog.filterByStatus("APPROVED_AND_FAILED").length, 1);
});

test("Agent: auditLog records include id, timestamps, and durationMs", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  agent.tools.register(successTool("x"));

  await agent.execute({ action: "x" });
  const entry = agent.auditLog.entries[0];

  assert.ok(entry !== undefined);
  assert.ok(entry.id.startsWith("exec-"));
  assert.ok(typeof entry.startedAt === "string");
  assert.ok(typeof entry.completedAt === "string");
  assert.ok(entry.totalDurationMs >= 0);
});

test("Agent: auditLog.clear() empties entries", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  agent.tools.register(successTool("x"));

  await agent.execute({ action: "x" });
  assert.equal(agent.auditLog.size, 1);
  agent.auditLog.clear();
  assert.equal(agent.auditLog.size, 0);
});

// ---------------------------------------------------------------------------
// Agent — Knowledge integration
// ---------------------------------------------------------------------------

test("Agent: writes to ApplicationKnowledge history when provided", async () => {
  // Minimal mock of ApplicationKnowledge
  const historyEntries = [];
  const knowledge = {
    addHistoryEntry(entry) { historyEntries.push(entry); },
    addDecision() {}, addConstraint() {}, setDevelopmentState() {},
    getDevelopmentState() { return { completed: [], inProgress: [], blocked: [], knownIssues: [] }; },
    getDecisions() { return []; }, getConstraints() { return []; },
    addIntent() {}, getIntents() { return []; }, getIntent() { return undefined; },
    getHistory() { return historyEntries; }
  };

  const agent = createAgent({ decisionEngine: approveAll(), knowledge });
  agent.tools.register(successTool("cancel_order"));

  await agent.execute({ action: "cancel_order", actor: "user_1", target: "order_42" });

  assert.equal(historyEntries.length, 1);
  const entry = historyEntries[0];
  assert.equal(entry.operation, "cancel_order");
  assert.equal(entry.actor, "user_1");
  assert.equal(entry.target, "order_42");
  assert.equal(entry.result, "success");
});

test("Agent: rejected actions are recorded as 'denied' in knowledge history", async () => {
  const historyEntries = [];
  const knowledge = {
    addHistoryEntry(entry) { historyEntries.push(entry); },
    addDecision() {}, addConstraint() {}, setDevelopmentState() {},
    getDevelopmentState() { return { completed: [], inProgress: [], blocked: [], knownIssues: [] }; },
    getDecisions() { return []; }, getConstraints() { return []; },
    addIntent() {}, getIntents() { return []; }, getIntent() { return undefined; },
    getHistory() { return historyEntries; }
  };

  const agent = createAgent({ decisionEngine: rejectAll(), knowledge });

  await agent.execute({ action: "delete", actor: "user_1" });

  assert.equal(historyEntries.length, 1);
  assert.equal(historyEntries[0].result, "denied");
});

// ---------------------------------------------------------------------------
// Agent — Full pipeline integration
// ---------------------------------------------------------------------------

test("Full pipeline: permission + state + success + verify = APPROVED_AND_COMPLETE", async () => {
  const engine = createDecisionEngine({ name: "order-pipeline" });
  engine
    .addRule(permissionRule({
      name: "owner-only",
      actions: ["cancel_order"],
      check: ({ intent }) => intent.actor === "user_1"
    }))
    .addRule(stateRule({
      name: "must-be-pending",
      actions: ["cancel_order"],
      allowedStates: ["pending", "processing"],
      resolveState: () => "pending"
    }))
    .addRule(constraintRule({
      name: "not-a-weekend",
      actions: ["cancel_order"],
      check: () => true,
      message: "No weekend cancellations."
    }));

  const agent = createAgent({ name: "order-agent", decisionEngine: engine });
  agent.tools.register({
    action: "cancel_order",
    async execute({ intent }) {
      return { success: true, data: { cancelled: intent.target }, durationMs: 2 };
    }
  });

  const record = await agent.execute({
    action: "cancel_order",
    actor: "user_1",
    target: "order_123"
  });

  assert.equal(record.status, "APPROVED_AND_COMPLETE");
  assert.equal(record.decision.result, "APPROVE");
  assert.equal(record.toolResult?.success, true);
  assert.equal(record.verificationResult?.status, "COMPLETE");
  // Decision engine audit log should also have the record
  assert.equal(engine.auditLog.size, 1);
});

test("Full pipeline: wrong actor → BLOCKED at permission stage", async () => {
  const engine = createDecisionEngine({ name: "order-pipeline" });
  engine.addRule(permissionRule({
    name: "owner-only",
    check: ({ intent }) => intent.actor === "user_1"
  }));

  const agent = createAgent({ name: "order-agent", decisionEngine: engine });
  let toolCalled = false;
  agent.tools.register({ action: "cancel_order", execute() { toolCalled = true; return { success: true, durationMs: 0 }; } });

  const record = await agent.execute({
    action: "cancel_order",
    actor: "user_2", // wrong actor
    target: "order_123"
  });

  assert.equal(record.status, "BLOCKED");
  assert.equal(record.decision.result, "REJECT");
  assert.equal(toolCalled, false);
  assert.equal(record.totalDurationMs >= 0, true);
});

test("Full pipeline: extras flow through to tool", async () => {
  const agent = createAgent({
    decisionEngine: approveAll(),
    extras: { db: "agent-level-db" }
  });

  let receivedExtras;
  agent.tools.register({
    action: "x",
    execute({ extras }) {
      receivedExtras = extras;
      return { success: true, durationMs: 0 };
    }
  });

  await agent.execute({ action: "x" }, { extras: { requestId: "req_1" } });

  assert.deepEqual(receivedExtras, { db: "agent-level-db", requestId: "req_1" });
});

// ---------------------------------------------------------------------------
// Matrix & Invariant Verification Tests
// ---------------------------------------------------------------------------

test("Matrix: state rule rejected → status BLOCKED", async () => {
  const engine = createDecisionEngine();
  engine.addRule(stateRule({
    name: "order-must-be-pending",
    actions: ["cancel"],
    allowedStates: ["pending"],
    resolveState: () => "shipped"
  }));

  const agent = createAgent({ decisionEngine: engine });
  let toolCalled = false;
  agent.tools.register({ action: "cancel", execute() { toolCalled = true; return { success: true, durationMs: 0 }; } });

  const record = await agent.execute({ action: "cancel" });

  assert.equal(record.status, "BLOCKED");
  assert.equal(record.decision.result, "REJECT");
  assert.equal(record.decision.code, "INVALID_STATE");
  assert.equal(toolCalled, false);
});

test("Matrix: confirmation required → status BLOCKED (ASK_USER)", async () => {
  const engine = createDecisionEngine();
  engine.addRule(confirmationRule({
    name: "confirm-delete",
    actions: ["delete_all"],
    requires: () => true,
    question: "Are you sure you want to delete everything?"
  }));

  const agent = createAgent({ decisionEngine: engine });
  let toolCalled = false;
  agent.tools.register({ action: "delete_all", execute() { toolCalled = true; return { success: true, durationMs: 0 }; } });

  const record = await agent.execute({ action: "delete_all" });

  assert.equal(record.status, "BLOCKED");
  assert.equal(record.decision.result, "ASK_USER");
  assert.equal(record.decision.question, "Are you sure you want to delete everything?");
  assert.equal(toolCalled, false);
});

test("Matrix: escalation required → status BLOCKED (ESCALATE)", async () => {
  const engine = createDecisionEngine();
  engine.addRule(escalationRule({
    name: "manager-approval-needed",
    actions: ["refund"],
    requires: () => true,
    to: "finance_manager",
    reason: "Refund over $500 requires manager authorization."
  }));

  const agent = createAgent({ decisionEngine: engine });
  let toolCalled = false;
  agent.tools.register({ action: "refund", execute() { toolCalled = true; return { success: true, durationMs: 0 }; } });

  const record = await agent.execute({ action: "refund" });

  assert.equal(record.status, "BLOCKED");
  assert.equal(record.decision.result, "ESCALATE");
  assert.equal(record.decision.to, "finance_manager");
  assert.equal(toolCalled, false);
});

test("Matrix: tool fails + retries exhausted → APPROVED_AND_FAILED", async () => {
  const agent = createAgent({ decisionEngine: approveAll(), maxRetries: 3 });
  let attempts = 0;
  agent.tools.register({
    action: "persistently_failing",
    execute() {
      attempts++;
      return { success: false, durationMs: 0 }; // empty error -> default verifier RETRY
    }
  });

  const record = await agent.execute({ action: "persistently_failing" });

  assert.equal(attempts, 3);
  assert.equal(record.status, "APPROVED_AND_FAILED");
  assert.equal(record.attempt, 3);
  assert.equal(record.verificationResult?.status, "FAILURE");
});

test("Matrix: tool fails + escalation recovery → APPROVED_AND_FAILED", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  agent.tools.register(failTool("refund_vault"));
  agent.verifiers.register({
    action: "refund_vault",
    verify: () => ({ status: "FAILURE", reason: "Vault unavailable.", recovery: "ESCALATE" })
  });

  const record = await agent.execute({ action: "refund_vault" });

  assert.equal(record.status, "APPROVED_AND_FAILED");
  assert.equal(record.verificationResult?.recovery, "ESCALATE");
});

test("Matrix: engine throws unexpected exception → status ERROR", async () => {
  const engine = createDecisionEngine();
  engine.addRule({
    name: "broken-rule",
    evaluate() { throw new Error("Internal decision engine failure."); }
  });

  const agent = createAgent({ decisionEngine: engine });
  const record = await agent.execute({ action: "test" });

  assert.equal(record.status, "ERROR");
  assert.equal(record.error, "Internal decision engine failure.");
  assert.ok(agent.auditLog.entries.length > 0);
});

test("Invariant: ❌ No APPROVE → No ACT (tool is NEVER executed when blocked)", async () => {
  const outcomesToTest = [
    { name: "REJECT", rule: { name: "r1", evaluate: () => ({ result: "REJECT", reason: "no" }) } },
    { name: "ASK_USER", rule: { name: "r2", evaluate: () => ({ result: "ASK_USER", question: "confirm?" }) } },
    { name: "ESCALATE", rule: { name: "r3", evaluate: () => ({ result: "ESCALATE", to: "boss", reason: "high risk" }) } },
    { name: "DEFER", rule: { name: "r4", evaluate: () => ({ result: "DEFER", until: "2026-09-25T00:00:00Z" }) } }
  ];

  for (const item of outcomesToTest) {
    const engine = createDecisionEngine();
    engine.addRule(item.rule);
    const agent = createAgent({ decisionEngine: engine });
    let toolExecuted = false;
    agent.tools.register({ action: "do_action", execute() { toolExecuted = true; return { success: true, durationMs: 0 }; } });

    const record = await agent.execute({ action: "do_action" });

    assert.equal(record.status, "BLOCKED", `Expected BLOCKED for outcome ${item.name}`);
    assert.equal(toolExecuted, false, `Tool MUST NOT run when outcome is ${item.name}`);
    assert.equal(record.toolResult, undefined);
  }
});

test("Invariant: ❌ ACT failure → Never silently report success", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  
  // Case A: tool returns success: false
  agent.tools.register(failTool("bad_tool"));
  const recordA = await agent.execute({ action: "bad_tool" });
  assert.notEqual(recordA.status, "APPROVED_AND_COMPLETE");
  assert.equal(recordA.status, "APPROVED_AND_FAILED");

  // Case B: tool returns success: true, but verifier returns FAILURE
  agent.tools.register(successTool("unverified_tool"));
  agent.verifiers.register({
    action: "unverified_tool",
    verify: () => ({ status: "FAILURE", reason: "Post-condition check failed.", recovery: "ABORT" })
  });
  const recordB = await agent.execute({ action: "unverified_tool" });
  assert.notEqual(recordB.status, "APPROVED_AND_COMPLETE");
  assert.equal(recordB.status, "APPROVED_AND_FAILED");

  // Case C: tool throws exception during execution
  agent.tools.register({
    action: "throwing_tool",
    execute() { throw new Error("Database crashed"); }
  });
  const recordC = await agent.execute({ action: "throwing_tool" });
  assert.notEqual(recordC.status, "APPROVED_AND_COMPLETE");
  assert.equal(recordC.status, "APPROVED_AND_FAILED");
});

// ---------------------------------------------------------------------------
// UNDERSTAND layer — agent.run() tests
// ---------------------------------------------------------------------------

test("Agent.run(): throws error if no parser is configured", async () => {
  const agent = createAgent({ decisionEngine: approveAll() });
  await assert.rejects(
    () => agent.run("Cancel order 123"),
    /No IntentParser configured/
  );
});

test("Agent.run(): parses text into DecisionIntent and executes control loop", async () => {
  const parser = createSimpleIntentParser({
    mappings: [
      {
        pattern: /cancel (?:my )?(?:last )?order #?([a-z0-9_-]+)/i,
        action: "cancel_order",
        extract: (input, match) => ({ target: match?.[1] })
      }
    ],
    defaultActor: "user_42"
  });

  const agent = createAgent({
    decisionEngine: approveAll(),
    parser
  });

  agent.tools.register({
    action: "cancel_order",
    async execute({ intent }) {
      return { success: true, data: { orderId: intent.target, status: "CANCELLED" }, durationMs: 2 };
    }
  });

  const record = await agent.run("Cancel my last order #ord-999");

  assert.equal(record.status, "APPROVED_AND_COMPLETE");
  assert.equal(record.intent.action, "cancel_order");
  assert.equal(record.intent.target, "ord-999");
  assert.equal(record.intent.actor, "user_42");
  assert.equal(record.toolResult?.success, true);
  assert.deepEqual(record.toolResult?.data, { orderId: "ord-999", status: "CANCELLED" });
});

test("Agent.run(): per-call parser overrides agent-level parser", async () => {
  const defaultParser = createSimpleIntentParser({
    defaultAction: "default_action"
  });
  const overrideParser = createSimpleIntentParser({
    defaultAction: "override_action"
  });

  const agent = createAgent({
    decisionEngine: approveAll(),
    parser: defaultParser
  });

  agent.tools.register(successTool("default_action"));
  agent.tools.register(successTool("override_action"));

  const record = await agent.run("Do something", { parser: overrideParser });
  assert.equal(record.intent.action, "override_action");
});

test("Agent.run(): full pipeline blocked by Decision Engine when intent violates policy", async () => {
  const parser = createSimpleIntentParser({
    mappings: [
      {
        pattern: /refund #?([a-z0-9_-]+)/i,
        action: "refund_order",
        extract: (input, match) => ({ target: match?.[1] })
      }
    ]
  });

  const engine = createDecisionEngine({ name: "refund-policy" });
  engine.addRule(permissionRule({
    name: "admin-only-refund",
    actions: ["refund_order"],
    check: ({ intent }) => intent.actor === "admin"
  }));

  const agent = createAgent({
    decisionEngine: engine,
    parser
  });

  let toolCalled = false;
  agent.tools.register({ action: "refund_order", execute() { toolCalled = true; return { success: true, durationMs: 0 }; } });

  // User input parses to action "refund_order" with actor "user" (default) -> blocked by permission rule!
  const record = await agent.run("Refund #ord-888");

  assert.equal(record.status, "BLOCKED");
  assert.equal(record.intent.action, "refund_order");
  assert.equal(record.intent.target, "ord-888");
  assert.equal(record.decision.result, "REJECT");
  assert.equal(toolCalled, false);
});

test("Agent.research(): executes web research and writes to knowledge history", async () => {
  const historyEntries = [];
  const knowledge = {
    addHistoryEntry(entry) { historyEntries.push(entry); },
    addDecision() {}, addConstraint() {}, setDevelopmentState() {},
    getDevelopmentState() { return { completed: [], inProgress: [], blocked: [], knownIssues: [] }; },
    getDecisions() { return []; }, getConstraints() { return []; },
    addIntent() {}, getIntents() { return []; }, getIntent() { return undefined; },
    getHistory() { return historyEntries; }
  };

  const agent = createAgent({ decisionEngine: approveAll(), knowledge });

  const result = await agent.research("What changed in React 20?");

  assert.equal(result.query, "What changed in React 20?");
  assert.ok(result.totalRetrieved > 0);
  assert.ok(result.totalVerified > 0);
  assert.equal(historyEntries.length, 1);
  assert.equal(historyEntries[0].operation, "web_research");
  assert.equal(historyEntries[0].target, "What changed in React 20?");
});




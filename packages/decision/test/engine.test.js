/**
 * @nexo-alpha/decision — engine tests
 *
 * Run after building:  pnpm --filter @nexo-alpha/decision build && node --test
 * Or from the root:    pnpm build && pnpm --filter @nexo-alpha/decision test
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createDecisionEngine,
  permissionRule,
  stateRule,
  constraintRule,
  confirmationRule,
  escalationRule,
  rateLimitRule
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Engine basics
// ---------------------------------------------------------------------------

test("returns APPROVE when no rules are registered", async () => {
  const engine = createDecisionEngine();
  const outcome = await engine.evaluate({ action: "do_something" });
  assert.equal(outcome.result, "APPROVE");
});

test("returns APPROVE when all rules pass through", async () => {
  const engine = createDecisionEngine();
  engine.addRule({
    name: "always-pass",
    evaluate() {
      return undefined; // no opinion
    }
  });
  const outcome = await engine.evaluate({ action: "do_something" });
  assert.equal(outcome.result, "APPROVE");
});

test("short-circuits on first decisive rule", async () => {
  const visited = [];

  const engine = createDecisionEngine();
  engine
    .addRule({
      name: "first",
      evaluate() {
        visited.push("first");
        return { result: "REJECT", reason: "Blocked.", code: "TEST" };
      }
    })
    .addRule({
      name: "second",
      evaluate() {
        visited.push("second");
        return undefined;
      }
    });

  const outcome = await engine.evaluate({ action: "do_something" });
  assert.equal(outcome.result, "REJECT");
  assert.deepEqual(visited, ["first"]);
});

test("rejects duplicate rule names", () => {
  const engine = createDecisionEngine();
  engine.addRule({ name: "my-rule", evaluate: () => undefined });
  assert.throws(
    () => engine.addRule({ name: "my-rule", evaluate: () => undefined }),
    /already registered/
  );
});

test("removeRule removes by name", () => {
  const engine = createDecisionEngine();
  engine.addRule({ name: "my-rule", evaluate: () => undefined });
  assert.equal(engine.ruleCount, 1);
  const removed = engine.removeRule("my-rule");
  assert.equal(removed, true);
  assert.equal(engine.ruleCount, 0);
});

test("removeRule returns false for unknown name", () => {
  const engine = createDecisionEngine();
  assert.equal(engine.removeRule("nonexistent"), false);
});

// ---------------------------------------------------------------------------
// appliesTo guard
// ---------------------------------------------------------------------------

test("skips rule when appliesTo returns false", async () => {
  let called = false;
  const engine = createDecisionEngine();
  engine.addRule({
    name: "only-for-foo",
    appliesTo(ctx) {
      return ctx.intent.action === "foo";
    },
    evaluate() {
      called = true;
      return { result: "REJECT", reason: "Blocked.", code: "TEST" };
    }
  });

  const outcome = await engine.evaluate({ action: "bar" });
  assert.equal(outcome.result, "APPROVE");
  assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// Built-in rules — permissionRule
// ---------------------------------------------------------------------------

test("permissionRule — rejects when check returns false", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    permissionRule({
      name: "owner-only",
      check({ intent }) {
        return intent.actor === intent.payload?.["ownerId"];
      },
      message: "Not your resource."
    })
  );

  const outcome = await engine.evaluate({
    action: "delete",
    actor: "user_1",
    payload: { ownerId: "user_2" }
  });
  assert.equal(outcome.result, "REJECT");
  if (outcome.result === "REJECT") {
    assert.equal(outcome.reason, "Not your resource.");
    assert.equal(outcome.code, "PERMISSION_DENIED");
  }
});

test("permissionRule — approves when check returns true", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    permissionRule({
      check({ intent }) {
        return intent.actor === intent.payload?.["ownerId"];
      }
    })
  );

  const outcome = await engine.evaluate({
    action: "delete",
    actor: "user_1",
    payload: { ownerId: "user_1" }
  });
  assert.equal(outcome.result, "APPROVE");
});

test("permissionRule — skips for unrelated actions", async () => {
  let checked = false;
  const engine = createDecisionEngine();
  engine.addRule(
    permissionRule({
      actions: ["cancel_order"],
      check() {
        checked = true;
        return false;
      }
    })
  );

  await engine.evaluate({ action: "view_order" });
  assert.equal(checked, false);
});

// ---------------------------------------------------------------------------
// Built-in rules — stateRule
// ---------------------------------------------------------------------------

test("stateRule — rejects when entity not found", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    stateRule({
      name: "order-state",
      allowedStates: ["pending"],
      resolveState: () => undefined
    })
  );

  const outcome = await engine.evaluate({ action: "cancel_order" });
  assert.equal(outcome.result, "REJECT");
  if (outcome.result === "REJECT") assert.equal(outcome.code, "NOT_FOUND");
});

test("stateRule — rejects when in wrong state", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    stateRule({
      name: "order-state",
      allowedStates: ["pending", "processing"],
      resolveState: () => "shipped"
    })
  );

  const outcome = await engine.evaluate({ action: "cancel_order" });
  assert.equal(outcome.result, "REJECT");
  if (outcome.result === "REJECT") assert.equal(outcome.code, "INVALID_STATE");
});

test("stateRule — passes when in allowed state", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    stateRule({
      name: "order-state",
      allowedStates: ["pending", "processing"],
      resolveState: () => "pending"
    })
  );

  const outcome = await engine.evaluate({ action: "cancel_order" });
  assert.equal(outcome.result, "APPROVE");
});

// ---------------------------------------------------------------------------
// Built-in rules — constraintRule
// ---------------------------------------------------------------------------

test("constraintRule — rejects when constraint is violated", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    constraintRule({
      name: "no-weekend-deletes",
      check() { return false; },
      message: "Deletions are not allowed on weekends."
    })
  );

  const outcome = await engine.evaluate({ action: "delete" });
  assert.equal(outcome.result, "REJECT");
  if (outcome.result === "REJECT") {
    assert.equal(outcome.reason, "Deletions are not allowed on weekends.");
    assert.equal(outcome.code, "CONSTRAINT_VIOLATED");
  }
});

// ---------------------------------------------------------------------------
// Built-in rules — confirmationRule
// ---------------------------------------------------------------------------

test("confirmationRule — asks user when required", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    confirmationRule({
      name: "confirm-delete",
      requires: () => true,
      question: "Are you sure you want to delete this?",
      expectedInput: "yes / no"
    })
  );

  const outcome = await engine.evaluate({ action: "delete" });
  assert.equal(outcome.result, "ASK_USER");
  if (outcome.result === "ASK_USER") {
    assert.equal(outcome.question, "Are you sure you want to delete this?");
    assert.equal(outcome.expectedInput, "yes / no");
  }
});

test("confirmationRule — passes when not required", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    confirmationRule({
      requires: () => false,
      question: "Are you sure?"
    })
  );

  const outcome = await engine.evaluate({ action: "delete" });
  assert.equal(outcome.result, "APPROVE");
});

// ---------------------------------------------------------------------------
// Built-in rules — escalationRule
// ---------------------------------------------------------------------------

test("escalationRule — escalates when required", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    escalationRule({
      name: "high-value",
      requires: () => true,
      to: "finance-manager",
      reason: "Order total exceeds threshold."
    })
  );

  const outcome = await engine.evaluate({ action: "cancel_order" });
  assert.equal(outcome.result, "ESCALATE");
  if (outcome.result === "ESCALATE") {
    assert.equal(outcome.to, "finance-manager");
  }
});

// ---------------------------------------------------------------------------
// Built-in rules — rateLimitRule
// ---------------------------------------------------------------------------

test("rateLimitRule — rejects when over limit", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    rateLimitRule({
      check: () => false,
      message: "Rate limit exceeded."
    })
  );

  const outcome = await engine.evaluate({ action: "search" });
  assert.equal(outcome.result, "REJECT");
  if (outcome.result === "REJECT") {
    assert.equal(outcome.code, "RATE_LIMIT_EXCEEDED");
  }
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

test("audit log records every evaluation", async () => {
  const engine = createDecisionEngine({ name: "test-engine", audit: true });
  engine.addRule(
    permissionRule({ check: () => false })
  );

  await engine.evaluate({ action: "a" });
  await engine.evaluate({ action: "b" });

  assert.equal(engine.auditLog.size, 2);
});

test("audit log filterByAction", async () => {
  const engine = createDecisionEngine();
  await engine.evaluate({ action: "cancel_order" });
  await engine.evaluate({ action: "view_order" });
  await engine.evaluate({ action: "cancel_order" });

  const cancelEntries = engine.auditLog.filterByAction("cancel_order");
  assert.equal(cancelEntries.length, 2);
});

test("audit log filterByOutcome", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    permissionRule({ actions: ["delete"], check: () => false })
  );

  await engine.evaluate({ action: "view" });    // APPROVE
  await engine.evaluate({ action: "delete" });  // REJECT

  assert.equal(engine.auditLog.filterByOutcome("APPROVE").length, 1);
  assert.equal(engine.auditLog.filterByOutcome("REJECT").length, 1);
});

test("audit log records decidingRule", async () => {
  const engine = createDecisionEngine();
  engine.addRule(
    permissionRule({ name: "my-check", check: () => false })
  );

  await engine.evaluate({ action: "do_it" });
  const entry = engine.auditLog.entries[0];
  assert.ok(entry !== undefined);
  assert.equal(entry.decidingRule, "my-check");
});

test("audit log records rulesEvaluated in order", async () => {
  const engine = createDecisionEngine();
  engine
    .addRule({ name: "rule-a", evaluate: () => undefined })
    .addRule({ name: "rule-b", evaluate: () => undefined })
    .addRule({ name: "rule-c", evaluate: () => ({ result: "REJECT", reason: "no", code: "X" }) });

  await engine.evaluate({ action: "x" });
  const entry = engine.auditLog.entries[0];
  assert.ok(entry !== undefined);
  assert.deepEqual(entry.rulesEvaluated, ["rule-a", "rule-b", "rule-c"]);
});

test("audit log clear() empties entries", async () => {
  const engine = createDecisionEngine();
  await engine.evaluate({ action: "x" });
  assert.equal(engine.auditLog.size, 1);
  engine.auditLog.clear();
  assert.equal(engine.auditLog.size, 0);
});

test("audit disabled — log stays empty", async () => {
  const engine = createDecisionEngine({ audit: false });
  await engine.evaluate({ action: "x" });
  assert.equal(engine.auditLog.size, 0);
});

// ---------------------------------------------------------------------------
// Async rules
// ---------------------------------------------------------------------------

test("async rule — awaits result", async () => {
  const engine = createDecisionEngine();
  engine.addRule({
    name: "async-check",
    async evaluate() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { result: "REJECT", reason: "Async blocked.", code: "ASYNC" };
    }
  });

  const outcome = await engine.evaluate({ action: "x" });
  assert.equal(outcome.result, "REJECT");
});

// ---------------------------------------------------------------------------
// setContext / setKnowledge / extras
// ---------------------------------------------------------------------------

test("setContext makes context available to rules", async () => {
  const engine = createDecisionEngine();
  engine.setContext({ appName: "shop" });

  let receivedContext;
  engine.addRule({
    name: "ctx-inspector",
    evaluate(ctx) {
      receivedContext = ctx.context;
      return undefined;
    }
  });

  await engine.evaluate({ action: "x" });
  assert.deepEqual(receivedContext, { appName: "shop" });
});

test("extras passed per-evaluate are available to rules", async () => {
  const engine = createDecisionEngine();
  let receivedExtras;
  engine.addRule({
    name: "extras-inspector",
    evaluate(ctx) {
      receivedExtras = ctx.extras;
      return undefined;
    }
  });

  await engine.evaluate({ action: "x" }, { extras: { db: "mock-db" } });
  assert.deepEqual(receivedExtras, { db: "mock-db" });
});

// ---------------------------------------------------------------------------
// Multi-rule pipeline (integration)
// ---------------------------------------------------------------------------

test("full pipeline: permission → state → constraint → APPROVE", async () => {
  const engine = createDecisionEngine({ name: "order-pipeline" });

  engine
    .addRule(permissionRule({
      name: "owner-only",
      actions: ["cancel_order"],
      check: ({ intent }) => intent.actor === "user_1"
    }))
    .addRule(stateRule({
      name: "cancellable-state",
      actions: ["cancel_order"],
      allowedStates: ["pending", "processing"],
      resolveState: () => "pending"
    }))
    .addRule(constraintRule({
      name: "not-a-weekend",
      actions: ["cancel_order"],
      check: () => true, // constraint satisfied
      message: "No weekend ops."
    }));

  const outcome = await engine.evaluate({
    action: "cancel_order",
    actor: "user_1",
    target: "order_42"
  });

  assert.equal(outcome.result, "APPROVE");
  assert.equal(engine.auditLog.size, 1);
  const entry = engine.auditLog.entries[0];
  assert.ok(entry !== undefined);
  assert.deepEqual(entry.rulesEvaluated, ["owner-only", "cancellable-state", "not-a-weekend"]);
});

test("full pipeline: blocked at permission stage", async () => {
  const engine = createDecisionEngine({ name: "order-pipeline" });

  engine
    .addRule(permissionRule({
      name: "owner-only",
      actions: ["cancel_order"],
      check: ({ intent }) => intent.actor === "user_1"
    }))
    .addRule(stateRule({
      name: "cancellable-state",
      actions: ["cancel_order"],
      allowedStates: ["pending"],
      resolveState: () => "pending"
    }));

  const outcome = await engine.evaluate({
    action: "cancel_order",
    actor: "user_2", // wrong actor
    target: "order_42"
  });

  assert.equal(outcome.result, "REJECT");
  if (outcome.result === "REJECT") {
    assert.equal(outcome.rule, "owner-only");
  }
  // State rule should never have run
  const entry = engine.auditLog.entries[0];
  assert.ok(entry !== undefined);
  assert.deepEqual(entry.rulesEvaluated, ["owner-only"]);
});

# @nexo-alpha/decision

> **AI can propose an action. It cannot authorize the action.**

The DECIDE layer of Nexo Alpha. A deterministic, rule-based decision engine that sits between LLM intent parsing and tool execution.

## Install

```bash
npm install @nexo-alpha/decision
```

## Why

Most AI agent frameworks do this:

```
LLM → Tool → Execute
```

No checks. No rules. No control. The LLM decides and the system executes.

Nexo Alpha draws a hard architectural boundary:

```
             AI WORLD
─────────────────────────────────────
LLM understands intent
 ↓
DecisionIntent   ← the handoff point
─────────────────────────────────────
          CONTROLLED WORLD
Decision Engine runs your rules
 ↓
APPROVE / REJECT / ASK_USER / ESCALATE / DEFER
 ↓
Tool executes (only on APPROVE)
 ↓
Result is verified
```

The LLM only ever touches the top half. Everything below the line is deterministic, auditable, and under your control.

---

## Quick start

```ts
import {
  createDecisionEngine,
  permissionRule,
  stateRule
} from "@nexo-alpha/decision";

const engine = createDecisionEngine({ name: "order-actions" });

engine
  .addRule(permissionRule({
    name: "owner-only",
    actions: ["cancel_order"],
    check: ({ intent }) => intent.actor === intent.payload?.ownerId,
    message: "You can only cancel your own orders.",
  }))
  .addRule(stateRule({
    name: "cancellable-state",
    actions: ["cancel_order"],
    allowedStates: ["pending", "processing"],
    async resolveState({ intent }) {
      const order = await db.orders.findById(intent.target);
      return order?.status;
    },
  }));

// LLM parsed the user's request into this intent:
const outcome = await engine.evaluate({
  action: "cancel_order",
  actor: userId,
  target: orderId,
  payload: { ownerId: order.userId }
});

if (outcome.result === "APPROVE") {
  await cancelOrder(orderId);
} else if (outcome.result === "REJECT") {
  console.error(outcome.reason); // "You can only cancel your own orders."
} else if (outcome.result === "ASK_USER") {
  // Surface outcome.question to the user
} else if (outcome.result === "ESCALATE") {
  // Route to outcome.to for approval
}
```

---

## Concepts

### DecisionIntent

What the LLM understood the user to want, in structured form:

```ts
interface DecisionIntent {
  action: string;          // e.g. "cancel_order"
  actor?: string;          // who is requesting it
  target?: string;         // the primary entity being acted on
  payload?: Record<string, unknown>;   // action-specific data
  metadata?: Record<string, unknown>;  // request context (IP, session, etc.)
}
```

### DecisionOutcome

Five possible results:

| Result | Meaning |
|---|---|
| `APPROVE` | All rules passed — proceed to execute. |
| `REJECT` | A rule blocked the action — do not execute. |
| `ASK_USER` | More information is needed from the user. |
| `ESCALATE` | A higher authority must approve before proceeding. |
| `DEFER` | The action is valid but should not execute right now. |

### DecisionRule

A rule is just an object with a `name` and an `evaluate` function. Return a `DecisionOutcome` to halt evaluation, or return `undefined`/`null` to pass through ("no opinion"):

```ts
const myRule: DecisionRule = {
  name: "my-custom-rule",
  kind: "constraint",            // optional, for audit categorisation
  appliesTo(ctx) {               // optional fast-path guard
    return ctx.intent.action === "delete_user";
  },
  evaluate(ctx) {
    if (someCondition(ctx.intent)) {
      return { result: "REJECT", reason: "Not allowed.", code: "CUSTOM_BLOCK" };
    }
    return undefined; // pass through
  }
};
```

Rules are evaluated in registration order. The first rule to return an outcome halts the chain. If no rule returns an outcome, `APPROVE` is the default.

---

## Built-in rule factories

### `permissionRule`

Rejects when the actor does not have permission:

```ts
engine.addRule(permissionRule({
  name: "admin-only",
  actions: ["delete_user"],
  check: ({ intent }) => isAdmin(intent.actor),
  message: "Only administrators can delete users.",
  code: "ADMIN_REQUIRED"
}));
```

### `stateRule`

Rejects when the target entity is not in an allowed state:

```ts
engine.addRule(stateRule({
  name: "order-must-be-cancellable",
  actions: ["cancel_order"],
  allowedStates: ["pending", "processing"],
  async resolveState({ intent }) {
    return (await db.orders.findById(intent.target))?.status;
  },
  invalidStateMessage: (s) => `Cannot cancel an order that is "${s}".`
}));
```

### `constraintRule`

Rejects when a business policy is violated:

```ts
engine.addRule(constraintRule({
  name: "no-cancel-near-delivery",
  actions: ["cancel_order"],
  async check({ intent }) {
    const order = await db.orders.findById(intent.target);
    const hoursLeft = ((order?.estimatedDelivery ?? 0) - Date.now()) / 3_600_000;
    return hoursLeft > 1;
  },
  message: "Orders cannot be cancelled within 1 hour of estimated delivery."
}));
```

### `confirmationRule`

Returns `ASK_USER` when the action requires explicit confirmation:

```ts
engine.addRule(confirmationRule({
  name: "confirm-delete-account",
  actions: ["delete_account"],
  requires: () => true,
  question: "This will permanently delete your account and all data. Are you sure?",
  expectedInput: "yes / no"
}));
```

### `escalationRule`

Returns `ESCALATE` when a higher authority is required:

```ts
engine.addRule(escalationRule({
  name: "high-value-refund",
  actions: ["issue_refund"],
  async requires({ intent }) {
    return (intent.payload?.amount as number ?? 0) > 500;
  },
  to: "finance-manager",
  reason: "Refunds over $500 require manager approval."
}));
```

### `rateLimitRule`

Rejects when the actor has exceeded a rate limit:

```ts
engine.addRule(rateLimitRule({
  name: "cancel-order-rate-limit",
  actions: ["cancel_order"],
  async check({ intent }) {
    return await limiter.isAllowed(intent.actor ?? "anonymous");
  },
  message: "Too many requests. Please wait before trying again."
}));
```

---

## Audit log

Every evaluation is recorded automatically (opt-out with `audit: false`):

```ts
const engine = createDecisionEngine({ audit: true }); // default

await engine.evaluate({ action: "cancel_order", actor: "user_1" });

console.log(engine.auditLog.entries);
// [{
//   timestamp: "2026-09-24T...",
//   intent: { action: "cancel_order", actor: "user_1" },
//   outcome: { result: "APPROVE" },
//   rulesEvaluated: ["owner-only", "cancellable-state"],
//   decidingRule: undefined,   // undefined = reached APPROVE by exhaustion
//   durationMs: 3
// }]

engine.auditLog.filterByOutcome("REJECT"); // entries where something was blocked
engine.auditLog.filterByAction("cancel_order"); // entries for a specific action
engine.auditLog.clear(); // reset
```

---

## Integration with `@nexo-alpha/context`

Pass the application context and knowledge into the engine so rules can read them:

```ts
import { buildContext, createKnowledge } from "@nexo-alpha/context";

const knowledge = createKnowledge();
knowledge.addConstraint({
  description: "Orders over $10,000 require manager approval.",
  reason: "Finance policy 2024-Q1"
});

const context = buildContext(app, knowledge);

// Make them available to every rule on this engine:
engine
  .setContext(context as unknown as Record<string, unknown>)
  .setKnowledge(knowledge as unknown as Record<string, unknown>);
```

Or pass per-evaluation extras (e.g. a live DB client):

```ts
await engine.evaluate(intent, { extras: { db } });
// ctx.extras.db is available inside every rule
```

---

## Architecture position

```
NEXO ALPHA: UNDERSTAND → KNOW → DECIDE → ACT → VERIFY
                                   ↑
                      @nexo-alpha/decision lives here
```

```
@nexo-alpha/decision
        │
        ├── depends on @nexo-alpha/core     (NexoApplication types)
        ├── depends on @nexo-alpha/context  (ApplicationContext, ApplicationKnowledge)
        │
        └── consumed by @nexo-alpha/agent   (orchestrates all 5 layers)
```

`@nexo-alpha/decision` has **no LLM dependency** and no runtime I/O of its own. It is a pure evaluation engine. What I/O rules perform (database lookups, permission service calls) is entirely under application control.

---

## Status

**0.4.1.** Core engine, 6 built-in rule factories, and audit log are complete and integrated with [`@nexo-alpha/agent`](../agent/README.md) to form the DECIDE safety boundary in the 5-layer intelligence stack (`UNDERSTAND → KNOW → DECIDE → ACT → VERIFY`).

## License

MIT


MIT

# @nexo-alpha/agent

> AI agent and autonomous workflow orchestration layer for the Nexo framework.

`@nexo-alpha/agent` connects the complete 5-layer Nexo intelligence stack:
**`UNDERSTAND ──► KNOW ──► DECIDE ──► ACT ──► VERIFY`**

It enforces safety boundaries around AI actions: an LLM or user can propose an intent, but the deterministic [Decision Engine](https://www.npmjs.com/package/@nexo-alpha/decision) must approve it before any tool runs, and every execution is verified and audited.

---

## Installation

```bash
npm install @nexo-alpha/agent @nexo-alpha/decision @nexo-alpha/context @nexo-alpha/core
```

Or using pnpm:

```bash
pnpm add @nexo-alpha/agent @nexo-alpha/decision @nexo-alpha/context @nexo-alpha/core
```

---

## The 5-Layer Stack

```text
┌────────────────────────────────────────────────────────┐
│ 1. UNDERSTAND                                          │
│    Parses user natural language into a DecisionIntent  │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. KNOW                                                │
│    Enriches intent with ApplicationKnowledge / Context │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. DECIDE                                              │
│    Deterministic Decision Engine evaluates rules       │
│    (APPROVE / REJECT / ASK_USER / ESCALATE / DEFER)    │
└───────────────────────────┬────────────────────────────┘
                            ▼ (Only if APPROVED)
┌────────────────────────────────────────────────────────┐
│ 4. ACT                                                 │
│    ToolRegistry executes the target action handler     │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 5. VERIFY                                              │
│    VerifierRegistry validates the output state         │
└────────────────────────────────────────────────────────┘
```

---

## How to Use

### 1. Creating an Agent

Combine a `DecisionEngine` and optional `ApplicationKnowledge` into an agent:

```ts
import { createAgent } from "@nexo-alpha/agent";
import { createDecisionEngine, permissionRule } from "@nexo-alpha/decision";
import { createKnowledge } from "@nexo-alpha/context";

// 1. Create your decision engine with safety rules
const decisionEngine = createDecisionEngine({ name: "support-safety" });

decisionEngine.addRule(permissionRule({
  name: "support-only",
  actions: ["cancel_order", "refund_order"],
  check: ({ intent }) => intent.actor !== undefined,
  message: "Actor must be specified."
}));

// 2. Initialize the agent
export const agent = createAgent({
  name: "support-agent",
  decisionEngine,
  knowledge: createKnowledge()
});
```

---

### 2. Registering Tools (`ToolRegistry`)

Register tools that execute the approved actions:

```ts
agent.tools.register({
  name: "cancel_order",
  description: "Cancels an order in the database",
  execute: async ({ intent }) => {
    const orderId = intent.target;
    // Perform database cancellation
    return { orderId, status: "cancelled", cancelledAt: new Date().toISOString() };
  }
});

agent.tools.register({
  name: "send_email",
  description: "Sends an email notification",
  execute: async ({ intent }) => {
    return { sent: true, to: intent.payload?.to };
  }
});
```

---

### 3. Registering Verifiers (`VerifierRegistry`)

Validate that executed actions met expectations:

```ts
agent.verifiers.register({
  action: "cancel_order",
  verify: async ({ toolResult }) => {
    const data = toolResult.data as { status?: string };
    if (data?.status === "cancelled") {
      return { status: "PASS", message: "Order cancellation confirmed." };
    }
    return { status: "FAIL", message: "Order was not marked as cancelled." };
  }
});
```

---

### 4. Executing Single Intent (`agent.execute`)

Execute a structured `DecisionIntent` through the pipeline:

```ts
const record = await agent.execute({
  action: "cancel_order",
  actor: "support_agent_01",
  target: "ord_555",
  payload: { reason: "Customer request" }
});

console.log("Execution status:", record.status); // "SUCCESS" | "BLOCKED" | "FAILED"
console.log("Execution ID:", record.executionId);
console.log("Audit logs:", agent.auditLog.getEntries());
```

---

### 5. Running Natural Language Commands (`agent.run`)

Parse human text into an intent, verify rules, and execute:

```ts
import { createSimpleIntentParser } from "@nexo-alpha/agent";

// Define a simple pattern-based parser (or hook in an LLM parser)
const parser = createSimpleIntentParser([
  {
    pattern: /cancel order (\w+)/i,
    map: (match) => ({
      action: "cancel_order",
      target: match[1]
    })
  }
]);

const record = await agent.run("Please cancel order ord_789", { parser });
console.log(record.status); // "SUCCESS"
```

---

### 6. Autonomous Multi-Step Workflows (`createWorkflow`)

Orchestrate complex, multi-step goals with safety limits, human interruption, and pause/resumption:

```ts
import { createWorkflow } from "@nexo-alpha/agent";

const workflow = createWorkflow({
  name: "order-return-flow",
  agent,
  maxSteps: 5,
  allowedActions: ["verify_order", "cancel_order", "issue_refund", "send_email"]
});

// Run workflow to achieve a goal
const state = await workflow.run({
  goal: "Cancel order ord_123 and refund the customer",
  initialContext: { orderId: "ord_123", customerEmail: "user@example.com" }
});

console.log("Workflow Status:", state.status); // "COMPLETED" | "WAITING" | "FAILED"
```

#### Human-in-the-Loop Resumption

If a rule returns `ASK_USER` or `ESCALATE`, the workflow safely pauses with status `WAITING` or `ESCALATED`:

```ts
if (state.status === "WAITING") {
  console.log("Workflow is waiting for human response:", state.pendingDecision?.question);

  // Resume the workflow after receiving human answer
  const resumedState = await workflow.resume(state.id, {
    action: "approve_cancellation",
    answer: "yes"
  });
}
```

---

### 7. Behavior-Guided Web Research (`agent.research`)

Run an integrated research pipeline that searches the web, extracts snippets, verifies claims using bounded behavior policies, and saves findings into `ApplicationKnowledge`:

```ts
const researchResult = await agent.research("Latest security advisories for Node.js 22", {
  maxSources: 5
});

console.log(`Retrieved ${researchResult.totalRetrieved} sources, verified ${researchResult.totalVerified}.`);
```

---

## Related Packages

- [`@nexo-alpha/decision`](https://www.npmjs.com/package/@nexo-alpha/decision) — Deterministic decision engine powering safety checks.
- [`@nexo-alpha/behavior`](https://www.npmjs.com/package/@nexo-alpha/behavior) — Bounded micro-decisions and policy primitives.
- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — Application knowledge and manifest container.
- [`@nexo-alpha/web`](https://www.npmjs.com/package/@nexo-alpha/web) — Web search and evidence pipeline.

---

## License

MIT © Nexo Contributors

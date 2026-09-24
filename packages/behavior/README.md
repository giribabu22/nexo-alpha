# @nexo-alpha/behavior

> Typed bounded behavior layer and micro-decision primitives for the Nexo framework.

`@nexo-alpha/behavior` eliminates unnecessary, expensive, and non-deterministic LLM calls by structuring agent cognition into **bounded micro-decisions**. Instead of asking an LLM open-ended questions, decisions are framed as constrained atomic primitives (`choice`, `score`, `boolean`) evaluated against clear policies with full telemetry tracking.

---

## Installation

```bash
npm install @nexo-alpha/behavior
```

Or using pnpm:

```bash
pnpm add @nexo-alpha/behavior
```

---

## Why Bounded Behavior?

Most AI frameworks rely on heavyweight generative models for every branching decision:

```text
Unbounded LLM (500-1500 tokens, 1200ms, non-deterministic)
```

Nexo frames micro-decisions with bounded constraints:

```text
Bounded Primitive (10-50 tokens or zero-cost local heuristics, <10ms, deterministic)
```

This saves up to **90% of token usage and latency** while guaranteeing consistent execution.

---

## How to Use

### 1. Atomic Primitives

Nexo provides 3 foundational primitives for micro-decisions:

```ts
import { choice, score, boolean } from "@nexo-alpha/behavior";

// 1. Choice: pick exactly one option from an allowed set
const actionChoice = choice(
  ["continue", "retry", "escalate"] as const,
  "Determine next step given current error"
);

// 2. Score: numeric confidence or relevance score in a bounded range
const confidenceScore = score({
  min: 0,
  max: 1,
  description: "Confidence in retrieved search snippet relevance"
});

// 3. Boolean: binary yes/no decision
const isGoalSatisfied = boolean("Is the user request fully satisfied?");
```

---

### 2. Evaluating Decisions with `BehaviorEngine`

The `BehaviorEngine` evaluates questions against a provided state:

```ts
import { BehaviorEngine, LocalBehaviorProvider } from "@nexo-alpha/behavior";

const engine = new BehaviorEngine({
  provider: new LocalBehaviorProvider()
});

const response = await engine.decide({
  state: {
    retries: 2,
    lastError: "Connection timeout",
    elapsedMs: 1400
  },
  questions: {
    nextAction: choice(["retry", "fail", "escalate"] as const),
    confidence: score({ min: 0, max: 1 })
  }
});

console.log(response.answers.nextAction); // "retry"
console.log(response.metrics);           // { durationMs, savedGenerativeTokens, ... }
```

---

### 3. Built-in Behavior Policies

Nexo provides pre-packaged policies for the most common agent branching scenarios:

#### Route Policy
Routes execution to one candidate among multiple branches:

```ts
const route = await engine.routePolicy({
  candidates: ["payment_service", "inventory_service", "support_service"],
  state: { task: "Check product availability in warehouse" }
});

console.log("Selected route:", route.selected); // "inventory_service"
```

#### Verify Policy
Evaluates whether an operation's output meets acceptance criteria:

```ts
const verification = await engine.verifyPolicy({
  criteria: "The order status must be marked as 'shipped' with a valid tracking number",
  actual: { status: "shipped", trackingNumber: "TRK_991823" }
});

console.log("Passed:", verification.passed);       // true
console.log("Confidence:", verification.confidence); // 0.98
```

#### Retry Policy
Determines whether a failed step should retry or abort:

```ts
const retryDecision = await engine.retryPolicy({
  error: new Error("ETIMEDOUT"),
  attempt: 2,
  maxAttempts: 3
});

console.log("Should retry:", retryDecision.shouldRetry); // true
console.log("Backoff ms:", retryDecision.backoffMs);    // 1000
```

#### Complete Policy
Checks if a multi-step agent goal is satisfied:

```ts
const completion = await engine.completePolicy({
  goal: "Cancel order ord_123 and notify customer",
  history: [
    { action: "cancel_order", status: "SUCCESS" },
    { action: "send_email", status: "SUCCESS" }
  ]
});

console.log("Completed:", completion.isComplete);
```

---

### 4. Telemetry & Cost Measurement

`BehaviorEngine` tracks every decision's latency, token savings, and estimated cost:

```ts
const metrics = engine.getMetrics();

console.log(`Evaluated ${metrics.totalDecisions} decisions.`);
console.log(`Total duration: ${metrics.totalDurationMs}ms`);
console.log(`Estimated generative tokens saved: ${metrics.totalSavedGenerativeTokens}`);
```

---

## Related Packages

- [`@nexo-alpha/agent`](https://www.npmjs.com/package/@nexo-alpha/agent) — Uses `BehaviorEngine` to guide agent routing, retries, and goal verification.
- [`@nexo-alpha/decision`](https://www.npmjs.com/package/@nexo-alpha/decision) — Deterministic rule-based authorization engine.

---

## License

MIT © Nexo Contributors

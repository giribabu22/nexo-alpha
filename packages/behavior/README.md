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

An open-ended prompt ("what should the agent do next?") gets an open-ended answer that the code then has to interpret. A bounded question gets an answer the code can use directly:

- `choice(["retry", "fail", "escalate"])`: exactly one of these options;
- `score({ min: 0, max: 1 })`: a number in that range;
- `boolean("Is the order shipped?")`: `true` or `false`.

Every answer also carries a `confidence` between 0 and 1. The engine checks each answer against its question, so an answer outside its bounds is never acted on (see [Answers are checked](#3-answers-are-checked)). Questions are short, which keeps prompts small.

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

The `BehaviorEngine` sends questions about a state to a provider. `LocalBehaviorProvider` answers them in-process with your evaluator:

```ts
import { BehaviorEngine, LocalBehaviorProvider } from "@nexo-alpha/behavior";

const engine = new BehaviorEngine({
  provider: new LocalBehaviorProvider((key, question, state) =>
    key === "nextAction"
      ? { value: state.retries < 3 ? "retry" : "escalate", confidence: 1 }
      : { value: 1, confidence: 1 }
  )
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

console.log(response.results.nextAction.value); // "retry"
console.log(response.metrics);                  // { durationMs, savedGenerativeTokens, ... }
```

**No provider means no answers.** An engine created without a provider, and a `LocalBehaviorProvider` without an evaluator, leave every question unanswered. The policies then report that they don't know: `verify` returns `"uncertain"`, `retry` returns `false` and `escalate` returns `true`, each with confidence `0`. They never act on an invented answer. `JevBehaviorProvider` needs an `endpoint` and an `apiKey`, and it throws when the endpoint fails.

---

### 3. Answers are checked

`decide()` keeps an answer only if it fits its question: an option of a `choice`, a finite number within a `score`'s `min`/`max`, an actual boolean for a `boolean` (not the string `"false"`), with a `confidence` between 0 and 1. Anything else, including answers to questions that weren't asked, is dropped and counts as unanswered. So a provider that returns a made-up option or a malformed value gets the same treatment as one that returns nothing.

---

### 4. Built-in Behavior Policies

Each policy asks the provider a fixed set of bounded questions and turns the answers into a result. When the provider doesn't answer (or its answer doesn't fit), the result says so with `confidence: 0` and a cautious value.

#### Route
Chooses one candidate:

```ts
const route = await engine.route({
  candidates: ["payment_service", "inventory_service", "support_service"],
  state: { task: "Check product availability in warehouse" }
});

route.selected;   // e.g. "inventory_service"
route.confidence; // 0 when the provider didn't choose: `selected` is then only the first candidate
```

#### Verify
Checks an output against what was expected:

```ts
const verification = await engine.verify({
  expected: "The order is marked 'shipped' with a tracking number",
  actual: { status: "shipped", trackingNumber: "TRK_991823" }
});

verification.status;     // "verified" | "failed" | "uncertain" (no answer: "uncertain")
verification.confidence;
```

#### Retry
Decides whether a failed step should run again:

```ts
const decision = await engine.retry({
  error: new Error("ETIMEDOUT"),
  attempt: 2,
  maxAttempts: 3
});

decision.retry;    // false once attempt >= maxAttempts, and when there is no answer
decision.strategy; // "backoff" | "immediate" | "fallback"
```

#### Complete
Checks whether a goal is reached:

```ts
const completion = await engine.complete({
  goal: "Cancel order ord_123 and notify the customer",
  history: [
    { action: "cancel_order", status: "SUCCESS" },
    { action: "send_email", status: "SUCCESS" }
  ]
});

completion.status; // "COMPLETE" | "IN_PROGRESS" | "VERIFY_MORE" | "BLOCKED" | "FAILED" | "ESCALATE" (no answer: "IN_PROGRESS")
```

#### Escalate
Decides whether a person should review:

```ts
const escalation = await engine.escalate({ state: { refundAmount: 5000 }, confidenceThreshold: 0.9 });

escalation.escalate; // true when there is no answer
escalation.action;   // "ACT" | "REVIEW" | "HUMAN_ESCALATE"
```

The same policies are also exported as functions that take a provider: `route(options, provider)`, `verify(…)`, `retry(…)`, `complete(…)`, `escalate(…)`.

---

### 5. Telemetry

`BehaviorEngine` records each evaluation:

```ts
const metrics = engine.getMetrics();

metrics.totalEvaluations;     // decide() calls, including those made by policies
metrics.totalQuestions;
metrics.totalDurationMs;
metrics.estimatedSavedTokens; // an estimate; only answered questions count
metrics.providerCounts;       // evaluations per provider name
```

---

## Related Packages

- [`@nexo-alpha/agent`](https://www.npmjs.com/package/@nexo-alpha/agent) — Uses `BehaviorEngine` to guide agent routing, retries, and goal verification.
- [`@nexo-alpha/decision`](https://www.npmjs.com/package/@nexo-alpha/decision) — Deterministic rule-based authorization engine.

---

## License

MIT © Nexo Contributors

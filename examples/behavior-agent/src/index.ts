import { createKnowledge } from "@nexo-alpha/context";
import { createDecisionEngine, permissionRule } from "@nexo-alpha/decision";
import { LocalBehaviorProvider, type DecisionResult } from "@nexo-alpha/behavior";
import { createAgent } from "@nexo-alpha/agent";
import { MockWebSearchProvider } from "@nexo-alpha/web";

/**
 * Stand-in for a model-backed provider (e.g. JevBehaviorProvider with an
 * endpoint and apiKey): answers each bounded question with a visible keyword
 * heuristic, so the demo runs offline and its answers are explainable.
 */
const demoJudge = new LocalBehaviorProvider((key, question, state): DecisionResult => {
  const text = JSON.stringify(state).toLowerCase();
  switch (key) {
    case "target": // route(): pick the candidate whose topic appears in the state
      return {
        value: text.includes("react") || text.includes("error") ? "technical-agent" : question.options[0],
        confidence: 0.8,
        explanation: "keyword match"
      };
    case "matches": // verify(): evidence mentions the query's subject
      return { value: text.includes("react"), confidence: 0.8, explanation: "mentions React" };
    case "quality":
      return { value: 0.8, confidence: 0.8 };
    case "status": // complete(): any verified evidence is enough for this demo
      return { value: text.includes("react") ? "COMPLETE" : "VERIFY_MORE", confidence: 0.8 };
    default:
      return { value: false, confidence: 0, explanation: "not handled by the demo judge" };
  }
});

async function main() {
  console.log("=== Nexo Bounded Behavior & Agent Runtime Demo ===\n");

  // 1. Initialize Application Knowledge Journal
  const knowledge = createKnowledge();

  // 2. Build Decision Engine with Rules
  const decisionEngine = createDecisionEngine({ name: "support-decision-engine" });
  decisionEngine.addRule(
    permissionRule({
      name: "authorized-operators",
      actions: ["process_ticket"],
      check: ({ intent }) => intent.actor === "operator_1"
    })
  );

  // 3. Create NexoAgent with a behavior provider
  const agent = createAgent({
    name: "support-agent",
    decisionEngine,
    knowledge,
    behaviorProvider: demoJudge
  });

  // Register Tool Handler
  agent.tools.register({
    action: "process_ticket",
    async execute({ intent }) {
      return {
        success: true,
        data: { ticketId: intent.target, status: "PROCESSED" },
        durationMs: 15
      };
    }
  });

  // 4. Perform Behavior-Guided Web Research
  console.log("1. Executing Web Research (Search ➔ Extract ➔ Behavior Verification)...");
  // MockWebSearchProvider returns fixed example.com results; use a real WebSearchProvider in production.
  const researchResult = await agent.research("What changed in React 20?", { provider: new MockWebSearchProvider() });
  console.log(`   Query: "${researchResult.query}"`);
  console.log(`   Retrieved: ${researchResult.totalRetrieved} items, Verified: ${researchResult.totalVerified} items.`);
  console.log(`   Status: ${researchResult.status}\n`);

  // 5. Evaluate Bounded Route Decision
  console.log("2. Evaluating Bounded Route Decision via Behavior Layer...");
  const route = await agent.behavior.route(["billing-agent", "technical-agent", "sales-agent"], {
    ticket: "React hydration issue"
  });
  console.log(`   Selected Route: ${route ?? "(the judge did not choose)"}\n`);

  // 6. Execute Intent through DECIDE ➔ ACT ➔ VERIFY ➔ AUDIT
  console.log("3. Executing Agent Intent...");
  const record = await agent.execute({
    action: "process_ticket",
    actor: "operator_1",
    target: "ticket_991"
  });
  console.log(`   Status: ${record.status}`);
  console.log(`   Duration: ${record.totalDurationMs}ms\n`);

  // 7. Inspect Telemetry & Estimated Token Savings
  console.log("4. Telemetry & Cost Measurements:");
  const metrics = agent.behavior.engine.getMetrics();
  console.log(`   Total Behavior Evaluations: ${metrics.totalEvaluations}`);
  console.log(`   Total Bounded Questions: ${metrics.totalQuestions}`);
  console.log(`   Estimated Token Savings: ~${metrics.estimatedSavedTokens} tokens\n`);

  // 8. Inspect Knowledge History Journal
  console.log("5. Application Knowledge History Journal:");
  for (const entry of knowledge.getHistory()) {
    console.log(`   - [${entry.result.toUpperCase()}] ${entry.operation} on '${entry.target ?? "n/a"}' (${entry.detail})`);
  }
}

main().catch(console.error);

import type { DecisionEngine, DecisionIntent, DecisionOutcome } from "@nexo-alpha/decision";
import type { ApplicationKnowledge } from "@nexo-alpha/context";
import { BehaviorEngine, BehaviorProvider, createBehaviorEngine } from "@nexo-alpha/behavior";
import { research as executeWebResearch, type ResearchOptions, type ResearchResult } from "@nexo-alpha/web";
import {
  appendExecutionRecord,
  createExecutionAuditLog,
  generateExecutionId,
  type ExecutionAuditLog,
  type ExecutionRecord,
  type ExecutionStatus
} from "./audit.js";
import { createToolRegistry, type NexoTool, type ToolRegistry } from "./tool-registry.js";
import { createVerifierRegistry, type ResultVerifier, type VerifierRegistry } from "./verifier.js";
import type { IntentParser, IntentParserOptions } from "./understand.js";

// ---------------------------------------------------------------------------
// Agent options
// ---------------------------------------------------------------------------

export interface AgentOptions {
  readonly name?: string | undefined;
  readonly decisionEngine: DecisionEngine;
  readonly behaviorProvider?: BehaviorProvider | undefined;
  readonly behaviorEngine?: BehaviorEngine | undefined;
  readonly parser?: IntentParser | undefined;
  readonly knowledge?: ApplicationKnowledge | undefined;
  readonly maxRetries?: number | undefined;
  readonly confidenceThreshold?: number | undefined;
  readonly extras?: Readonly<Record<string, unknown>> | undefined;
  /**
   * Receives every execution record (approved, blocked, failed or errored)
   * as it is written — e.g. `createDocumentAuditTrail(store).sink` for a
   * durable audit trail. Awaited in order; errors are ignored so auditing
   * can never block execution.
   */
  readonly auditSink?: ((record: ExecutionRecord) => void | Promise<void>) | undefined;
  /** Records kept in the in-memory `auditLog` (oldest dropped). Default: 10000 */
  readonly maxAuditEntries?: number | undefined;
}

// ---------------------------------------------------------------------------
// Execution options
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  readonly extras?: Readonly<Record<string, unknown>> | undefined;
}

export interface RunOptions extends ExecuteOptions {
  readonly parser?: IntentParser | undefined;
}

// ---------------------------------------------------------------------------
// Layer 3 Agent Behavior Capabilities
// ---------------------------------------------------------------------------

export interface AgentBehaviorCapabilities {
  readonly engine: BehaviorEngine;
  route<T extends string>(candidates: readonly T[], state?: unknown): Promise<T>;
  shouldRetry(error: Error | string, attempt: number, maxAttempts: number): Promise<boolean>;
  checkGoal(goal: string, history?: unknown[]): Promise<string>;
  checkEscalation(state: unknown): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Agent interface
// ---------------------------------------------------------------------------

export interface NexoAgent {
  readonly name: string;
  readonly tools: ToolRegistry;
  readonly verifiers: VerifierRegistry;
  readonly behavior: AgentBehaviorCapabilities;
  readonly auditLog: ExecutionAuditLog;

  execute(intent: DecisionIntent, options?: ExecuteOptions): Promise<ExecutionRecord>;
  run(input: string, options?: RunOptions): Promise<ExecutionRecord>;
  /**
   * Executes a behavior-guided web research pipeline.
   * Searches, extracts evidence, verifies validity using the agent's behavior engine,
   * and records results into ApplicationKnowledge.
   */
  research(query: string, options?: Omit<ResearchOptions, "query">): Promise<ResearchResult>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createAgent(options: AgentOptions): NexoAgent {
  const agentName = options.name ?? "nexo-agent";
  const engine = options.decisionEngine;
  const agentParser = options.parser;
  const knowledge = options.knowledge;
  const maxRetries = options.maxRetries ?? 1;
  const confidenceThreshold = options.confidenceThreshold ?? 0.75;
  const agentExtras = options.extras;

  const behaviorEngine = options.behaviorEngine ?? createBehaviorEngine({
    provider: options.behaviorProvider
  });

  const tools = createToolRegistry();
  const verifiers = createVerifierRegistry();
  const auditLog = createExecutionAuditLog(options.maxAuditEntries ?? 10_000);
  const auditSink = options.auditSink;

  async function recordExecution(intent: DecisionIntent, record: ExecutionRecord): Promise<void> {
    appendExecutionRecord(auditLog, record);
    writeToKnowledge(knowledge, intent, record);
    if (auditSink !== undefined) {
      try {
        await auditSink(record);
      } catch {
        // Auditing is best-effort: a failing sink must not block execution.
      }
    }
  }

  const behavior: AgentBehaviorCapabilities = {
    engine: behaviorEngine,
    async route(candidates, state) {
      const res = await behaviorEngine.route({ candidates, state: state ?? {} });
      return res.selected;
    },
    async shouldRetry(error, attempt, maxAttempts) {
      const res = await behaviorEngine.retry({ error, attempt, maxAttempts });
      return res.retry;
    },
    async checkGoal(goal, history) {
      const res = await behaviorEngine.complete({ goal, history });
      return res.status;
    },
    async checkEscalation(state) {
      const res = await behaviorEngine.escalate({ state, confidenceThreshold });
      return res.escalate;
    }
  };

  async function executeOnce(
    intent: DecisionIntent,
    mergedExtras: Readonly<Record<string, unknown>> | undefined,
    attempt: number
  ): Promise<ExecutionRecord> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const id = generateExecutionId();

    let decision: DecisionOutcome;

    try {
      decision = await engine.evaluate(intent, { extras: mergedExtras });
    } catch (error) {
      const completedAt = new Date().toISOString();
      const record: ExecutionRecord = {
        id,
        startedAt,
        completedAt,
        totalDurationMs: Date.now() - startMs,
        intent,
        decision: { result: "REJECT", reason: "Decision engine threw unexpectedly.", code: "ENGINE_ERROR" },
        attempt,
        status: "ERROR",
        error: error instanceof Error ? error.message : String(error)
      };
      await recordExecution(intent, record);
      return record;
    }

    if (decision.result !== "APPROVE") {
      const record: ExecutionRecord = {
        id,
        startedAt,
        completedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startMs,
        intent,
        decision,
        attempt,
        status: "BLOCKED"
      };
      await recordExecution(intent, record);
      return record;
    }

    const toolResult = await tools.run(intent, mergedExtras);

    const verificationResult = await verifiers.verify({
      intent,
      result: toolResult,
      attempt
    });

    const status: ExecutionStatus = verificationResult.status === "COMPLETE"
      ? "APPROVED_AND_COMPLETE"
      : "APPROVED_AND_FAILED";

    const record: ExecutionRecord = {
      id,
      startedAt,
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - startMs,
      intent,
      decision,
      toolResult,
      verificationResult,
      attempt,
      status
    };

    await recordExecution(intent, record);

    return record;
  }

  const agent: NexoAgent = {
    name: agentName,
    tools,
    verifiers,
    behavior,
    auditLog,

    async execute(intent, callOptions) {
      const mergedExtras: Readonly<Record<string, unknown>> | undefined =
        agentExtras || callOptions?.extras
          ? { ...agentExtras, ...callOptions?.extras }
          : undefined;

      let attempt = 1;
      let record = await executeOnce(intent, mergedExtras, attempt);

      while (
        record.status === "APPROVED_AND_FAILED" &&
        record.verificationResult?.recovery === "RETRY" &&
        attempt < maxRetries
      ) {
        const retryDecision = await behaviorEngine.retry({
          error: record.verificationResult?.reason ?? "Verification failed",
          attempt,
          maxAttempts: maxRetries,
          context: { intent, toolResult: record.toolResult }
        });

        if (!retryDecision.retry) {
          break;
        }

        attempt += 1;
        record = await executeOnce(intent, mergedExtras, attempt);
      }

      return record;
    },

    async run(input, runOptions) {
      const activeParser = runOptions?.parser ?? agentParser;
      if (!activeParser) {
        throw new Error(
          "No IntentParser configured on agent. Pass a parser to createAgent({ parser }) or agent.run(input, { parser }), or use agent.execute(intent) directly."
        );
      }

      const intent = await activeParser.parse(input, {
        availableActions: tools.actions
      });

      return this.execute(intent, runOptions);
    },

    async research(query, researchOptions) {
      return executeWebResearch({
        query,
        ...researchOptions,
        behaviorProvider: researchOptions?.behaviorProvider ?? behaviorEngine.getProvider(),
        knowledge: researchOptions?.knowledge ?? knowledge
      });
    }
  };

  return agent;
}

function writeToKnowledge(
  knowledge: ApplicationKnowledge | undefined,
  intent: DecisionIntent,
  record: ExecutionRecord
): void {
  if (!knowledge) return;

  const result: "success" | "denied" | "failed" =
    record.status === "APPROVED_AND_COMPLETE"
      ? "success"
      : record.status === "BLOCKED"
        ? "denied"
        : "failed";

  knowledge.addHistoryEntry({
    operation: intent.action,
    ...(intent.target !== undefined && { target: intent.target }),
    ...(intent.actor !== undefined && { actor: intent.actor }),
    result,
    detail: buildDetail(record)
  });
}

function buildDetail(record: ExecutionRecord): string {
  switch (record.status) {
    case "APPROVED_AND_COMPLETE":
      return `Approved and verified in ${record.totalDurationMs}ms.`;
    case "APPROVED_AND_FAILED":
      return `Approved, executed, but verification failed: ${record.verificationResult?.reason ?? "unknown"} (recovery: ${record.verificationResult?.recovery ?? "none"}).`;
    case "BLOCKED":
      return `Blocked by decision engine: ${record.decision.result}${
        "reason" in record.decision ? ` — ${record.decision.reason}` : ""
      }.`;
    case "ERROR":
      return `Unexpected error: ${record.error ?? "unknown"}.`;
  }
}

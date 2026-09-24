/**
 * DSC integration for @nexo-alpha/agent
 *
 * Provides a thin wrapper over createAgent() that plugs a DscOrchestrator
 * into the three high-traffic agent call-paths:
 *
 *  - agent.execute()  — decision + tool + verify pipeline
 *  - agent.run()      — intent-parse + execute
 *  - agent.research() — web-research pipeline
 *
 * Benefits:
 *  - Idempotent execute() calls with identical intents are deduplicated in-flight
 *  - Per-operation latency is tracked in the DscCollector for benchmarking
 *  - Cache hit/miss rates surface in the DSC aggregate metrics dashboard
 *
 * Usage:
 *   import { createDscOrchestrator, createDscCollector } from "@nexo-alpha/behavior";
 *   import { createDscAgent } from "@nexo-alpha/agent";
 *
 *   const collector    = createDscCollector();
 *   const orchestrator = createDscOrchestrator(collector);
 *
 *   const agent = createDscAgent({
 *     ...agentOptions,
 *     orchestrator,
 *   });
 */

import { createAgent, type AgentOptions, type NexoAgent } from "./agent.js";
import type { ExecuteOptions, RunOptions } from "./agent.js";
import type { DecisionIntent } from "@nexo-alpha/decision";
import type { ResearchOptions, ResearchResult } from "@nexo-alpha/web";

// ---------------------------------------------------------------------------
// Minimal interface mirror — avoids @nexo-alpha/behavior dep here
// ---------------------------------------------------------------------------

interface DscOrchestratorLike {
  run<TInput, TOutput>(
    operation: {
      name: string;
      idempotent?: boolean;
      ttlMs?: number;
      plan?(ctx: {
        operationId: string;
        operationName: string;
        input: TInput;
        metadata?: Record<string, unknown>;
        stageData: Record<string, unknown>;
      }): { cacheKey?: string } | Promise<{ cacheKey?: string }>;
      execute(ctx: {
        operationId: string;
        operationName: string;
        input: TInput;
        metadata?: Record<string, unknown>;
        stageData: Record<string, unknown>;
      }): Promise<TOutput>;
    },
    input: TInput,
    metadata?: Record<string, unknown>
  ): Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DscAgentOptions extends AgentOptions {
  /**
   * DscOrchestrator instance. When provided, execute/run/research calls
   * are wrapped in the DSC pipeline for tracing and deduplication.
   */
  readonly orchestrator: DscOrchestratorLike;
  /**
   * TTL (ms) for caching idempotent execute() results.
   * Defaults to 0 (no caching) because most agent intents are NOT idempotent.
   * Set to a positive value only for clearly idempotent actions (e.g. read-only lookups).
   */
  readonly executeCacheTtlMs?: number | undefined;
  /**
   * TTL (ms) for caching research() results.
   * Defaults to 5 minutes — research results rarely change in a short window.
   */
  readonly researchCacheTtlMs?: number | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableIntentKey(intent: DecisionIntent): string {
  return `${intent.action}::${intent.target ?? ""}::${JSON.stringify(intent.payload ?? null)}`;
}

function stableResearchKey(query: string): string {
  return `research::${query.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a DSC-instrumented NexoAgent.
 *
 * Wraps the standard agent produced by createAgent() so that:
 *  - Every execute() call is traced via DscOrchestrator.run()
 *  - Concurrent execute() calls with the same intent key are deduplicated
 *  - research() results are cached for researchCacheTtlMs (default 5 min)
 */
export function createDscAgent(options: DscAgentOptions): NexoAgent {
  const { orchestrator, executeCacheTtlMs = 0, researchCacheTtlMs = 300_000, ...agentOptions } = options;

  const baseAgent = createAgent(agentOptions);

  const dscAgent: NexoAgent = {
    name: baseAgent.name,
    tools: baseAgent.tools,
    verifiers: baseAgent.verifiers,
    behavior: baseAgent.behavior,
    auditLog: baseAgent.auditLog,

    async execute(intent: DecisionIntent, callOptions?: ExecuteOptions) {
      const intentKey = stableIntentKey(intent);

      return orchestrator.run(
        {
          name: `agent:execute:${intent.action}`,
          idempotent: executeCacheTtlMs > 0,
          ttlMs: executeCacheTtlMs,
          plan(_ctx) {
            // Use the intent fingerprint as cache key so identical intents
            // collapse into a single in-flight execution.
            return { cacheKey: `agent:exec:${intentKey}` };
          },
          async execute(_ctx) {
            return baseAgent.execute(intent, callOptions);
          }
        },
        intent,
        { action: intent.action, target: intent.target }
      );
    },

    async run(input: string, runOptions?: RunOptions) {
      return orchestrator.run(
        {
          name: "agent:run",
          idempotent: false,
          async execute(_ctx) {
            return baseAgent.run(input, runOptions);
          }
        },
        input
      );
    },

    async research(query: string, researchOptions?: Omit<ResearchOptions, "query">): Promise<ResearchResult> {
      const researchKey = stableResearchKey(query);

      return orchestrator.run(
        {
          name: "agent:research",
          idempotent: true,
          ttlMs: researchCacheTtlMs,
          plan(_ctx) {
            return { cacheKey: researchKey };
          },
          async execute(_ctx) {
            return baseAgent.research(query, researchOptions);
          }
        },
        query
      ) as Promise<ResearchResult>;
    }
  };

  return dscAgent;
}

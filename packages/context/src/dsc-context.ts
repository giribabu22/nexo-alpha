/**
 * DSC-accelerated context builder for @nexo-alpha/context
 *
 * Wraps buildContext() and contextToJson() behind a DscOrchestrator so
 * identical application snapshots are returned from an in-process cache
 * (based on the structural hash) instead of re-serialising the entire
 * application graph on every call.
 *
 * This is particularly effective in hot paths where many downstream
 * consumers call buildContext() in quick succession without any actual
 * structural change in between (e.g. multiple simultaneous API requests).
 */

import { buildContext, contextToJson, hashStructure, describeStructure } from "./context.js";
import type { ApplicationContext, SourceTree } from "./context.js";
import type { ApplicationKnowledge } from "./knowledge.js";
import type { NexoApplication } from "@nexo-alpha/core";

// ---------------------------------------------------------------------------
// Minimal interface mirror — avoids a direct dep on @nexo-alpha/behavior
// ---------------------------------------------------------------------------

interface DscOrchestratorLike {
  run<TInput, TOutput>(
    operation: {
      name: string;
      idempotent?: boolean;
      ttlMs?: number;
      plan?(ctx: { input: TInput; operationId: string; operationName: string; metadata?: Record<string, unknown>; stageData: Record<string, unknown> }): { cacheKey?: string };
      execute(ctx: { operationId: string; operationName: string; input: TInput; metadata?: Record<string, unknown>; stageData: Record<string, unknown> }): Promise<TOutput>;
    },
    input: TInput,
    metadata?: Record<string, unknown>
  ): Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DscContextOptions {
  /**
   * DscOrchestrator instance (from @nexo-alpha/behavior or the container).
   * When omitted the functions fall back to direct (non-cached) calls.
   */
  readonly orchestrator?: DscOrchestratorLike | undefined;
  /**
   * Cache TTL in milliseconds for `buildContextWithDsc`.
   * Defaults to 30 000 ms (30 s).
   */
  readonly ttlMs?: number | undefined;
  /**
   * Cache TTL in milliseconds for `contextToJsonWithDsc`.
   * Defaults to 30 000 ms (30 s).
   */
  readonly jsonTtlMs?: number | undefined;
}

// ---------------------------------------------------------------------------
// Cached context builder
// ---------------------------------------------------------------------------

/**
 * DSC-accelerated version of `buildContext()`.
 *
 * Uses the application's structural hash as the cache key so two calls
 * with structurally identical apps (same modules, APIs, services, jobs) return
 * the cached snapshot without re-traversing the graph.
 */
export async function buildContextWithDsc(
  app: NexoApplication,
  knowledge?: ApplicationKnowledge,
  sourceTree?: SourceTree,
  options?: DscContextOptions
): Promise<ApplicationContext> {
  if (!options?.orchestrator) {
    return buildContext(app, knowledge, sourceTree);
  }

  const structure = describeStructure(app);
  const structureHash = hashStructure(structure);

  return options.orchestrator.run(
    {
      name: "context:build",
      idempotent: true,
      ttlMs: options.ttlMs ?? 30_000,
      plan(ctx) {
        // Use the structural hash as the cache key so only genuinely changed
        // applications bust the cache.
        return { cacheKey: `context:build:${structureHash}` };
      },
      async execute(_ctx) {
        return buildContext(app, knowledge, sourceTree);
      }
    },
    { app, knowledge, sourceTree }
  );
}

// ---------------------------------------------------------------------------
// Cached JSON serialiser
// ---------------------------------------------------------------------------

/**
 * DSC-accelerated version of `contextToJson()`.
 *
 * Serialisation is CPU-bound (JSON.stringify over a potentially large object)
 * so caching it avoids redundant work when the same context is serialised
 * multiple times in the same request cycle.
 */
export async function contextToJsonWithDsc(
  context: ApplicationContext,
  options?: DscContextOptions
): Promise<string> {
  if (!options?.orchestrator) {
    return contextToJson(context);
  }

  // Derive a stable cache key from the structureHash already embedded in the context.
  const cacheKey = `context:json:${context.structureHash}`;

  return options.orchestrator.run(
    {
      name: "context:toJson",
      idempotent: true,
      ttlMs: options.jsonTtlMs ?? 30_000,
      plan(_ctx) {
        return { cacheKey };
      },
      async execute(_ctx) {
        return contextToJson(context);
      }
    },
    context
  );
}

// ---------------------------------------------------------------------------
// Convenience: build + serialise in one DSC pipeline call
// ---------------------------------------------------------------------------

export interface DscContextSnapshot {
  readonly context: ApplicationContext;
  readonly json: string;
}

/**
 * Builds the context AND serialises it in a single orchestrated pipeline call,
 * benefiting from both caches.
 */
export async function buildContextSnapshotWithDsc(
  app: NexoApplication,
  knowledge?: ApplicationKnowledge,
  sourceTree?: SourceTree,
  options?: DscContextOptions
): Promise<DscContextSnapshot> {
  const context = await buildContextWithDsc(app, knowledge, sourceTree, options);
  const json = await contextToJsonWithDsc(context, options);
  return { context, json };
}

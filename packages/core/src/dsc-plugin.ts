/**
 * DSC Plugin for @nexo-alpha/core
 *
 * Wires a DscOrchestrator + DscInterceptor into any NexoApplication via the
 * container so every middleware pipeline, lifecycle hook, and API handler can
 * instrument operations without importing @nexo-alpha/behavior directly.
 *
 * Usage:
 *   import { installDscPlugin } from "@nexo-alpha/core";
 *   import { createDscOrchestrator, createDscInterceptor } from "@nexo-alpha/behavior";
 *
 *   installDscPlugin(app, {
 *     orchestrator: createDscOrchestrator(),
 *     interceptor:  createDscInterceptor(),
 *   });
 */

import type { NexoApplication } from "./application.js";
import type { NexoMiddleware } from "./middleware.js";
import type { NexoRequestContext } from "./api.js";

// --- Minimal interface mirrors so core never depends on @nexo-alpha/behavior --

/**
 * Minimal slice of DscOrchestrator that core cares about.
 * The real DscOrchestrator satisfies this automatically.
 */
export interface DscOrchestratorLike {
  run<TInput, TOutput>(
    operation: {
      name: string;
      idempotent?: boolean;
      ttlMs?: number;
      execute(ctx: { operationId: string; operationName: string; input: TInput; metadata?: Record<string, unknown>; stageData: Record<string, unknown> }): Promise<TOutput>;
    },
    input: TInput,
    metadata?: Record<string, unknown>
  ): Promise<TOutput>;
  clearCache(): void;
}

/**
 * Minimal slice of DscInterceptor that core cares about.
 */
export interface DscInterceptorLike {
  instrument<TArgs extends any[], TReturn>(
    name: string,
    fn: (...args: TArgs) => Promise<TReturn> | TReturn,
    options?: { stage?: any; trackPayloadSize?: boolean }
  ): (...args: TArgs) => Promise<TReturn>;
}

/**
 * Minimal slice of DscCollector returned from getCollector().
 */
export interface DscCollectorLike {
  getMetrics(): {
    totalOperations: number;
    cacheHitRate: number;
    totalTokensSaved: number;
    deduplicatedOps: number;
    averageDurationMs: number;
  };
  record(entry: Record<string, unknown>): void;
  clear(): void;
  subscribe(listener: (record: unknown) => void): () => void;
}

// --- Token symbols for container binding -------------------------------------

export const DSC_ORCHESTRATOR: unique symbol = Symbol("DscOrchestrator");
export const DSC_INTERCEPTOR: unique symbol = Symbol("DscInterceptor");
export const DSC_COLLECTOR: unique symbol = Symbol("DscCollector");

// --- Plugin types -------------------------------------------------------------

export interface DscPluginOptions {
  /** Pre-created orchestrator (use createDscOrchestrator() from @nexo-alpha/behavior). */
  readonly orchestrator: DscOrchestratorLike;
  /** Pre-created interceptor (use createDscInterceptor() from @nexo-alpha/behavior). */
  readonly interceptor: DscInterceptorLike;
  /**
   * Collector instance. Pass orchestrator.getCollector() or
   * interceptor.getCollector() here.
   */
  readonly collector?: DscCollectorLike | undefined;
  /**
   * When true (default), automatically add a DSC timing middleware to every
   * API request handled via app.handle() so all handler durations are tracked.
   */
  readonly autoInstrumentApis?: boolean | undefined;
}

export interface InstalledDscPlugin {
  /** The orchestrator bound into the container. */
  readonly orchestrator: DscOrchestratorLike;
  /** The interceptor bound into the container. */
  readonly interceptor: DscInterceptorLike;
  /**
   * Returns a DSC-instrumented middleware that wraps `fn` and records its
   * execution latency into the collector.
   */
  createTimingMiddleware(
    operationName: string
  ): NexoMiddleware<NexoRequestContext, unknown>;
}

// --- Implementation ----------------------------------------------------------

/**
 * Installs the DSC (Deterministic State & Computation) optimization layer
 * into the application container so downstream services can resolve it.
 *
 * Call this *before* app.start().
 */
export function installDscPlugin(
  app: NexoApplication,
  options: DscPluginOptions
): InstalledDscPlugin {
  const { orchestrator, interceptor, collector } = options;

  // Bind into the DI container as singletons
  app.container.bindValue(DSC_ORCHESTRATOR, orchestrator);
  app.container.bindValue(DSC_INTERCEPTOR, interceptor);
  if (collector) {
    app.container.bindValue(DSC_COLLECTOR, collector);
  }

  function createTimingMiddleware(
    operationName: string
  ): NexoMiddleware<NexoRequestContext, unknown> {
    return async (_ctx: NexoRequestContext, next: () => Promise<unknown>) => {
      const start = performance.now();
      try {
        const result = await next();
        const durationMs = Math.round((performance.now() - start) * 100) / 100;
        collector?.record({
          operationId: `api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          operationName,
          stage: "execute",
          status: "success",
          durationMs
        });
        return result;
      } catch (err) {
        const durationMs = Math.round((performance.now() - start) * 100) / 100;
        collector?.record({
          operationId: `api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          operationName,
          stage: "execute",
          status: "failure",
          durationMs,
          error: err instanceof Error ? err.message : String(err)
        });
        throw err;
      }
    };
  }

  return { orchestrator, interceptor, createTimingMiddleware };
}

/**
 * Resolve the DSC orchestrator from the application container.
 * Throws if installDscPlugin was never called.
 */
export function resolveDscOrchestrator(app: NexoApplication): DscOrchestratorLike {
  return app.container.resolve<DscOrchestratorLike>(DSC_ORCHESTRATOR);
}

/**
 * Resolve the DSC interceptor from the application container.
 * Throws if installDscPlugin was never called.
 */
export function resolveDscInterceptor(app: NexoApplication): DscInterceptorLike {
  return app.container.resolve<DscInterceptorLike>(DSC_INTERCEPTOR);
}

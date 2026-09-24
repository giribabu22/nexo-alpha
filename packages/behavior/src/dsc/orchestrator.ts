import { createHash } from "node:crypto";
import { DscCollector } from "./collector.js";
import type {
  DscOperationDefinition,
  DscExecutionContext,
  DscPlanResult
} from "./types.js";

interface CacheEntry<T = unknown> {
  readonly value: T;
  readonly expiresAt: number;
}

export class DscOrchestrator {
  private readonly collector: DscCollector;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(collector?: DscCollector) {
    this.collector = collector ?? new DscCollector();
  }

  getCollector(): DscCollector {
    return this.collector;
  }

  private hashKey(prefix: string, input: unknown): string {
    const serialized = typeof input === "string" ? input : JSON.stringify(input ?? null);
    const hash = createHash("sha256").update(serialized).digest("hex").slice(0, 16);
    return `${prefix}:${hash}`;
  }

  async run<TInput, TOutput>(
    operation: DscOperationDefinition<TInput, TOutput>,
    input: TInput,
    metadata?: Record<string, unknown>
  ): Promise<TOutput> {
    const operationId = `dsc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const context: DscExecutionContext<TInput> = {
      operationId,
      operationName: operation.name,
      input,
      metadata,
      stageData: {}
    };

    // Stage 1: Plan
    const planStart = performance.now();
    let planResult: DscPlanResult | undefined;

    if (operation.plan) {
      planResult = await operation.plan(context);
    }

    const planDuration = Math.round((performance.now() - planStart) * 100) / 100;

    // Check early termination
    if (planResult?.skipExecution && planResult.earlyResult !== undefined) {
      this.collector.record({
        operationId,
        operationName: operation.name,
        stage: "plan",
        status: "early_terminated",
        durationMs: planDuration,
        tokensSaved: 50 // baseline estimation
      });
      return planResult.earlyResult as TOutput;
    }

    this.collector.record({
      operationId,
      operationName: operation.name,
      stage: "plan",
      status: "success",
      durationMs: planDuration
    });

    // Check Cache if idempotent
    const cacheKey = planResult?.cacheKey ?? (operation.idempotent ? this.hashKey(operation.name, input) : undefined);

    if (cacheKey && this.cache.has(cacheKey)) {
      const entry = this.cache.get(cacheKey)!;
      if (Date.now() < entry.expiresAt) {
        this.collector.record({
          operationId,
          operationName: operation.name,
          stage: "execute",
          status: "cached",
          durationMs: 0.1,
          cacheHit: true,
          tokensSaved: 100 // baseline estimation
        });
        return entry.value as TOutput;
      } else {
        this.cache.delete(cacheKey);
      }
    }

    // In-Flight Request Deduplication
    if (cacheKey && this.inFlight.has(cacheKey)) {
      this.collector.record({
        operationId,
        operationName: operation.name,
        stage: "execute",
        status: "deduplicated",
        durationMs: 0.1,
        deduplicated: true
      });
      return (await this.inFlight.get(cacheKey)) as TOutput;
    }

    // Execute the remaining stages
    const executionPromise = (async (): Promise<TOutput> => {
      // Stage 2: Resolve
      const resolveStart = performance.now();
      if (operation.resolve) {
        await operation.resolve(context);
      }
      const resolveDuration = Math.round((performance.now() - resolveStart) * 100) / 100;
      this.collector.record({
        operationId,
        operationName: operation.name,
        stage: "resolve",
        status: "success",
        durationMs: resolveDuration
      });

      // Stage 3: Execute
      const execStart = performance.now();
      const rawResult = await operation.execute(context);
      const execDuration = Math.round((performance.now() - execStart) * 100) / 100;
      this.collector.record({
        operationId,
        operationName: operation.name,
        stage: "execute",
        status: "success",
        durationMs: execDuration,
        cacheHit: cacheKey ? false : undefined
      });

      // Stage 4: Verify
      if (operation.verify) {
        const verifyStart = performance.now();
        const verification = await operation.verify(rawResult, context);
        const verifyDuration = Math.round((performance.now() - verifyStart) * 100) / 100;

        const isValid = typeof verification === "boolean" ? verification : verification.valid;
        if (!isValid) {
          const reason = typeof verification === "object" ? verification.reason : "Verification failed";
          this.collector.record({
            operationId,
            operationName: operation.name,
            stage: "verify",
            status: "failure",
            durationMs: verifyDuration,
            error: reason
          });
          throw new Error(`[DSC Verify Failed] ${operation.name}: ${reason}`);
        }

        this.collector.record({
          operationId,
          operationName: operation.name,
          stage: "verify",
          status: "success",
          durationMs: verifyDuration
        });
      }

      // Stage 5: Write
      if (operation.write) {
        const writeStart = performance.now();
        await operation.write(rawResult, context);
        const writeDuration = Math.round((performance.now() - writeStart) * 100) / 100;
        this.collector.record({
          operationId,
          operationName: operation.name,
          stage: "write",
          status: "success",
          durationMs: writeDuration
        });
      }

      // Store in Cache if idempotent
      if (cacheKey) {
        const ttl = operation.ttlMs ?? 60_000;
        this.cache.set(cacheKey, {
          value: rawResult,
          expiresAt: Date.now() + ttl
        });
      }

      return rawResult;
    })();

    if (cacheKey) {
      this.inFlight.set(cacheKey, executionPromise);
    }

    try {
      return await executionPromise;
    } finally {
      if (cacheKey) {
        this.inFlight.delete(cacheKey);
      }
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function createDscOrchestrator(collector?: DscCollector): DscOrchestrator {
  return new DscOrchestrator(collector);
}

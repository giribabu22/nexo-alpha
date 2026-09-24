import { DscCollector } from "./collector.js";
import type { DscStage } from "./types.js";

export interface DscInstrumentOptions {
  readonly operationName?: string | undefined;
  readonly stage?: DscStage | undefined;
  readonly collector?: DscCollector | undefined;
  readonly trackPayloadSize?: boolean | undefined;
  readonly extractTokens?: ((result: unknown) => { promptTokens?: number; completionTokens?: number }) | undefined;
}

function calculatePayloadSize(payload: unknown): number {
  if (payload === undefined || payload === null) return 0;
  if (typeof payload === "string") return payload.length;
  if (typeof payload === "number" || typeof payload === "boolean") return 8;
  try {
    return JSON.stringify(payload).length;
  } catch {
    return 0;
  }
}

export class DscInterceptor {
  private readonly defaultCollector: DscCollector;

  constructor(defaultCollector?: DscCollector) {
    this.defaultCollector = defaultCollector ?? new DscCollector();
  }

  getCollector(): DscCollector {
    return this.defaultCollector;
  }

  instrument<TArgs extends any[], TReturn>(
    name: string,
    fn: (...args: TArgs) => Promise<TReturn> | TReturn,
    options: DscInstrumentOptions = {}
  ): (...args: TArgs) => Promise<TReturn> {
    const collector = options.collector ?? this.defaultCollector;
    const stage: DscStage = options.stage ?? "execute";
    const opName = options.operationName ?? name;

    return async (...args: TArgs): Promise<TReturn> => {
      const operationId = `dsc-op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const startTime = performance.now();
      const inputSize = options.trackPayloadSize !== false ? calculatePayloadSize(args) : 0;

      try {
        const result = await fn(...args);
        const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
        const outputSize = options.trackPayloadSize !== false ? calculatePayloadSize(result) : 0;
        const tokens = options.extractTokens?.(result);

        collector.record({
          operationId,
          operationName: opName,
          stage,
          status: "success",
          durationMs,
          payloadSizeBytes: inputSize + outputSize,
          promptTokens: tokens?.promptTokens,
          completionTokens: tokens?.completionTokens
        });

        return result;
      } catch (error) {
        const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
        collector.record({
          operationId,
          operationName: opName,
          stage,
          status: "failure",
          durationMs,
          payloadSizeBytes: inputSize,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    };
  }
}

export function createDscInterceptor(collector?: DscCollector): DscInterceptor {
  return new DscInterceptor(collector);
}

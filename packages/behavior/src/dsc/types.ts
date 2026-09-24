export type DscStage = "plan" | "resolve" | "execute" | "verify" | "write";

export type DscTaskComplexity = "deterministic" | "fast_model" | "deep_reasoning";

export type DscExecutionStatus =
  | "success"
  | "failure"
  | "early_terminated"
  | "cached"
  | "deduplicated";

export interface DscVerificationResult {
  readonly valid: boolean;
  readonly reason?: string | undefined;
  readonly retryable?: boolean | undefined;
}

export interface DscPlanResult {
  readonly skipExecution?: boolean | undefined;
  readonly earlyResult?: unknown | undefined;
  readonly complexity?: DscTaskComplexity | undefined;
  readonly cacheKey?: string | undefined;
}

export interface DscResolveResult<TContext = unknown> {
  readonly resolvedContext?: TContext | undefined;
  readonly stateDeltaOnly?: boolean | undefined;
}

export interface DscExecutionContext<TInput = unknown> {
  readonly operationId: string;
  readonly operationName: string;
  readonly input: TInput;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  stageData: Record<string, unknown>;
}

export interface DscOperationDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly complexity?: DscTaskComplexity | undefined;
  readonly idempotent?: boolean | undefined;
  readonly ttlMs?: number | undefined;

  plan?(context: DscExecutionContext<TInput>): Promise<DscPlanResult> | DscPlanResult;
  resolve?(context: DscExecutionContext<TInput>): Promise<DscResolveResult> | DscResolveResult;
  execute(context: DscExecutionContext<TInput>): Promise<TOutput>;
  verify?(result: TOutput, context: DscExecutionContext<TInput>): Promise<boolean | DscVerificationResult> | boolean | DscVerificationResult;
  write?(result: TOutput, context: DscExecutionContext<TInput>): Promise<void> | void;
}

export interface DscMetricRecord {
  readonly timestamp: string;
  readonly operationId: string;
  readonly operationName: string;
  readonly stage: DscStage;
  readonly status: DscExecutionStatus;
  readonly durationMs: number;
  readonly promptTokens?: number | undefined;
  readonly completionTokens?: number | undefined;
  readonly tokensSaved?: number | undefined;
  readonly wastedStateTokens?: number | undefined;
  readonly cacheHit?: boolean | undefined;
  readonly deduplicated?: boolean | undefined;
  readonly toolCalls?: number | undefined;
  readonly duplicatedToolCalls?: number | undefined;
  readonly payloadSizeBytes?: number | undefined;
  readonly costUsd?: number | undefined;
  readonly error?: string | undefined;
}

export interface DscAggregateMetrics {
  readonly totalOperations: number;
  readonly totalDurationMs: number;
  readonly averageDurationMs: number;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokensSaved: number;
  readonly totalWastedStateTokens: number;
  readonly totalCostUsd: number;
  readonly totalToolCalls: number;
  readonly duplicatedToolCalls: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheHitRate: number;
  readonly deduplicatedOps: number;
  readonly stageDurations: Record<DscStage, number>;
  readonly statusCounts: Record<DscExecutionStatus, number>;
}

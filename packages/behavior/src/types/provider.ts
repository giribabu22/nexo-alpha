import { QuestionMap } from './primitives.js';

export interface DecisionResult<T = string | number | boolean> {
  value: T;
  confidence: number;
  explanation?: string | undefined;
}

export interface DecisionMetrics {
  readonly durationMs: number;
  readonly promptTokens?: number | undefined;
  readonly completionTokens?: number | undefined;
  readonly estimatedCostUsd?: number | undefined;
  readonly savedGenerativeTokens?: number | undefined;
}

export interface DecisionRequest<TState = unknown> {
  state: TState;
  questions: QuestionMap;
}

export interface DecisionResponse {
  results: Record<string, DecisionResult>;
  metrics?: DecisionMetrics | undefined;
}

export interface BehaviorProvider {
  name: string;
  evaluate<TState>(request: DecisionRequest<TState>): Promise<DecisionResponse>;
}

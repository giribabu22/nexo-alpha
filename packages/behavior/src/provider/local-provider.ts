import { BehaviorProvider, DecisionRequest, DecisionResponse, DecisionResult } from '../types/provider.js';

export type HeuristicEvaluator = (key: string, question: any, state: any) => DecisionResult;

/**
 * Answers questions in-process with a caller-supplied evaluator — for
 * deterministic heuristics and tests.
 *
 * Without an evaluator it answers nothing: every question is left out of
 * `results`, so the policies report that they don't know (`verify` →
 * "uncertain", `retry` → false, `escalate` → true, all with confidence 0)
 * instead of acting on an invented answer. This is the provider a
 * `BehaviorEngine` uses when none is configured.
 */
export class LocalBehaviorProvider implements BehaviorProvider {
  public readonly name = 'local';
  private customEvaluator?: HeuristicEvaluator | undefined;

  constructor(customEvaluator?: HeuristicEvaluator | undefined) {
    this.customEvaluator = customEvaluator;
  }

  async evaluate<TState>(request: DecisionRequest<TState>): Promise<DecisionResponse> {
    const results: Record<string, DecisionResult> = {};
    if (!this.customEvaluator) {
      return { results };
    }

    for (const [key, q] of Object.entries(request.questions)) {
      results[key] = this.customEvaluator(key, q, request.state);
    }

    return { results };
  }
}

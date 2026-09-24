import { BehaviorProvider, DecisionRequest, DecisionResponse, DecisionResult } from '../types/provider.js';

export type HeuristicEvaluator = (key: string, question: any, state: any) => DecisionResult;

export class LocalBehaviorProvider implements BehaviorProvider {
  public readonly name = 'local';
  private customEvaluator?: HeuristicEvaluator | undefined;

  constructor(customEvaluator?: HeuristicEvaluator | undefined) {
    this.customEvaluator = customEvaluator;
  }

  async evaluate<TState>(request: DecisionRequest<TState>): Promise<DecisionResponse> {
    const results: Record<string, DecisionResult> = {};

    for (const [key, q] of Object.entries(request.questions)) {
      if (this.customEvaluator) {
        results[key] = this.customEvaluator(key, q, request.state);
        continue;
      }

      if (q.type === 'choice') {
        const val = q.options[0] ?? '';
        results[key] = {
          value: val,
          confidence: 0.9,
          explanation: `Local default choice: ${val}`
        };
      } else if (q.type === 'score') {
        results[key] = {
          value: (q.max ?? 1) * 0.85,
          confidence: 0.88,
          explanation: 'Local heuristic score evaluation'
        };
      } else if (q.type === 'boolean') {
        results[key] = {
          value: true,
          confidence: 0.95,
          explanation: 'Local boolean evaluation criteria matched'
        };
      }
    }

    return { results };
  }
}

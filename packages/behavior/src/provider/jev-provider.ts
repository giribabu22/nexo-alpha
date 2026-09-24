import { BehaviorProvider, DecisionRequest, DecisionResponse, DecisionResult } from '../types/provider.js';

export interface JevProviderConfig {
  apiKey?: string | undefined;
  endpoint?: string | undefined;
  mockResults?: Record<string, DecisionResult> | undefined;
}

export class JevBehaviorProvider implements BehaviorProvider {
  public readonly name = 'jev';
  private config: JevProviderConfig;

  constructor(config: JevProviderConfig = {}) {
    this.config = config;
  }

  async evaluate<TState>(request: DecisionRequest<TState>): Promise<DecisionResponse> {
    if (this.config.mockResults) {
      return { results: this.config.mockResults };
    }

    if (this.config.endpoint && this.config.apiKey) {
      try {
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            state: request.state,
            questions: request.questions
          })
        });

        if (response.ok) {
          const data = await response.json();
          return data as DecisionResponse;
        }
      } catch {
        // Fallback gracefully
      }
    }

    const results: Record<string, DecisionResult> = {};
    for (const [key, q] of Object.entries(request.questions)) {
      if (q.type === 'choice') {
        const val = q.options[0] ?? '';
        results[key] = {
          value: val,
          confidence: 0.92,
          explanation: `[Jev Adaptor] Evaluated top candidate: ${val}`
        };
      } else if (q.type === 'score') {
        results[key] = {
          value: 0.9,
          confidence: 0.91,
          explanation: '[Jev Adaptor] Probability-backed score evaluation'
        };
      } else if (q.type === 'boolean') {
        results[key] = {
          value: true,
          confidence: 0.96,
          explanation: '[Jev Adaptor] Boolean criteria passed'
        };
      }
    }

    return { results };
  }
}

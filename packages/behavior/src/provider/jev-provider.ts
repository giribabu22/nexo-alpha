import { BehaviorProvider, DecisionRequest, DecisionResponse, DecisionResult } from '../types/provider.js';

export interface JevProviderConfig {
  apiKey?: string | undefined;
  endpoint?: string | undefined;
  /** Fixed results returned for every request (tests and demos); no endpoint is called. */
  mockResults?: Record<string, DecisionResult> | undefined;
}

/**
 * Sends questions to a remote evaluation endpoint (`POST { state, questions }`,
 * bearer `apiKey`) and returns its `DecisionResponse`. Needs `endpoint` and
 * `apiKey`, or `mockResults`. A network error or non-2xx response throws:
 * it never substitutes answers of its own.
 */
export class JevBehaviorProvider implements BehaviorProvider {
  public readonly name = 'jev';
  private config: JevProviderConfig;

  constructor(config: JevProviderConfig = {}) {
    if (!config.mockResults && !(config.endpoint && config.apiKey)) {
      throw new Error('JevBehaviorProvider needs an endpoint and an apiKey (or mockResults).');
    }
    this.config = config;
  }

  async evaluate<TState>(request: DecisionRequest<TState>): Promise<DecisionResponse> {
    if (this.config.mockResults) {
      return { results: this.config.mockResults };
    }

    let response: Response;
    try {
      response = await fetch(this.config.endpoint as string, {
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
    } catch (error) {
      throw new Error(
        `JevBehaviorProvider: request to ${this.config.endpoint} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      throw new Error(`JevBehaviorProvider: ${this.config.endpoint} answered ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as DecisionResponse;
  }
}

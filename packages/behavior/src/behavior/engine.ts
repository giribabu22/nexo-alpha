import { BehaviorProvider, DecisionRequest, DecisionResponse } from '../types/provider.js';
import { QuestionMap } from '../types/primitives.js';
import { LocalBehaviorProvider } from '../provider/local-provider.js';
import { TelemetryTracker, createTelemetryTracker, type BehaviorTelemetryMetrics } from '../telemetry/index.js';
import {
  RoutePolicyOptions, RoutePolicyResult,
  VerifyPolicyOptions, VerifyPolicyResult,
  RetryPolicyOptions, RetryPolicyResult,
  CompletePolicyOptions, CompletePolicyResult,
  EscalatePolicyOptions, EscalatePolicyResult
} from '../types/policies.js';
import { choice, boolean, score } from '../primitives/index.js';

export interface BehaviorEngineConfig {
  provider?: BehaviorProvider | undefined;
  telemetry?: TelemetryTracker | undefined;
}

export class BehaviorEngine {
  private provider: BehaviorProvider;
  private telemetry: TelemetryTracker;

  constructor(config: BehaviorEngineConfig = {}) {
    this.provider = config.provider ?? new LocalBehaviorProvider();
    this.telemetry = config.telemetry ?? createTelemetryTracker();
  }

  public setProvider(provider: BehaviorProvider): void {
    this.provider = provider;
  }

  public getProvider(): BehaviorProvider {
    return this.provider;
  }

  public getTelemetry(): TelemetryTracker {
    return this.telemetry;
  }

  public getMetrics(): BehaviorTelemetryMetrics {
    return this.telemetry.getMetrics();
  }

  public async decide<TState = unknown, TQuestions extends QuestionMap = QuestionMap>(
    request: DecisionRequest<TState>
  ): Promise<DecisionResponse> {
    const startMs = Date.now();
    const response = await this.provider.evaluate(request);
    const durationMs = Date.now() - startMs;

    const questionCount = Object.keys(request.questions).length;
    // Estimated saved tokens: bounded micro-decisions save ~250 tokens per question over raw LLM reasoning
    const savedTokens = response.metrics?.savedGenerativeTokens ?? (questionCount * 250);

    const metrics = response.metrics ?? {
      durationMs,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      savedGenerativeTokens: savedTokens
    };

    this.telemetry.record({
      providerName: this.provider.name,
      questionCount,
      durationMs,
      promptTokens: metrics.promptTokens ?? 0,
      completionTokens: metrics.completionTokens ?? 0,
      estimatedCostUsd: metrics.estimatedCostUsd ?? 0,
      savedTokens
    });

    return {
      ...response,
      metrics
    };
  }

  // =========================================================================
  // Layer 2 Policy Recipes
  // =========================================================================

  public async route<T extends string>(options: RoutePolicyOptions<T>): Promise<RoutePolicyResult<T>> {
    const response = await this.decide({
      state: { state: options.state, context: options.context },
      questions: {
        target: choice(options.candidates, 'Selected candidate route')
      }
    });

    const res = response.results['target'];
    if (!res) {
      const fallback = options.candidates[0];
      if (!fallback) {
        throw new Error('route() failed: candidates array is empty.');
      }
      return { selected: fallback, confidence: 0 };
    }

    return {
      selected: res.value as T,
      confidence: res.confidence,
      explanation: res.explanation
    };
  }

  public async verify(options: VerifyPolicyOptions): Promise<VerifyPolicyResult> {
    const response = await this.decide({
      state: { expected: options.expected, actual: options.actual, context: options.context },
      questions: {
        matches: boolean(options.expected, 'Does actual output satisfy expected outcome?'),
        quality: score({ description: 'Quality and correctness score' })
      }
    });

    const matches = response.results['matches'];
    const quality = response.results['quality'];

    if (!matches || !quality) {
      return { status: 'uncertain', confidence: 0, reason: 'Evaluation incomplete' };
    }

    const isMatch = Boolean(matches.value);
    const confidence = (matches.confidence + quality.confidence) / 2;
    const scoreVal = Number(quality.value);

    let status: 'verified' | 'failed' | 'uncertain' = 'uncertain';
    if (isMatch && scoreVal >= 0.7) {
      status = 'verified';
    } else if (!isMatch) {
      status = 'failed';
    }

    return {
      status,
      confidence,
      reason: matches.explanation
    };
  }

  public async retry(options: RetryPolicyOptions): Promise<RetryPolicyResult> {
    if (options.attempt >= options.maxAttempts) {
      return {
        retry: false,
        confidence: 1.0,
        reason: `Maximum attempts (${options.maxAttempts}) reached.`
      };
    }

    const response = await this.decide({
      state: {
        error: typeof options.error === 'string' ? options.error : options.error.message,
        attempt: options.attempt,
        maxAttempts: options.maxAttempts,
        context: options.context
      },
      questions: {
        shouldRetry: boolean('Is this error transient and safely retryable?'),
        strategy: choice(['backoff', 'immediate', 'fallback'], 'Optimal retry strategy')
      }
    });

    const shouldRetryRes = response.results['shouldRetry'];
    const strategyRes = response.results['strategy'];

    if (!shouldRetryRes || !strategyRes) {
      return { retry: false, confidence: 0, reason: 'Retry evaluation failed' };
    }

    return {
      retry: Boolean(shouldRetryRes.value),
      strategy: strategyRes.value as 'immediate' | 'backoff' | 'fallback',
      confidence: shouldRetryRes.confidence,
      reason: shouldRetryRes.explanation
    };
  }

  public async complete(options: CompletePolicyOptions): Promise<CompletePolicyResult> {
    const response = await this.decide({
      state: { goal: options.goal, history: options.history, currentState: options.currentState },
      questions: {
        status: choice(
          ['COMPLETE', 'IN_PROGRESS', 'VERIFY_MORE', 'BLOCKED', 'FAILED', 'ESCALATE'],
          'Current goal resolution status'
        )
      }
    });

    const res = response.results['status'];
    if (!res) {
      return { status: 'IN_PROGRESS', confidence: 0, reason: 'Completion status unavailable' };
    }

    return {
      status: res.value as any,
      confidence: res.confidence,
      reason: res.explanation
    };
  }

  public async escalate(options: EscalatePolicyOptions): Promise<EscalatePolicyResult> {
    const threshold = options.confidenceThreshold ?? 0.75;
    const response = await this.decide({
      state: { state: options.state, context: options.context },
      questions: {
        confidenceScore: score({ description: 'Decision confidence score' }),
        needsHuman: boolean('Does this decision require human-in-the-loop review?')
      }
    });

    const scoreRes = response.results['confidenceScore'];
    const humanRes = response.results['needsHuman'];

    if (!scoreRes || !humanRes) {
      return { escalate: true, action: 'HUMAN_ESCALATE', confidence: 0, reason: 'Escalation score missing' };
    }

    const conf = Number(scoreRes.value);
    const forceHuman = Boolean(humanRes.value);

    if (forceHuman || conf < 0.5) {
      return {
        escalate: true,
        action: 'HUMAN_ESCALATE',
        confidence: conf,
        reason: 'Low confidence or forced human review required'
      };
    } else if (conf < threshold) {
      return {
        escalate: true,
        action: 'REVIEW',
        confidence: conf,
        reason: `Confidence (${conf}) below threshold (${threshold})`
      };
    }

    return {
      escalate: false,
      action: 'ACT',
      confidence: conf
    };
  }
}

export function createBehaviorEngine(config?: BehaviorEngineConfig | undefined): BehaviorEngine {
  return new BehaviorEngine(config);
}

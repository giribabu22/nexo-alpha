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
import {
  ContextCompressor,
  createContextCompressor,
  type CompressOptions
} from '../token/context-compressor.js';
import {
  PromptCache,
  createPromptCache,
  type PromptCacheOptions
} from '../token/prompt-cache.js';
import {
  TokenBudgetGuard,
  createTokenBudgetGuard,
  type TokenBudgetOptions
} from '../token/token-budget.js';
import {
  SelectiveContextInjector,
  createSelectiveInjector,
  type CallType,
  type InjectionProfile
} from '../token/selective-injector.js';

export interface TokenOptimizationConfig {
  /** Context state compression (delta diffing). Default: enabled with 'delta' strategy. */
  readonly compress?: CompressOptions | false;
  /** Prompt LRU cache settings. Default: 256-entry, 5-min TTL. */
  readonly promptCache?: PromptCacheOptions | false;
  /** Token budget guard (prunes oversized payloads). Default: 4000-token max. */
  readonly budget?: TokenBudgetOptions | false;
  /** Custom injection profiles per call type. */
  readonly injectionProfiles?: Partial<Record<CallType, InjectionProfile>>;
}

export interface BehaviorEngineConfig {
  provider?: BehaviorProvider | undefined;
  telemetry?: TelemetryTracker | undefined;
  /** Phase 5 token-optimization settings. Pass false to disable individual features. */
  tokenOptimization?: TokenOptimizationConfig | undefined;
}

export class BehaviorEngine {
  private provider: BehaviorProvider;
  private telemetry: TelemetryTracker;
  private readonly compressor: ContextCompressor | null;
  private readonly promptCache: PromptCache | null;
  private readonly budgetGuard: TokenBudgetGuard | null;
  private readonly injector: SelectiveContextInjector;

  constructor(config: BehaviorEngineConfig = {}) {
    this.provider = config.provider ?? new LocalBehaviorProvider();
    this.telemetry = config.telemetry ?? createTelemetryTracker();

    const tok = config.tokenOptimization;

    this.compressor = tok?.compress === false
      ? null
      : createContextCompressor(typeof tok?.compress === 'object' ? tok.compress : {});

    this.promptCache = tok?.promptCache === false
      ? null
      : createPromptCache(
          typeof tok?.promptCache === 'object'
            ? { ...tok.promptCache, providerName: this.provider.name }
            : { providerName: this.provider.name }
        );

    this.budgetGuard = tok?.budget === false
      ? null
      : createTokenBudgetGuard(typeof tok?.budget === 'object' ? tok.budget : {});

    this.injector = createSelectiveInjector(tok?.injectionProfiles);
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
    request: DecisionRequest<TState>,
    callType: CallType | string = 'custom'
  ): Promise<DecisionResponse> {
    const startMs = Date.now();
    let tokensSaved = 0;

    // --- Phase 5: Token Optimization Pipeline ---

    // 1. Selective injection: strip irrelevant fields for this call type
    let state: unknown = request.state;
    if (state !== null && typeof state === 'object') {
      const injected = this.injector.inject(
        state as Record<string, unknown>,
        callType
      );
      state = injected.payload;
      tokensSaved += injected.tokensSaved;
    }

    // 2. Context compression: delta-diff since last call
    let compressedState: unknown = state;
    if (this.compressor && state !== null && typeof state === 'object') {
      const compressed = this.compressor.compress(state as Record<string, unknown>);
      if (compressed.mode === 'skipped') {
        // State unchanged — serve from prompt cache or skip provider entirely
        const cacheKey = this.promptCache?.keyFor({ ...request, state });
        const cached = cacheKey ? this.promptCache?.get(cacheKey) : undefined;
        if (cached) {
          const durationMs = Date.now() - startMs;
          const questionCount = Object.keys(request.questions).length;
          const saved = this.estimateSaved(request.state) + tokensSaved;
          this.telemetry.record({
            providerName: this.provider.name,
            questionCount,
            durationMs,
            promptTokens: 0,
            completionTokens: 0,
            estimatedCostUsd: 0,
            savedTokens: saved
          });
          return cached;
        }
      }
      compressedState = compressed.payload;
      tokensSaved += compressed.tokensSaved;
    }

    // 3. Token budget guard: prune if over budget
    if (this.budgetGuard && compressedState !== null && typeof compressedState === 'object') {
      const budgeted = this.budgetGuard.enforce(compressedState as Record<string, unknown>);
      compressedState = budgeted.payload;
      if (!budgeted.withinBudget) {
        tokensSaved += (this.estimateSaved(request.state) - budgeted.estimatedTokens);
      }
    }

    const optimisedRequest: DecisionRequest<unknown> = {
      ...request,
      state: compressedState
    };

    // 4. Prompt cache: skip provider call for identical requests
    const { response, cacheHit } = this.promptCache
      ? await this.promptCache.getOrEvaluate(
          optimisedRequest,
          (req) => this.provider.evaluate(req as DecisionRequest<TState>)
        )
      : { response: await this.provider.evaluate(optimisedRequest as DecisionRequest<TState>), cacheHit: false };

    const durationMs = Date.now() - startMs;
    const questionCount = Object.keys(request.questions).length;
    const savedGenerativeTokens = response.metrics?.savedGenerativeTokens ?? (questionCount * 250);
    const totalSaved = savedGenerativeTokens + tokensSaved + (cacheHit ? this.estimateSaved(request.state) : 0);

    const metrics = response.metrics ?? {
      durationMs,
      promptTokens: cacheHit ? 0 : 0,
      completionTokens: cacheHit ? 0 : 0,
      estimatedCostUsd: 0,
      savedGenerativeTokens: totalSaved
    };

    this.telemetry.record({
      providerName: this.provider.name,
      questionCount,
      durationMs,
      promptTokens: metrics.promptTokens ?? 0,
      completionTokens: metrics.completionTokens ?? 0,
      estimatedCostUsd: metrics.estimatedCostUsd ?? 0,
      savedTokens: totalSaved
    });

    return { ...response, metrics };
  }

  /** Rough token estimate for a state object. */
  private estimateSaved(state: unknown): number {
    try { return Math.ceil(JSON.stringify(state).length / 4); } catch { return 0; }
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
    }, 'route');

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
    }, 'verify');

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
    }, 'retry');

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
    }, 'complete');

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
    }, 'escalate');

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

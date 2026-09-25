/**
 * Resilience helpers for calls to things that can hang or fail: external
 * APIs, databases, LLMs.
 *
 * ```ts
 * const breaker = createCircuitBreaker({ failureThreshold: 5, resetMs: 30_000 });
 * const data = await breaker.run(() =>
 *   retry(() => withTimeout(fetchInvoice(id), 5_000), { attempts: 3, backoffMs: 200 })
 * );
 * ```
 */

export class NexoTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message = `Timed out after ${timeoutMs}ms.`) {
    super(message);
    this.name = "NexoTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class NexoCircuitOpenError extends Error {
  /** Milliseconds until the breaker lets a trial call through. */
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Circuit is open; retry in ${retryAfterMs}ms.`);
    this.name = "NexoCircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Rejects with {@link NexoTimeoutError} if `work` does not settle within
 * `timeoutMs`. The underlying operation is not cancelled — pass an
 * AbortSignal to it as well if it supports one.
 */
export function withTimeout<T>(work: Promise<T> | (() => Promise<T>), timeoutMs: number, message?: string): Promise<T> {
  const promise = typeof work === "function" ? work() : work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NexoTimeoutError(timeoutMs, message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface RetryOptions {
  /** Total attempts including the first. Default: 3 */
  readonly attempts?: number;
  /** Delay before retry n (1-based), or a fixed delay. Default: 100ms doubling */
  readonly backoffMs?: number | ((retry: number) => number);
  /** Whether an error is worth retrying. Default: always (except an open circuit). */
  readonly retryIf?: (error: unknown, attempt: number) => boolean;
}

/** Calls `fn` until it succeeds or attempts run out; rethrows the last error. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoff = options.backoffMs ?? ((n: number) => 100 * 2 ** (n - 1));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = options.retryIf !== undefined
        ? options.retryIf(error, attempt)
        : !(error instanceof NexoCircuitOpenError);
      if (attempt === attempts || !retryable) break;
      const delay = typeof backoff === "number" ? backoff : backoff(attempt);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. Default: 5 */
  readonly failureThreshold?: number;
  /** How long the circuit stays open before a trial call. Default: 30000 */
  readonly resetMs?: number;
  /** Clock override, ms since epoch. */
  readonly now?: () => number;
  readonly onStateChange?: (state: CircuitState) => void;
}

export interface CircuitBreaker {
  /** Runs `fn` unless the circuit is open (then rejects with NexoCircuitOpenError). */
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly state: CircuitState;
  /** Closes the circuit and clears the failure count. */
  reset(): void;
}

/**
 * Stops calling a failing dependency: after `failureThreshold` consecutive
 * failures the circuit opens and calls fail fast; after `resetMs` one trial
 * call is let through — success closes the circuit, failure re-opens it.
 */
export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const threshold = Math.max(1, options.failureThreshold ?? 5);
  const resetMs = options.resetMs ?? 30_000;
  const now = options.now ?? Date.now;
  let state: CircuitState = "closed";
  let failures = 0;
  let openedAt = 0;
  let trialInFlight = false;

  function transition(next: CircuitState): void {
    if (next === state) return;
    state = next;
    options.onStateChange?.(next);
  }

  return {
    get state() {
      if (state === "open" && now() - openedAt >= resetMs) return "half-open";
      return state;
    },

    async run(fn) {
      if (state === "open") {
        const waited = now() - openedAt;
        if (waited < resetMs || trialInFlight) throw new NexoCircuitOpenError(Math.max(0, resetMs - waited));
        transition("half-open");
      } else if (state === "half-open" && trialInFlight) {
        throw new NexoCircuitOpenError(resetMs);
      }

      const trial = state === "half-open";
      if (trial) trialInFlight = true;
      try {
        const result = await fn();
        failures = 0;
        transition("closed");
        return result;
      } catch (error) {
        failures += 1;
        if (trial || failures >= threshold) {
          openedAt = now();
          transition("open");
        }
        throw error;
      } finally {
        if (trial) trialInFlight = false;
      }
    },

    reset() {
      failures = 0;
      trialInFlight = false;
      transition("closed");
    }
  };
}

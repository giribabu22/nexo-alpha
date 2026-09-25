/**
 * Fixed-window rate limiting and quotas, keyed by any string (client IP,
 * API key, user ID, tenant…). In-memory, so limits apply per process.
 *
 * ```ts
 * const limiter = createRateLimiter({ windowMs: 60_000, max: 100 });
 * const result = limiter.hit(`user:${userId}`);
 * if (!result.allowed) throw new NexoHttpError(429, "RATE_LIMITED", "Too many requests.");
 * ```
 */

export interface RateLimiterOptions {
  /** Window length in ms. */
  readonly windowMs: number;
  /** Requests allowed per key per window. */
  readonly max: number;
  /** Clock override, ms since epoch. */
  readonly now?: () => number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  /** Requests left in the current window (0 once exhausted). */
  readonly remaining: number;
  /** Milliseconds until the window resets. */
  readonly resetMs: number;
}

export interface RateLimiter {
  /** Records one request for `key` (optionally weighted by `cost`) and reports whether it is allowed. */
  hit(key: string, cost?: number): RateLimitResult;
  /** Current state for `key` without recording a request. */
  peek(key: string): RateLimitResult;
  /** Forgets `key`'s usage (e.g. after a successful login). */
  reset(key: string): void;
  /** Number of keys currently tracked. */
  readonly size: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  if (!(options.windowMs > 0) || !(options.max > 0)) {
    throw new RangeError("createRateLimiter() needs a positive windowMs and max.");
  }
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();

  /** Drops expired windows at most once per window length, so memory stays bounded by active keys. */
  function sweep(current: number): void {
    if (current - lastSweep < options.windowMs) return;
    lastSweep = current;
    for (const [key, window] of windows) {
      if (current - window.start >= options.windowMs) windows.delete(key);
    }
  }

  function state(key: string, current: number): { start: number; count: number } {
    const window = windows.get(key);
    if (window === undefined || current - window.start >= options.windowMs) {
      return { start: current, count: 0 };
    }
    return window;
  }

  function result(window: { start: number; count: number }, current: number, allowed: boolean): RateLimitResult {
    return {
      allowed,
      limit: options.max,
      remaining: Math.max(0, options.max - window.count),
      resetMs: Math.max(0, window.start + options.windowMs - current)
    };
  }

  return {
    hit(key, cost = 1) {
      const current = now();
      sweep(current);
      const window = state(key, current);
      if (window.count + cost > options.max) {
        windows.set(key, window);
        return result(window, current, false);
      }
      window.count += cost;
      windows.set(key, window);
      return result(window, current, true);
    },

    peek(key) {
      const current = now();
      const window = state(key, current);
      return result(window, current, window.count < options.max);
    },

    reset(key) {
      windows.delete(key);
    },

    get size() {
      return windows.size;
    }
  };
}

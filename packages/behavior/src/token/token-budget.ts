/**
 * TokenBudgetGuard — Hard token-count cap with field-priority pruning.
 *
 * Problem: Some ApplicationContext payloads are enormous (source trees with
 * thousands of files). Sending them blindly to a provider burns tokens and
 * may exceed context window limits, causing API errors.
 *
 * Solution:
 *  1. Estimate the token count of the outgoing payload (chars / 4)
 *  2. If under `maxTokens` → pass through unchanged
 *  3. If over budget → prune lowest-priority fields until under budget
 *     Priority tiers (highest to lowest):
 *       P0: application, developmentState  (always kept)
 *       P1: decisions, constraints         (keep if budget allows)
 *       P2: modules (truncated to top N)   (keep if budget allows)
 *       P3: intents                        (optional)
 *       P4: sourceTree, structure          (expensive, prune first)
 */

export type TokenBudgetPriority = 0 | 1 | 2 | 3 | 4;

export interface FieldPriority {
  readonly field: string;
  readonly priority: TokenBudgetPriority;
  /** If set, arrays in this field are truncated to `maxItems` before pruning the whole field. */
  readonly maxItems?: number;
}

export interface TokenBudgetOptions {
  /** Maximum token estimate before pruning. Default: 4000. */
  readonly maxTokens?: number;
  /** Chars per token (approximation). Default: 4. */
  readonly charsPerToken?: number;
  /** Custom priority config (merged with defaults). */
  readonly priorities?: readonly FieldPriority[];
}

export interface TokenBudgetResult<T = unknown> {
  readonly payload: T;
  readonly estimatedTokens: number;
  readonly pruned: readonly string[];
  readonly truncated: readonly string[];
  readonly withinBudget: boolean;
}

// ---------------------------------------------------------------------------
// Default priorities (ApplicationContext shape)
// ---------------------------------------------------------------------------

const DEFAULT_PRIORITIES: readonly FieldPriority[] = [
  { field: "sourceTree",       priority: 4 },   // Prune first — huge
  { field: "structure",        priority: 3 },   // Structural summary
  { field: "intents",          priority: 3, maxItems: 5 },
  { field: "modules",          priority: 2, maxItems: 10 },
  { field: "constraints",      priority: 1, maxItems: 20 },
  { field: "decisions",        priority: 1, maxItems: 20 },
  { field: "developmentState", priority: 0 },   // Never prune
  { field: "application",      priority: 0 }    // Never prune
];

// ---------------------------------------------------------------------------
// TokenBudgetGuard
// ---------------------------------------------------------------------------

export class TokenBudgetGuard {
  private readonly maxTokens: number;
  private readonly charsPerToken: number;
  private readonly priorities: FieldPriority[];

  constructor(options: TokenBudgetOptions = {}) {
    this.maxTokens = options.maxTokens ?? 4000;
    this.charsPerToken = options.charsPerToken ?? 4;

    // Merge custom priorities over defaults
    const custom = options.priorities ?? [];
    const merged = new Map<string, FieldPriority>();
    for (const p of DEFAULT_PRIORITIES) merged.set(p.field, p);
    for (const p of custom) merged.set(p.field, p);
    this.priorities = [...merged.values()].sort((a, b) => b.priority - a.priority);
  }

  /** Estimate token count for a JSON-serialisable value. */
  estimate(payload: unknown): number {
    return Math.ceil(JSON.stringify(payload).length / this.charsPerToken);
  }

  /**
   * Prune `payload` until it fits within `maxTokens`.
   * Returns the pruned payload and a log of what was removed/truncated.
   */
  enforce<T extends Record<string, unknown>>(payload: T): TokenBudgetResult<Record<string, unknown>> {
    const pruned: string[] = [];
    const truncated: string[] = [];
    let working: Record<string, unknown> = { ...payload };

    // Already within budget?
    if (this.estimate(working) <= this.maxTokens) {
      return {
        payload: working,
        estimatedTokens: this.estimate(working),
        pruned,
        truncated,
        withinBudget: true
      };
    }

    // Sort fields by priority descending (highest priority = pruned last)
    // We prune from priority 4 down to 1, never touching 0.
    const pruneOrder = [...this.priorities]
      .filter((p) => p.priority > 0)
      .sort((a, b) => b.priority - a.priority);

    for (const { field, priority, maxItems } of pruneOrder) {
      if (this.estimate(working) <= this.maxTokens) break;
      if (!(field in working)) continue;

      // Step 1: Array truncation before full prune
      if (
        maxItems !== undefined &&
        Array.isArray(working[field]) &&
        (working[field] as unknown[]).length > maxItems
      ) {
        working = {
          ...working,
          [field]: (working[field] as unknown[]).slice(0, maxItems)
        };
        truncated.push(`${field}[0..${maxItems}]`);

        if (this.estimate(working) <= this.maxTokens) break;
      }

      // Step 2: Full field removal
      if (priority > 0) {
        const { [field]: _, ...rest } = working;
        working = rest;
        pruned.push(field);
      }
    }

    const finalTokens = this.estimate(working);

    return {
      payload: working,
      estimatedTokens: finalTokens,
      pruned,
      truncated,
      withinBudget: finalTokens <= this.maxTokens
    };
  }
}

export function createTokenBudgetGuard(options?: TokenBudgetOptions): TokenBudgetGuard {
  return new TokenBudgetGuard(options);
}

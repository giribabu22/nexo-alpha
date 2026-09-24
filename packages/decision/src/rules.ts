/**
 * Built-in decision rule factories for common patterns.
 *
 * These are convenience helpers — you can always write a plain
 * {@link DecisionRule} object instead. They are exported from
 * `@nexo-alpha/decision` alongside the engine itself.
 *
 * All factories produce rules whose `kind` is set so they appear correctly
 * categorised in audit logs.
 */

import type {
  DecisionContext,
  DecisionOutcome,
  DecisionRule
} from "./types.js";

// ---------------------------------------------------------------------------
// Permission rule
// ---------------------------------------------------------------------------

export interface PermissionRuleOptions {
  /**
   * The name of the rule — shown in audit logs and the outcome's `rule` field.
   * Default: `"permission/<action>"` if `actions` has exactly one entry,
   *          `"permission"` otherwise.
   */
  name?: string | undefined;
  /**
   * The action(s) this rule applies to. When provided, the rule's
   * `appliesTo` guard returns `false` for any other action so the check
   * is never executed for irrelevant intents.
   */
  actions?: readonly string[] | undefined;
  /**
   * The predicate that determines whether the actor has permission.
   * Return `true` to approve, `false` to reject.
   */
  check(ctx: DecisionContext): boolean | Promise<boolean>;
  /**
   * Human-readable message returned in the REJECT outcome.
   * Default: `"Permission denied."`
   */
  message?: string | undefined;
  /**
   * Machine-readable rejection code.
   * Default: `"PERMISSION_DENIED"`
   */
  code?: string | undefined;
}

/**
 * Creates a permission rule that rejects the intent when `check` returns
 * `false`.
 *
 * ```ts
 * engine.addRule(
 *   permissionRule({
 *     name: "order-owner-only",
 *     actions: ["cancel_order", "update_order"],
 *     check({ intent }) {
 *       return intent.actor === intent.payload?.ownerId;
 *     },
 *     message: "You can only modify your own orders.",
 *   })
 * );
 * ```
 */
export function permissionRule(options: PermissionRuleOptions): DecisionRule {
  const ruleName =
    options.name ??
    (options.actions?.length === 1
      ? `permission/${options.actions[0]}`
      : "permission");

  return {
    name: ruleName,
    kind: "permission",
    description: options.message,

    appliesTo(ctx) {
      if (!options.actions) return true;
      return options.actions.includes(ctx.intent.action);
    },

    async evaluate(ctx): Promise<DecisionOutcome | undefined> {
      const allowed = await options.check(ctx);
      if (!allowed) {
        return {
          result: "REJECT",
          reason: options.message ?? "Permission denied.",
          code: options.code ?? "PERMISSION_DENIED",
          rule: ruleName
        };
      }
      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// State rule
// ---------------------------------------------------------------------------

export interface StateRuleOptions {
  name?: string | undefined;
  actions?: readonly string[] | undefined;
  /**
   * Resolves the current state of the target entity. Return the state
   * string (e.g. `"pending"`, `"shipped"`) or `undefined` if the entity
   * cannot be found.
   */
  resolveState(ctx: DecisionContext): string | undefined | Promise<string | undefined>;
  /** The state values that are valid for this action. */
  allowedStates: readonly string[];
  /**
   * Message returned when the entity is not found.
   * Default: `"Target entity not found."`
   */
  notFoundMessage?: string | undefined;
  /**
   * Message returned when the entity is in the wrong state.
   * Receives the actual state as a template parameter.
   * Default: `"Action not allowed in current state: <state>."`
   */
  invalidStateMessage?: ((state: string) => string) | undefined;
  code?: string | undefined;
}

/**
 * Creates a state rule that rejects the intent when the target entity is
 * not in one of the `allowedStates`.
 *
 * ```ts
 * engine.addRule(
 *   stateRule({
 *     name: "order-must-be-cancellable",
 *     actions: ["cancel_order"],
 *     allowedStates: ["pending", "processing"],
 *     async resolveState({ intent }) {
 *       const order = await db.orders.findById(intent.target);
 *       return order?.status;
 *     },
 *     invalidStateMessage: (s) => `Cannot cancel an order that is "${s}".`,
 *   })
 * );
 * ```
 */
export function stateRule(options: StateRuleOptions): DecisionRule {
  const ruleName = options.name ?? "state-check";

  return {
    name: ruleName,
    kind: "state",

    appliesTo(ctx) {
      if (!options.actions) return true;
      return options.actions.includes(ctx.intent.action);
    },

    async evaluate(ctx): Promise<DecisionOutcome | undefined> {
      const state = await options.resolveState(ctx);

      if (state === undefined) {
        return {
          result: "REJECT",
          reason: options.notFoundMessage ?? "Target entity not found.",
          code: options.code ?? "NOT_FOUND",
          rule: ruleName
        };
      }

      if (!options.allowedStates.includes(state)) {
        return {
          result: "REJECT",
          reason:
            options.invalidStateMessage?.(state) ??
            `Action not allowed in current state: "${state}".`,
          code: options.code ?? "INVALID_STATE",
          rule: ruleName
        };
      }

      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// Constraint rule
// ---------------------------------------------------------------------------

export interface ConstraintRuleOptions {
  name?: string | undefined;
  actions?: readonly string[] | undefined;
  /**
   * Business constraint predicate. Return `true` if the constraint is
   * satisfied (the action may proceed), `false` if it is violated.
   */
  check(ctx: DecisionContext): boolean | Promise<boolean>;
  /** Human-readable message describing the violated constraint. */
  message: string;
  code?: string | undefined;
}

/**
 * Creates a constraint rule that rejects the intent when a business rule or
 * policy is violated.
 *
 * ```ts
 * engine.addRule(
 *   constraintRule({
 *     name: "no-cancel-within-1h-of-delivery",
 *     actions: ["cancel_order"],
 *     async check({ intent }) {
 *       const order = await db.orders.findById(intent.target);
 *       if (!order?.estimatedDelivery) return true;
 *       const hoursUntilDelivery = (order.estimatedDelivery - Date.now()) / 3_600_000;
 *       return hoursUntilDelivery > 1;
 *     },
 *     message: "Orders cannot be cancelled within 1 hour of estimated delivery.",
 *   })
 * );
 * ```
 */
export function constraintRule(options: ConstraintRuleOptions): DecisionRule {
  const ruleName = options.name ?? "constraint";

  return {
    name: ruleName,
    kind: "constraint",
    description: options.message,

    appliesTo(ctx) {
      if (!options.actions) return true;
      return options.actions.includes(ctx.intent.action);
    },

    async evaluate(ctx): Promise<DecisionOutcome | undefined> {
      const satisfied = await options.check(ctx);
      if (!satisfied) {
        return {
          result: "REJECT",
          reason: options.message,
          code: options.code ?? "CONSTRAINT_VIOLATED",
          rule: ruleName
        };
      }
      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// Confirmation rule
// ---------------------------------------------------------------------------

export interface ConfirmationRuleOptions {
  name?: string | undefined;
  actions?: readonly string[] | undefined;
  /**
   * Predicate that decides whether confirmation is required. Return `true`
   * to demand confirmation (which causes an ASK_USER outcome), `false` to
   * skip the prompt.
   */
  requires(ctx: DecisionContext): boolean | Promise<boolean>;
  /** The question to surface to the user. */
  question: string;
  /** Structured hint about what kind of answer is expected. */
  expectedInput?: string | undefined;
}

/**
 * Creates a confirmation rule that surfaces an `ASK_USER` outcome when
 * the action requires explicit user confirmation.
 *
 * ```ts
 * engine.addRule(
 *   confirmationRule({
 *     name: "confirm-destructive-delete",
 *     actions: ["delete_account"],
 *     requires: () => true,
 *     question: "This will permanently delete your account and all data. Are you sure?",
 *     expectedInput: "yes / no",
 *   })
 * );
 * ```
 */
export function confirmationRule(options: ConfirmationRuleOptions): DecisionRule {
  const ruleName = options.name ?? "confirmation";

  return {
    name: ruleName,
    kind: "confirmation",
    description: options.question,

    appliesTo(ctx) {
      if (!options.actions) return true;
      return options.actions.includes(ctx.intent.action);
    },

    async evaluate(ctx): Promise<DecisionOutcome | undefined> {
      const needsConfirm = await options.requires(ctx);
      if (needsConfirm) {
        return {
          result: "ASK_USER",
          question: options.question,
          ...(options.expectedInput !== undefined && {
            expectedInput: options.expectedInput
          }),
          rule: ruleName
        };
      }
      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// Escalation rule
// ---------------------------------------------------------------------------

export interface EscalationRuleOptions {
  name?: string | undefined;
  actions?: readonly string[] | undefined;
  /**
   * Predicate that decides whether escalation is required. Return `true`
   * to escalate, `false` to let evaluation continue.
   */
  requires(ctx: DecisionContext): boolean | Promise<boolean>;
  /** Who or what role should approve this action. */
  to: string;
  /** Human-readable explanation of why escalation is needed. */
  reason: string;
}

/**
 * Creates an escalation rule that returns an `ESCALATE` outcome when the
 * action requires a higher-authority approval.
 *
 * ```ts
 * engine.addRule(
 *   escalationRule({
 *     name: "high-value-order-approval",
 *     actions: ["cancel_order"],
 *     async requires({ intent }) {
 *       const order = await db.orders.findById(intent.target);
 *       return (order?.total ?? 0) > 10_000;
 *     },
 *     to: "finance-manager",
 *     reason: "Orders over $10,000 require manager approval to cancel.",
 *   })
 * );
 * ```
 */
export function escalationRule(options: EscalationRuleOptions): DecisionRule {
  const ruleName = options.name ?? "escalation";

  return {
    name: ruleName,
    kind: "escalation",
    description: options.reason,

    appliesTo(ctx) {
      if (!options.actions) return true;
      return options.actions.includes(ctx.intent.action);
    },

    async evaluate(ctx): Promise<DecisionOutcome | undefined> {
      const needsEscalation = await options.requires(ctx);
      if (needsEscalation) {
        return {
          result: "ESCALATE",
          to: options.to,
          reason: options.reason,
          rule: ruleName
        };
      }
      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// Rate-limit rule
// ---------------------------------------------------------------------------

export interface RateLimitRuleOptions {
  name?: string | undefined;
  actions?: readonly string[] | undefined;
  /**
   * Check whether the actor is within the rate limit. Return `true` if
   * the request is allowed (within limit), `false` if it should be
   * rejected.
   */
  check(ctx: DecisionContext): boolean | Promise<boolean>;
  /** Human-readable message to return on rate-limit rejection. */
  message?: string | undefined;
  code?: string | undefined;
}

/**
 * Creates a rate-limit rule that rejects the intent when the actor
 * has exceeded an allowed request rate.
 *
 * ```ts
 * const limiter = new RateLimiterMemory({ points: 5, duration: 60 });
 *
 * engine.addRule(
 *   rateLimitRule({
 *     name: "cancel-order-rate-limit",
 *     actions: ["cancel_order"],
 *     async check({ intent }) {
 *       try {
 *         await limiter.consume(intent.actor ?? "anonymous");
 *         return true;
 *       } catch {
 *         return false;
 *       }
 *     },
 *     message: "Too many cancellation requests. Please wait before trying again.",
 *   })
 * );
 * ```
 */
export function rateLimitRule(options: RateLimitRuleOptions): DecisionRule {
  const ruleName = options.name ?? "rate-limit";

  return {
    name: ruleName,
    kind: "rate-limit",

    appliesTo(ctx) {
      if (!options.actions) return true;
      return options.actions.includes(ctx.intent.action);
    },

    async evaluate(ctx): Promise<DecisionOutcome | undefined> {
      const allowed = await options.check(ctx);
      if (!allowed) {
        return {
          result: "REJECT",
          reason:
            options.message ??
            "Request rate limit exceeded. Please try again later.",
          code: options.code ?? "RATE_LIMIT_EXCEEDED",
          rule: ruleName
        };
      }
      return undefined;
    }
  };
}

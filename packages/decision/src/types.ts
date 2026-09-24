/**
 * The resolved subject of a decision evaluation — what the LLM understood
 * the user to want, structured into typed fields rather than raw text.
 *
 * `action`   — a machine-readable verb (e.g. `"cancel_order"`, `"delete_user"`).
 * `actor`    — who is requesting the action (typically a user or agent ID).
 * `target`   — the primary entity being operated on (e.g. an order ID, filename).
 * `payload`  — any additional structured input relevant to the action.
 * `metadata` — ambient context from the request (e.g. IP, session info, source).
 */
export interface DecisionIntent {
  readonly action: string;
  readonly actor?: string | undefined;
  readonly target?: string | undefined;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * The five possible outcomes a {@link DecisionEngine} can return.
 *
 * APPROVE   — all rules passed; proceed to execute the action.
 * REJECT    — a rule explicitly blocked the action; do not execute.
 * ASK_USER  — more information is needed before a decision can be made.
 * ESCALATE  — the action requires a higher-authority approval.
 * DEFER     — the action is valid but should not be executed right now.
 */
export type DecisionOutcomeType = "APPROVE" | "REJECT" | "ASK_USER" | "ESCALATE" | "DEFER";

export interface ApproveOutcome {
  readonly result: "APPROVE";
  /** Optional human-readable note about why this was approved. */
  readonly reason?: string | undefined;
}

export interface RejectOutcome {
  readonly result: "REJECT";
  /** Human-readable explanation of why the action was rejected. */
  readonly reason: string;
  /**
   * Machine-readable code identifying the rejection category.
   * e.g. `"PERMISSION_DENIED"`, `"INVALID_STATE"`, `"CONSTRAINT_VIOLATED"`.
   */
  readonly code: string;
  /** The name of the rule that produced this rejection, if applicable. */
  readonly rule?: string | undefined;
}

export interface AskUserOutcome {
  readonly result: "ASK_USER";
  /** The question to surface to the user before continuing. */
  readonly question: string;
  /** Structured hint about what kind of answer is expected. */
  readonly expectedInput?: string | undefined;
  /** The name of the rule that triggered this, if applicable. */
  readonly rule?: string | undefined;
}

export interface EscalateOutcome {
  readonly result: "ESCALATE";
  /** Who or which role should approve this action. */
  readonly to: string;
  /** Human-readable explanation of why escalation is required. */
  readonly reason: string;
  /** The name of the rule that triggered this, if applicable. */
  readonly rule?: string | undefined;
}

export interface DeferOutcome {
  readonly result: "DEFER";
  /** ISO-8601 timestamp or relative expression for when to retry. */
  readonly until: string;
  /** Human-readable explanation of why execution is deferred. */
  readonly reason: string;
  /** The name of the rule that triggered this, if applicable. */
  readonly rule?: string | undefined;
}

export type DecisionOutcome =
  | ApproveOutcome
  | RejectOutcome
  | AskUserOutcome
  | EscalateOutcome
  | DeferOutcome;

// ---------------------------------------------------------------------------
// Rule context
// ---------------------------------------------------------------------------

/**
 * The full context available to a {@link DecisionRule} during evaluation.
 * Rules receive the intent that triggered evaluation plus any application
 * context and knowledge the engine was configured with. Both `context` and
 * `knowledge` are optional — rules may be used standalone without a running
 * Nexo application.
 */
export interface DecisionContext {
  readonly intent: DecisionIntent;
  /** The application context snapshot produced by `@nexo-alpha/context`'s `buildContext()`. */
  readonly context?: Readonly<Record<string, unknown>> | undefined;
  /** The application knowledge object from `@nexo-alpha/context`'s `createKnowledge()`. */
  readonly knowledge?: Readonly<Record<string, unknown>> | undefined;
  /** Arbitrary extra data a host application wants rules to see (e.g. a live database client, a permission store). */
  readonly extras?: Readonly<Record<string, unknown>> | undefined;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * A single decision rule evaluated by the {@link DecisionEngine}.
 *
 * Rules are async by default so they can query databases, call services,
 * or do any I/O they need. Synchronous rules just return a value directly.
 *
 * Returning `undefined` or `null` from `evaluate()` signals "no opinion" —
 * the engine treats this as a pass and moves on to the next rule. Only an
 * explicit {@link DecisionOutcome} object halts evaluation. If every rule
 * returns `undefined`/`null`, the engine produces an `APPROVE` outcome.
 *
 * The `appliesTo` guard is optional. When present, the engine calls it
 * first and skips the rule entirely if it returns `false`. This keeps
 * expensive rule logic from running on irrelevant actions.
 */
export interface DecisionRule {
  /** Unique, human-readable name used in audit logs and outcome `rule` fields. */
  readonly name: string;
  /** Optional description for documentation and debugging. */
  readonly description?: string | undefined;
  /**
   * Rule category — informational only; does not change engine behaviour.
   * Lets you group rules by kind (permission, state, constraint, …) in logs.
   */
  readonly kind?: DecisionRuleKind | undefined;
  /**
   * Optional fast-path guard. When present, the engine calls this before
   * `evaluate`. If it returns `false` the rule is skipped entirely.
   */
  appliesTo?(ctx: DecisionContext): boolean | Promise<boolean>;
  /**
   * The rule body. Return a {@link DecisionOutcome} to halt evaluation with
   * that outcome, or return `undefined`/`null` to pass through to the next
   * rule.
   */
  evaluate(ctx: DecisionContext): DecisionOutcome | null | undefined | Promise<DecisionOutcome | null | undefined>;
}

/**
 * Semantic category of a {@link DecisionRule}.
 *
 * permission  — Does the actor have the right to perform this action?
 * state       — Is the target entity in a valid state for this action?
 * constraint  — Does a business rule or policy block this action?
 * confirmation — Should the user confirm before proceeding?
 * escalation  — Does this action require a higher-authority sign-off?
 * rate-limit  — Is the actor issuing too many requests?
 * custom      — Any rule that doesn't fit the above categories.
 */
export type DecisionRuleKind =
  | "permission"
  | "state"
  | "constraint"
  | "confirmation"
  | "escalation"
  | "rate-limit"
  | "custom";

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * One entry in the {@link DecisionAuditLog} — a timestamped record of a
 * single engine evaluation: what was asked, which rules were checked,
 * and what the engine decided.
 */
export interface DecisionAuditEntry {
  /** ISO-8601 timestamp of when this evaluation completed. */
  readonly timestamp: string;
  readonly intent: DecisionIntent;
  readonly outcome: DecisionOutcome;
  /**
   * The name of every rule the engine evaluated (in order), including rules
   * that passed through with no opinion (`undefined`/`null`). Skipped rules
   * (because `appliesTo` returned `false`) are omitted.
   */
  readonly rulesEvaluated: readonly string[];
  /**
   * The name of the rule that produced the final outcome, or `undefined`
   * if the engine reached APPROVE by exhausting all rules without a halt.
   */
  readonly decidingRule?: string | undefined;
  /** Wall-clock milliseconds the engine spent on this evaluation. */
  readonly durationMs: number;
}

/**
 * An append-only audit log of every evaluation the {@link DecisionEngine}
 * has performed. Automatically maintained by the engine when `audit: true`
 * is set in {@link DecisionEngineOptions}.
 */
export interface DecisionAuditLog {
  /** All entries in the order they were recorded. */
  readonly entries: readonly DecisionAuditEntry[];
  /** Total number of entries (convenience alias for `entries.length`). */
  readonly size: number;
  /** Returns only entries whose `intent.action` matches the given string. */
  filterByAction(action: string): readonly DecisionAuditEntry[];
  /** Returns only entries with the given outcome result. */
  filterByOutcome(result: DecisionOutcomeType): readonly DecisionAuditEntry[];
  /** Clears all entries. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface DecisionEngineOptions {
  /**
   * When `true` the engine records every evaluation in its built-in
   * {@link DecisionAuditLog}. Defaults to `true`.
   */
  readonly audit?: boolean | undefined;
  /**
   * Optional label for this engine instance — appears in audit entries
   * and error messages so you can distinguish multiple engines.
   */
  readonly name?: string | undefined;
}

export interface EvaluateOptions {
  /**
   * Arbitrary extras injected into {@link DecisionContext.extras} for this
   * single evaluation — useful for passing a live DB handle or request-scoped
   * data without baking it into the engine's global config.
   */
  readonly extras?: Readonly<Record<string, unknown>> | undefined;
}

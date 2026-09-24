import type {
  DecisionAuditEntry,
  DecisionAuditLog,
  DecisionContext,
  DecisionEngineOptions,
  DecisionIntent,
  DecisionOutcome,
  DecisionRule,
  EvaluateOptions
} from "./types.js";
import { appendAuditEntry, createAuditLog } from "./audit.js";

/**
 * The Nexo Alpha Decision Engine.
 *
 * Evaluates a sequence of {@link DecisionRule}s against a
 * {@link DecisionIntent} and returns a single {@link DecisionOutcome}.
 *
 * ## Evaluation model
 *
 * Rules are evaluated in registration order. For each rule:
 * 1. If `appliesTo()` exists and returns `false`, the rule is **skipped**.
 * 2. Otherwise `evaluate()` is called.
 * 3. If the rule returns a {@link DecisionOutcome}, evaluation **halts** and
 *    that outcome is returned.
 * 4. If the rule returns `null` / `undefined`, evaluation continues to the
 *    next rule ("no opinion").
 *
 * If every rule passes without opinion, the engine returns `{ result: "APPROVE" }`.
 *
 * ## Example
 *
 * ```ts
 * import { createDecisionEngine } from "@nexo-alpha/decision";
 *
 * const engine = createDecisionEngine({ name: "order-actions" });
 *
 * engine.addRule({
 *   name: "must-own-order",
 *   kind: "permission",
 *   evaluate({ intent }) {
 *     if (intent.actor !== intent.payload?.ownerId) {
 *       return { result: "REJECT", reason: "You can only modify your own orders.", code: "PERMISSION_DENIED" };
 *     }
 *   }
 * });
 *
 * const outcome = await engine.evaluate({
 *   action: "cancel_order",
 *   actor: "user_123",
 *   payload: { ownerId: "user_456" }
 * });
 *
 * // outcome.result === "REJECT"
 * ```
 */
export class DecisionEngine {
  private readonly _name: string;
  private readonly _audit: boolean;
  private readonly _rules: DecisionRule[] = [];
  private readonly _auditLog: DecisionAuditLog;

  /**
   * Shared application context and knowledge, set once per engine instance.
   * Individual `evaluate()` calls can add extras but cannot override these.
   */
  private _context?: Readonly<Record<string, unknown>> | undefined;
  private _knowledge?: Readonly<Record<string, unknown>> | undefined;

  constructor(options: DecisionEngineOptions = {}) {
    this._name = options.name ?? "nexo-decision-engine";
    this._audit = options.audit ?? true;
    this._auditLog = createAuditLog();
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /** Human-readable name of this engine instance. */
  get name(): string {
    return this._name;
  }

  /** The total number of rules registered on this engine. */
  get ruleCount(): number {
    return this._rules.length;
  }

  /**
   * Registers one or more rules. Rules are evaluated in registration order.
   * Returns `this` for chaining.
   *
   * Throws if a rule with the same `name` has already been added — rule names
   * must be unique within an engine to keep audit logs unambiguous.
   */
  addRule(...rules: DecisionRule[]): this {
    for (const rule of rules) {
      if (this._rules.some((r) => r.name === rule.name)) {
        throw new Error(
          `[${this._name}] A decision rule named "${rule.name}" is already registered.`
        );
      }
      this._rules.push(rule);
    }
    return this;
  }

  /**
   * Removes a previously registered rule by name.
   * Returns `true` if the rule was found and removed, `false` otherwise.
   */
  removeRule(name: string): boolean {
    const index = this._rules.findIndex((r) => r.name === name);
    if (index === -1) return false;
    this._rules.splice(index, 1);
    return true;
  }

  /** Returns the names of all registered rules in evaluation order. */
  getRuleNames(): readonly string[] {
    return this._rules.map((r) => r.name);
  }

  /**
   * Attaches an application context snapshot (from `@nexo-alpha/context`'s
   * `buildContext()`) so every rule can read it without the caller having to
   * pass it on every `evaluate()` call.
   */
  setContext(context: Readonly<Record<string, unknown>>): this {
    this._context = context;
    return this;
  }

  /**
   * Attaches application knowledge (from `@nexo-alpha/context`'s
   * `createKnowledge()`) so every rule can read constraints, decisions,
   * and intents.
   */
  setKnowledge(knowledge: Readonly<Record<string, unknown>>): this {
    this._knowledge = knowledge;
    return this;
  }

  // -------------------------------------------------------------------------
  // Evaluation
  // -------------------------------------------------------------------------

  /**
   * Evaluates all registered rules against the given intent and returns a
   * {@link DecisionOutcome}.
   *
   * This method is async because rules may perform I/O (database lookups,
   * HTTP calls, etc.). For synchronous rule sets it still resolves
   * synchronously — no artificial delay is introduced.
   */
  async evaluate(
    intent: DecisionIntent,
    options: EvaluateOptions = {}
  ): Promise<DecisionOutcome> {
    const startMs = Date.now();

    const ctx: DecisionContext = {
      intent,
      context: this._context,
      knowledge: this._knowledge,
      extras: options.extras
    };

    const rulesEvaluated: string[] = [];
    let decidingRule: string | undefined;
    let outcome: DecisionOutcome = { result: "APPROVE" };

    for (const rule of this._rules) {
      // Fast-path guard
      if (rule.appliesTo !== undefined) {
        const applies = await rule.appliesTo(ctx);
        if (!applies) continue;
      }

      rulesEvaluated.push(rule.name);

      const result = await rule.evaluate(ctx);

      if (result !== null && result !== undefined) {
        // Rule produced a decisive outcome — halt.
        outcome = result;
        decidingRule = rule.name;
        break;
      }
    }

    const durationMs = Date.now() - startMs;

    if (this._audit) {
      const entry: DecisionAuditEntry = {
        timestamp: new Date().toISOString(),
        intent,
        outcome,
        rulesEvaluated,
        ...(decidingRule !== undefined && { decidingRule }),
        durationMs
      };
      appendAuditEntry(this._auditLog, entry);
    }

    return outcome;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  /**
   * The engine's built-in audit log.
   * Only populated when `audit: true` was set in the constructor options
   * (which is the default). Always safe to call — the log is just empty
   * when auditing is disabled.
   */
  get auditLog(): DecisionAuditLog {
    return this._auditLog;
  }
}

/**
 * Creates a new {@link DecisionEngine} instance.
 *
 * ```ts
 * const engine = createDecisionEngine({ name: "order-actions" });
 * ```
 */
export function createDecisionEngine(
  options: DecisionEngineOptions = {}
): DecisionEngine {
  return new DecisionEngine(options);
}

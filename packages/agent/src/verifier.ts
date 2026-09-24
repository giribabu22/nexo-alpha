import type { DecisionIntent } from "@nexo-alpha/decision";
import type { ToolResult } from "./tool-registry.js";

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

/**
 * What the verifier concluded about a completed tool execution.
 *
 * COMPLETE  — the action succeeded and the result is confirmed.
 * FAILURE   — the action failed or the result is invalid.
 */
export type VerificationStatus = "COMPLETE" | "FAILURE";

export interface VerificationResult {
  readonly status: VerificationStatus;
  /** Human-readable explanation of the verification conclusion. */
  readonly reason?: string | undefined;
  /**
   * What the agent should do next when `status` is `"FAILURE"`.
   * Absent when `status` is `"COMPLETE"`.
   */
  readonly recovery?: FailureRecovery | undefined;
}

/**
 * The three recovery strategies for a failed verification.
 *
 * RETRY     — the failure is likely transient; the agent may retry.
 * ESCALATE  — a human or higher authority should decide.
 * ABORT     — the failure is unrecoverable; stop and log.
 */
export type FailureRecovery = "RETRY" | "ESCALATE" | "ABORT";

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

/**
 * The context available to a {@link ResultVerifier} during verification.
 */
export interface VerificationContext {
  /** The intent that triggered the tool call. */
  readonly intent: DecisionIntent;
  /** The result the tool returned. */
  readonly result: ToolResult;
  /** Which attempt this is (1-based). Always 1 unless the agent retried. */
  readonly attempt: number;
}

/**
 * A verifier checks whether a tool's result is actually valid — not just
 * that the tool didn't throw. For example: a payment tool may return
 * `{ success: true }` but the payment might not have cleared yet, or the
 * confirmation ID might be missing.
 *
 * Returning `undefined`/`null` means "no opinion — use default verification"
 * (which checks `result.success`). This lets you register verifiers only
 * for the actions that need custom logic.
 */
export interface ResultVerifier {
  /**
   * The action this verifier applies to, or `"*"` to apply to every action
   * that has no specific verifier registered.
   */
  readonly action: string;
  verify(ctx: VerificationContext): VerificationResult | null | undefined | Promise<VerificationResult | null | undefined>;
}

/**
 * A registry of {@link ResultVerifier}s, one per action name.
 * The verifier registry is kept separate from the tool registry so the
 * verification concern doesn't bleed into action execution.
 */
export interface VerifierRegistry {
  /** Registers a verifier for an action. Overwrites any existing entry. */
  register(verifier: ResultVerifier): this;
  /** Verifies a tool result using the registered verifier (or default logic). */
  verify(ctx: VerificationContext): Promise<VerificationResult>;
}

// ---------------------------------------------------------------------------
// Default verification
// ---------------------------------------------------------------------------

/**
 * Default verification logic used when no specific verifier is registered
 * for an action. Checks `result.success` and maps to COMPLETE / FAILURE.
 * On failure, uses RETRY when there's no error message (likely a network
 * blip), ABORT otherwise.
 */
function defaultVerification(ctx: VerificationContext): VerificationResult {
  if (ctx.result.success) {
    return { status: "COMPLETE" };
  }

  // Distinguish transient vs. deterministic failures heuristically:
  // an empty error string suggests a network-level failure (RETRY),
  // a real message suggests a logical failure (ABORT).
  const recovery: FailureRecovery = ctx.result.error
    ? "ABORT"
    : "RETRY";

  return {
    status: "FAILURE",
    reason: ctx.result.error ?? "Tool returned failure with no error message.",
    recovery
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new {@link VerifierRegistry}.
 *
 * ```ts
 * const verifiers = createVerifierRegistry();
 *
 * verifiers.register({
 *   action: "refund_order",
 *   async verify({ result }) {
 *     if (!result.success) return { status: "FAILURE", reason: result.error, recovery: "RETRY" };
 *     const data = result.data as { refundId?: string };
 *     if (!data.refundId) return { status: "FAILURE", reason: "No refund ID returned.", recovery: "ESCALATE" };
 *     return { status: "COMPLETE" };
 *   }
 * });
 * ```
 */
export function createVerifierRegistry(): VerifierRegistry {
  const map = new Map<string, ResultVerifier>();

  return {
    register(verifier) {
      map.set(verifier.action, verifier);
      return this;
    },

    async verify(ctx) {
      // Specific verifier takes priority, then wildcard, then default.
      const verifier = map.get(ctx.intent.action) ?? map.get("*");

      if (verifier) {
        const result = await verifier.verify(ctx);
        if (result !== null && result !== undefined) {
          return result;
        }
      }

      return defaultVerification(ctx);
    }
  };
}

import type { DecisionIntent, DecisionOutcome } from "@nexo-alpha/decision";
import type { ToolResult } from "./tool-registry.js";
import type { VerificationResult } from "./verifier.js";

/**
 * A complete record of one agent execution:
 * intent → decision → action → verification → final status.
 *
 * This is the cross-cutting AUDIT record that spans every layer of the
 * `UNDERSTAND → KNOW → DECIDE → ACT → VERIFY` lifecycle.
 *
 * Unlike `@nexo-alpha/decision`'s `DecisionAuditEntry` (which records only
 * the DECIDE layer), an `ExecutionRecord` captures the full lifecycle from
 * intent receipt to final verified outcome.
 */
export interface ExecutionRecord {
  /** Unique ID for this execution. */
  readonly id: string;
  /** ISO-8601 timestamp when execution began. */
  readonly startedAt: string;
  /** ISO-8601 timestamp when execution completed (including verification). */
  readonly completedAt: string;
  /** Total wall-clock time from intent receipt to verified outcome. */
  readonly totalDurationMs: number;

  /** The intent that was evaluated. */
  readonly intent: DecisionIntent;

  /** What the Decision Engine returned. */
  readonly decision: DecisionOutcome;

  /**
   * The tool result — present only when `decision.result === "APPROVE"`
   * and a tool was actually executed.
   */
  readonly toolResult?: ToolResult | undefined;

  /**
   * The verification result — present only when a tool was executed and
   * verification was performed.
   */
  readonly verificationResult?: VerificationResult | undefined;

  /**
   * The attempt number (1-based). Greater than 1 if the agent retried.
   */
  readonly attempt: number;

  /**
   * The final status of this execution record.
   *
   * APPROVED_AND_COMPLETE   — Decision: APPROVE, tool ran, verification: COMPLETE
   * APPROVED_AND_FAILED     — Decision: APPROVE, tool ran, verification: FAILURE
   * BLOCKED                 — Decision was not APPROVE (REJECT/ASK_USER/ESCALATE/DEFER)
   * ERROR                   — Unexpected runtime error during execution
   */
  readonly status: ExecutionStatus;

  /** Only present when `status === "ERROR"` */
  readonly error?: string | undefined;
}

export type ExecutionStatus =
  | "APPROVED_AND_COMPLETE"
  | "APPROVED_AND_FAILED"
  | "BLOCKED"
  | "ERROR";

/**
 * The agent's execution audit log — a cross-cutting record of every
 * `agent.execute()` call, spanning all five lifecycle layers.
 *
 * AUDIT is not a sequential layer — it is a concern that runs across all of:
 * DECIDE (decision recorded), ACT (tool result recorded), VERIFY (verification
 * recorded), and surfaced as a single joined record here.
 */
export interface ExecutionAuditLog {
  readonly entries: readonly ExecutionRecord[];
  readonly size: number;
  filterByAction(action: string): readonly ExecutionRecord[];
  filterByStatus(status: ExecutionStatus): readonly ExecutionRecord[];
  clear(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an in-memory audit log. Once `maxEntries` records are held, the
 * oldest are dropped — stream records to durable storage with an agent's
 * `auditSink` if you need the full history.
 */
export function createExecutionAuditLog(maxEntries = Number.POSITIVE_INFINITY): ExecutionAuditLog {
  const entries: ExecutionRecord[] = [];

  const log: ExecutionAuditLog = {
    get entries() {
      return entries as readonly ExecutionRecord[];
    },

    get size() {
      return entries.length;
    },

    filterByAction(action) {
      return entries.filter((e) => e.intent.action === action);
    },

    filterByStatus(status) {
      return entries.filter((e) => e.status === status);
    },

    clear() {
      entries.length = 0;
    }
  };

  (log as unknown as { _append(r: ExecutionRecord): void })._append = (r: ExecutionRecord) => {
    entries.push(r);
    if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
  };

  return log;
}

export function appendExecutionRecord(log: ExecutionAuditLog, record: ExecutionRecord): void {
  (log as unknown as { _append(r: ExecutionRecord): void })._append(record);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _counter = 0;

/** Generates a simple monotonic execution ID. Format: `exec-<timestamp>-<counter>`. */
export function generateExecutionId(): string {
  _counter += 1;
  return `exec-${Date.now()}-${_counter}`;
}

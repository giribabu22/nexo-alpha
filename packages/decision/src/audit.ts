import type {
  DecisionAuditEntry,
  DecisionAuditLog,
  DecisionOutcomeType
} from "./types.js";

/**
 * Creates a new in-memory {@link DecisionAuditLog}.
 *
 * The log is append-only during normal use — entries are only removed by
 * an explicit `clear()` call. It is not thread-safe (Node.js is
 * single-threaded so this is fine in practice).
 */
export function createAuditLog(): DecisionAuditLog {
  const entries: DecisionAuditEntry[] = [];

  const log: DecisionAuditLog = {
    get entries() {
      return entries as readonly DecisionAuditEntry[];
    },

    get size() {
      return entries.length;
    },

    filterByAction(action: string): readonly DecisionAuditEntry[] {
      return entries.filter((entry) => entry.intent.action === action);
    },

    filterByOutcome(result: DecisionOutcomeType): readonly DecisionAuditEntry[] {
      return entries.filter((entry) => entry.outcome.result === result);
    },

    clear(): void {
      entries.length = 0;
    }
  };

  /** Internal — only the engine calls this. */
  (log as unknown as { _append(entry: DecisionAuditEntry): void })._append = (
    entry: DecisionAuditEntry
  ): void => {
    entries.push(entry);
  };

  return log;
}

/** Internal helper — appends an entry without exposing the method publicly. */
export function appendAuditEntry(log: DecisionAuditLog, entry: DecisionAuditEntry): void {
  (log as unknown as { _append(entry: DecisionAuditEntry): void })._append(entry);
}

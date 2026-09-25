/**
 * Durable audit trail: every agent execution record (who asked for what, what
 * the Decision Engine decided, what the tool did, how it was verified) stored
 * in a `@nexo-alpha/core` {@link NexoDocumentStore}.
 *
 * ```ts
 * const audit = createDocumentAuditTrail(store);
 * const agent = createAgent({ decisionEngine, auditSink: audit.sink });
 * const denied = await audit.query({ status: "BLOCKED", since: "2026-09-01T00:00:00Z" });
 * ```
 */

import type { NexoDocumentStore } from "@nexo-alpha/core";
import type { ExecutionRecord, ExecutionStatus } from "./audit.js";

export interface AuditQuery {
  readonly actor?: string | undefined;
  readonly action?: string | undefined;
  readonly status?: ExecutionStatus | undefined;
  /** Decision outcome, e.g. "REJECT" or "ASK_USER". */
  readonly decision?: string | undefined;
  /** ISO-8601; records that started at or after this time. */
  readonly since?: string | undefined;
  /** ISO-8601; records that started before this time. */
  readonly until?: string | undefined;
  /** Most recent first; default: all. */
  readonly limit?: number | undefined;
}

export interface DocumentAuditTrail {
  /** Pass as `createAgent({ auditSink })`. */
  readonly sink: (record: ExecutionRecord) => Promise<void>;
  /** Matching records, most recent first. */
  query(filter?: AuditQuery): Promise<ExecutionRecord[]>;
}

export interface DocumentAuditTrailOptions {
  /** Collection holding records. Default: "audit_log" */
  readonly collection?: string | undefined;
}

export function createDocumentAuditTrail(store: NexoDocumentStore, options: DocumentAuditTrailOptions = {}): DocumentAuditTrail {
  const collection = options.collection ?? "audit_log";

  return {
    sink: (record) => store.put(collection, record.id, record),

    async query(filter = {}) {
      const matches = (await store.list<ExecutionRecord>(collection)).filter((record) =>
        (filter.actor === undefined || record.intent.actor === filter.actor) &&
        (filter.action === undefined || record.intent.action === filter.action) &&
        (filter.status === undefined || record.status === filter.status) &&
        (filter.decision === undefined || record.decision.result === filter.decision) &&
        (filter.since === undefined || record.startedAt >= new Date(filter.since).toISOString()) &&
        (filter.until === undefined || record.startedAt < new Date(filter.until).toISOString())
      );
      matches.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
      return filter.limit !== undefined ? matches.slice(0, filter.limit) : matches;
    }
  };
}

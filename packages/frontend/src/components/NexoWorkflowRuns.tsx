import React, { useState } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";
import { NexoBadge, type NexoBadgeVariant } from "./NexoBadge.js";
import { NexoButton } from "./NexoButton.js";
import { NexoCard } from "./NexoCard.js";
import { useWorkflowActions, useWorkflowRun, useWorkflowRuns } from "../workflow-hooks.js";
import type { WorkflowRun, WorkflowRunStatus, WorkflowStepRecord } from "../workflows.js";

const STATUS_VARIANTS: Readonly<Record<WorkflowRunStatus, NexoBadgeVariant>> = {
  RUNNING: "info",
  WAITING: "warning",
  ESCALATED: "purple",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral"
};

const STEP_VARIANTS: Readonly<Record<WorkflowStepRecord["status"], NexoBadgeVariant>> = {
  APPROVED_AND_COMPLETE: "success",
  APPROVED_AND_FAILED: "danger",
  BLOCKED: "warning",
  ERROR: "danger"
};

const muted: React.CSSProperties = { color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.85rem" };

/** Status badge for a workflow run (pulses while RUNNING). */
export function NexoWorkflowStatusBadge({ status }: { readonly status: WorkflowRunStatus }): React.JSX.Element {
  return (
    <NexoBadge variant={STATUS_VARIANTS[status]} pulse={status === "RUNNING"} size="sm">
      {status}
    </NexoBadge>
  );
}

// ---------------------------------------------------------------------------
// Run list
// ---------------------------------------------------------------------------

export interface NexoWorkflowRunListProps {
  readonly id?: string | undefined;
  readonly runs: readonly WorkflowRun[];
  readonly selectedRunId?: string | undefined;
  readonly onSelect?: ((run: WorkflowRun) => void) | undefined;
  readonly emptyMessage?: string | undefined;
}

export const NexoWorkflowRunListComp: NexoComp<NexoWorkflowRunListProps> = nexoComp<NexoWorkflowRunListProps>({
  name: "NexoWorkflowRunList",
  purpose: "Table of workflow runs with status, goal and step count",
  render: ({ runs, selectedRunId, onSelect, emptyMessage }) => {
    if (runs.length === 0) {
      return <p className="nexo-workflow-runs-empty" style={muted}>{emptyMessage ?? "No runs yet."}</p>;
    }
    return (
      <table className="nexo-workflow-runs" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", ...muted }}>
            <th>Status</th>
            <th>Goal</th>
            <th>Steps</th>
            <th>Run</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              data-run-id={run.id}
              aria-selected={run.id === selectedRunId}
              onClick={onSelect !== undefined ? () => onSelect(run) : undefined}
              style={{
                cursor: onSelect !== undefined ? "pointer" : "default",
                background: run.id === selectedRunId ? "var(--nexo-border, rgba(255,255,255,0.08))" : undefined
              }}
            >
              <td><NexoWorkflowStatusBadge status={run.status} /></td>
              <td>{run.goal}</td>
              <td>{run.history.length}</td>
              <td style={muted}><code>{run.id}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
});

export const NexoWorkflowRunList = NexoWorkflowRunListComp;

// ---------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------

export interface NexoWorkflowRunDetailProps {
  readonly id?: string | undefined;
  readonly run: WorkflowRun;
  /**
   * Called with the parsed JSON (or raw text) response when a paused run is
   * resumed. The resume form is shown only when this is provided and the
   * run is WAITING or ESCALATED.
   */
  readonly onResume?: ((response: unknown) => void | Promise<unknown>) | undefined;
  readonly resuming?: boolean | undefined;
}

function parseResponse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function StepRow({ record, index }: { readonly record: WorkflowStepRecord; readonly index: number }): React.JSX.Element {
  const detail = record.error ?? record.toolResult?.error ?? record.decision.reason ?? record.verificationResult?.reason;
  return (
    <li className="nexo-workflow-step" style={{ display: "flex", gap: "10px", alignItems: "baseline", padding: "6px 0" }}>
      <span style={muted}>#{index + 1}</span>
      <strong>{record.intent.action}</strong>
      <NexoBadge variant={STEP_VARIANTS[record.status]} size="sm">{record.status}</NexoBadge>
      <span style={muted}>decision: {record.decision.result}</span>
      <span style={muted}>{record.totalDurationMs}ms</span>
      {record.intent.actor !== undefined && <span style={muted}>by {record.intent.actor}</span>}
      {detail !== undefined && <span className="nexo-workflow-step-detail" style={muted}>— {detail}</span>}
    </li>
  );
}

export const NexoWorkflowRunDetailComp: NexoComp<NexoWorkflowRunDetailProps> = nexoComp<NexoWorkflowRunDetailProps>({
  name: "NexoWorkflowRunDetail",
  purpose: "One workflow run: status, steps, pending decision and resume form",
  render: ({ run, onResume, resuming }) => {
    const [responseText, setResponseText] = useState("");
    const paused = run.status === "WAITING" || run.status === "ESCALATED";

    return (
      <NexoCard
        title={run.goal}
        subtitle={<code>{run.workflowName} · {run.id}</code>}
        badge={<NexoWorkflowStatusBadge status={run.status} />}
      >
        {run.error !== undefined && (
          <p className="nexo-workflow-error" style={{ color: "var(--nexo-danger, #ef4444)" }}>{run.error}</p>
        )}

        {run.history.length === 0 ? (
          <p style={muted}>{run.status === "RUNNING" ? "Waiting for the first step…" : "No steps were executed."}</p>
        ) : (
          <ol className="nexo-workflow-steps" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {run.history.map((record, index) => <StepRow key={record.id} record={record} index={index} />)}
          </ol>
        )}

        {paused && run.pendingDecision !== undefined && (
          <div className="nexo-workflow-pending" style={{ marginTop: "12px" }}>
            <strong>{run.status === "WAITING" ? "Waiting for input" : `Escalated${run.pendingDecision.to !== undefined ? ` to ${run.pendingDecision.to}` : ""}`}</strong>
            <p style={muted}>{run.pendingDecision.question ?? run.pendingDecision.reason ?? run.pendingDecision.result}</p>
            {onResume !== undefined && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void onResume(parseResponse(responseText));
                }}
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                <textarea
                  aria-label="Response (JSON or text)"
                  placeholder='Optional response, e.g. {"approved": true}'
                  value={responseText}
                  onChange={(event) => setResponseText(event.target.value)}
                  rows={3}
                />
                <NexoButton type="submit" variant="primary" size="sm" loading={resuming === true}>Resume</NexoButton>
              </form>
            )}
          </div>
        )}

        {run.status === "COMPLETED" && run.result !== undefined && (
          <pre className="nexo-workflow-result" style={{ ...muted, whiteSpace: "pre-wrap" }}>
            {typeof run.result === "string" ? run.result : JSON.stringify(run.result, null, 2)}
          </pre>
        )}
      </NexoCard>
    );
  }
});

export const NexoWorkflowRunDetail = NexoWorkflowRunDetailComp;

// ---------------------------------------------------------------------------
// Connected dashboard
// ---------------------------------------------------------------------------

export interface NexoWorkflowDashboardProps {
  readonly id?: string | undefined;
  readonly workflow: string;
  /** Run-list refresh interval. Default: 5000 */
  readonly pollInterval?: number | undefined;
}

export const NexoWorkflowDashboardComp: NexoComp<NexoWorkflowDashboardProps> = nexoComp<NexoWorkflowDashboardProps>({
  name: "NexoWorkflowDashboard",
  purpose: "Start, list, inspect and resume the runs of one workflow",
  render: ({ workflow, pollInterval }) => {
    const [goal, setGoal] = useState("");
    const [selected, setSelected] = useState<string | undefined>(undefined);
    const { runs, error: listError, refetch } = useWorkflowRuns(workflow, { pollInterval: pollInterval ?? 5000 });
    const { run } = useWorkflowRun(workflow, selected);
    const actions = useWorkflowActions(workflow);

    const start = async (): Promise<void> => {
      if (goal.trim() === "") return;
      const created = await actions.start({ goal: goal.trim() });
      setGoal("");
      setSelected(created.id);
      await refetch();
    };

    return (
      <div className="nexo-workflow-dashboard" style={{ display: "grid", gap: "16px" }}>
        <NexoCard title={`Workflow: ${workflow}`}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void start().catch(() => undefined);
            }}
            style={{ display: "flex", gap: "8px" }}
          >
            <input
              aria-label="Goal"
              placeholder="Describe the goal for a new run"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              style={{ flex: 1 }}
            />
            <NexoButton type="submit" variant="primary" loading={actions.pending}>Start run</NexoButton>
          </form>
          {(actions.error ?? listError) !== null && (
            <p style={{ color: "var(--nexo-danger, #ef4444)" }}>{(actions.error ?? listError)?.message}</p>
          )}
          <NexoWorkflowRunList runs={runs} selectedRunId={selected} onSelect={(r) => setSelected(r.id)} />
        </NexoCard>

        {run !== null && (
          <NexoWorkflowRunDetail
            run={run}
            resuming={actions.pending}
            onResume={async (response) => {
              await actions.resume(run.id, response).catch(() => undefined);
              await refetch();
            }}
          />
        )}
      </div>
    );
  }
});

export const NexoWorkflowDashboard = NexoWorkflowDashboardComp;

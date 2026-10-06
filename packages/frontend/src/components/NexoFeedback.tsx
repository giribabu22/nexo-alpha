import React, { type ReactNode } from "react";
import { NexoButton } from "./NexoButton.js";

const muted = "var(--nexo-text-secondary, #94a3b8)";

export interface NexoLoaderProps {
  /** Default: "Loading…" */
  readonly label?: ReactNode;
}

/** Shown while data loads for the first time. */
export function NexoLoader({ label = "Loading…" }: NexoLoaderProps): React.JSX.Element {
  return (
    <div role="status" aria-live="polite" style={{ padding: "24px 0", textAlign: "center", color: muted }}>
      <span className="nexo-pulse-dot" style={{ display: "inline-block", marginRight: "8px" }}>●</span>
      {label}
    </div>
  );
}

export interface NexoErrorStateProps {
  readonly error: Error | string;
  /** Shows a "Try again" button. */
  readonly onRetry?: (() => void) | undefined;
  /** Default: "Something went wrong" */
  readonly title?: ReactNode;
}

/** Shown in place of content that failed to load. */
export function NexoErrorState({ error, onRetry, title = "Something went wrong" }: NexoErrorStateProps): React.JSX.Element {
  const message = typeof error === "string" ? error : error.message;
  return (
    <div
      role="alert"
      style={{
        padding: "16px",
        borderRadius: "10px",
        border: "1px solid var(--nexo-danger, #ef4444)",
        background: "rgba(239, 68, 68, 0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px"
      }}
    >
      <div>
        <div style={{ fontWeight: 600, color: "var(--nexo-danger, #ef4444)" }}>{title}</div>
        <div style={{ fontSize: "0.9rem", color: muted, marginTop: "4px" }}>{message}</div>
      </div>
      {onRetry && (
        <NexoButton variant="secondary" size="sm" onClick={() => onRetry()}>
          Try again
        </NexoButton>
      )}
    </div>
  );
}

export interface NexoEmptyStateProps {
  /** Default: "Nothing here yet" */
  readonly title?: ReactNode;
  /** Extra explanation. */
  readonly children?: ReactNode;
  /** E.g. a button that creates the first item. */
  readonly action?: ReactNode;
}

/** Shown when a list has no items. */
export function NexoEmptyState({ title = "Nothing here yet", children, action }: NexoEmptyStateProps): React.JSX.Element {
  return (
    <div style={{ padding: "32px 16px", textAlign: "center", color: muted }}>
      <div style={{ fontWeight: 600, color: "var(--nexo-text-primary, #f8fafc)" }}>{title}</div>
      {children && <div style={{ marginTop: "6px", fontSize: "0.9rem" }}>{children}</div>}
      {action && <div style={{ marginTop: "16px" }}>{action}</div>}
    </div>
  );
}

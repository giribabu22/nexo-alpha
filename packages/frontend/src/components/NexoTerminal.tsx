import React, { useState, useRef, useEffect, type ReactNode } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";

export interface TerminalEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly level: "info" | "success" | "warn" | "error";
  readonly source?: string | undefined;
  readonly message: string;
  readonly payload?: unknown | undefined;
}

export interface NexoTerminalProps {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly entries: readonly TerminalEntry[];
  readonly maxHeight?: string | number | undefined;
  readonly onClear?: (() => void) | undefined;
  readonly headerExtra?: ReactNode | undefined;
}

export const NexoTerminalComp: NexoComp<NexoTerminalProps> = nexoComp<NexoTerminalProps>({
  name: "NexoTerminal",
  purpose: "Live streaming console output for logs, RPC calls, and DSC execution events",
  render: ({
    title = "Nexo Runtime Execution Console",
    entries,
    maxHeight = 320,
    onClear,
    headerExtra
  }) => {
    const [filter, setFilter] = useState("");
    const endRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [entries.length]);

    const filteredEntries = filter
      ? entries.filter(
          (e) =>
            e.message.toLowerCase().includes(filter.toLowerCase()) ||
            (e.source && e.source.toLowerCase().includes(filter.toLowerCase()))
        )
      : entries;

    const getLevelColor = (level: TerminalEntry["level"]) => {
      switch (level) {
        case "success":
          return "#4ade80";
        case "warn":
          return "#fbbf24";
        case "error":
          return "#f87171";
        case "info":
        default:
          return "#38bdf8";
      }
    };

    return (
      <div
        className="nexo-panel"
        style={{
          background: "rgba(10, 15, 26, 0.85)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "14px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "0.85rem",
          overflow: "hidden",
          padding: 0
        }}
      >
        {/* Console Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 16px",
            background: "rgba(255, 255, 255, 0.04)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444" }} />
              <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#f59e0b" }} />
              <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981" }} />
            </div>
            <span style={{ fontWeight: 600, color: "var(--nexo-text-primary, #f8fafc)" }}>{title}</span>
            <span style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.75rem" }}>
              ({filteredEntries.length} logs)
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="text"
              placeholder="Filter logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "0.75rem",
                color: "#fff",
                outline: "none"
              }}
            />
            {headerExtra}
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--nexo-text-secondary, #94a3b8)",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  padding: "4px 8px"
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Console Output Body */}
        <div
          style={{
            maxHeight,
            overflowY: "auto",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            lineHeight: 1.5
          }}
        >
          {filteredEntries.length === 0 ? (
            <div style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
              No console events recorded yet.
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div key={entry.id} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                <span style={{ color: "rgba(148, 163, 184, 0.5)", userSelect: "none", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  {entry.timestamp.split("T")[1]?.slice(0, 8) ?? entry.timestamp}
                </span>
                <span
                  style={{
                    color: getLevelColor(entry.level),
                    fontWeight: 700,
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    width: "55px",
                    textAlign: "right"
                  }}
                >
                  [{entry.level}]
                </span>
                {entry.source && (
                  <span style={{ color: "var(--nexo-accent, #38bdf8)", fontWeight: 600 }}>
                    ({entry.source})
                  </span>
                )}
                <span style={{ color: "var(--nexo-text-primary, #f8fafc)", wordBreak: "break-word" }}>
                  {entry.message}
                </span>
                {entry.payload !== undefined && (
                  <pre
                    style={{
                      margin: "4px 0 0 0",
                      padding: "4px 8px",
                      background: "rgba(0, 0, 0, 0.4)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      color: "#94a3b8"
                    }}
                  >
                    {typeof entry.payload === "string" ? entry.payload : JSON.stringify(entry.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>
    );
  }
});

export const NexoTerminal = NexoTerminalComp;

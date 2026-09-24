import React, { type ReactNode } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";

export interface NexoMetricProps {
  readonly id?: string | undefined;
  readonly value: ReactNode;
  readonly label: string;
  readonly icon?: ReactNode | undefined;
  readonly trend?: {
    readonly direction: "up" | "down" | "neutral";
    readonly value: string;
  } | undefined;
  readonly accentColor?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly style?: React.CSSProperties | undefined;
}

export const NexoMetricComp: NexoComp<NexoMetricProps> = nexoComp<NexoMetricProps>({
  name: "NexoMetric",
  purpose: "High-impact KPI metric stat box with trend indicator and DAG tracking",
  render: ({
    value,
    label,
    icon,
    trend,
    accentColor = "var(--nexo-accent, #38bdf8)",
    onClick,
    style
  }) => {
    const isClickable = typeof onClick === "function";

    return (
      <div
        className="nexo-stat-box"
        style={{
          cursor: isClickable ? "pointer" : "default",
          transition: "all 0.2s ease",
          ...style
        }}
        onClick={onClick}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <span className="nexo-stat-label">{label}</span>
          {icon && <span style={{ fontSize: "1.2rem", opacity: 0.85 }}>{icon}</span>}
        </div>

        <div
          className="nexo-stat-val"
          style={{ color: accentColor }}
        >
          {value}
        </div>

        {trend && (
          <div style={{ marginTop: "6px", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "4px" }}>
            <span
              style={{
                color: trend.direction === "up" ? "#4ade80" : trend.direction === "down" ? "#f87171" : "#94a3b8",
                fontWeight: 700
              }}
            >
              {trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "•"} {trend.value}
            </span>
            <span style={{ color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.72rem" }}>vs prev</span>
          </div>
        )}
      </div>
    );
  }
});

export const NexoMetric = NexoMetricComp;

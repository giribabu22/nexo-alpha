import React, { type ReactNode } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";

export type NexoBadgeVariant =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "purple"
  | "cyan"
  | "neutral";

export interface NexoBadgeProps {
  readonly id?: string | undefined;
  readonly variant?: NexoBadgeVariant | undefined;
  readonly pulse?: boolean | undefined;
  readonly icon?: ReactNode | undefined;
  readonly size?: "sm" | "md" | undefined;
  readonly className?: string | undefined;
  readonly style?: React.CSSProperties | undefined;
  readonly children: ReactNode;
}

export const NexoBadgeComp: NexoComp<NexoBadgeProps> = nexoComp<NexoBadgeProps>({
  name: "NexoBadge",
  purpose: "Status indicator badge with pulse animation and variant themes",
  dsa: {
    trackDirty: false,
    lruCache: true,
    cacheKey: (props) => `${props.variant}:${props.pulse}:${props.size}:${String(props.children)}`
  },
  render: ({
    variant = "info",
    pulse = false,
    icon,
    size = "md",
    className = "",
    style,
    children
  }) => {
    const getColors = () => {
      switch (variant) {
        case "success":
          return {
            bg: "rgba(34, 197, 94, 0.15)",
            color: "#4ade80",
            border: "rgba(34, 197, 94, 0.3)"
          };
        case "warning":
          return {
            bg: "rgba(245, 158, 11, 0.15)",
            color: "#fbbf24",
            border: "rgba(245, 158, 11, 0.3)"
          };
        case "danger":
          return {
            bg: "rgba(239, 68, 68, 0.15)",
            color: "#f87171",
            border: "rgba(239, 68, 68, 0.3)"
          };
        case "purple":
          return {
            bg: "rgba(168, 85, 247, 0.15)",
            color: "#c084fc",
            border: "rgba(168, 85, 247, 0.3)"
          };
        case "cyan":
          return {
            bg: "rgba(6, 182, 212, 0.15)",
            color: "#22d3ee",
            border: "rgba(6, 182, 212, 0.3)"
          };
        case "neutral":
          return {
            bg: "rgba(255, 255, 255, 0.06)",
            color: "#cbd5e1",
            border: "rgba(255, 255, 255, 0.12)"
          };
        case "info":
        default:
          return {
            bg: "rgba(56, 189, 248, 0.15)",
            color: "#38bdf8",
            border: "rgba(56, 189, 248, 0.3)"
          };
      }
    };

    const colors = getColors();

    return (
      <span
        className={`nexo-badge ${className}`}
        style={{
          background: colors.bg,
          color: colors.color,
          border: `1px solid ${colors.border}`,
          padding: size === "sm" ? "2px 6px" : "3px 9px",
          fontSize: size === "sm" ? "0.7rem" : "0.76rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          borderRadius: "999px",
          fontWeight: 600,
          letterSpacing: "0.03em",
          ...style
        }}
      >
        {pulse && (
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: colors.color,
              boxShadow: `0 0 8px ${colors.color}`,
              display: "inline-block"
            }}
          />
        )}
        {icon && <span>{icon}</span>}
        {children}
      </span>
    );
  }
});

export const NexoBadge = NexoBadgeComp;

import React, { type ButtonHTMLAttributes, type ReactNode } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";

export type NexoButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "glass";

export interface NexoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly id?: string | undefined;
  readonly variant?: NexoButtonVariant | undefined;
  readonly size?: "sm" | "md" | "lg" | undefined;
  readonly loading?: boolean | undefined;
  readonly icon?: ReactNode | undefined;
  readonly children: ReactNode;
}

export const NexoButtonComp: NexoComp<NexoButtonProps> = nexoComp<NexoButtonProps>({
  name: "NexoButton",
  purpose: "Interactive CTA button supporting glassmorphism, pulse states, and variants",
  dsa: { trackDirty: false, lruCache: false },
  render: ({
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    disabled,
    children,
    style,
    ...rest
  }) => {
    const getStyles = (): React.CSSProperties => {
      const base: React.CSSProperties = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        borderRadius: "10px",
        fontWeight: 600,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.6 : 1,
        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        outline: "none"
      };

      if (size === "sm") {
        base.padding = "6px 12px";
        base.fontSize = "0.85rem";
      } else if (size === "lg") {
        base.padding = "12px 24px";
        base.fontSize = "1.05rem";
      } else {
        base.padding = "9px 18px";
        base.fontSize = "0.95rem";
      }

      switch (variant) {
        case "secondary":
          return {
            ...base,
            background: "rgba(255, 255, 255, 0.06)",
            color: "var(--nexo-text-primary, #f8fafc)",
            border: "1px solid rgba(255, 255, 255, 0.12)"
          };
        case "danger":
          return {
            ...base,
            background: "linear-gradient(135deg, #ef4444, #dc2626)",
            color: "#fff",
            border: "none",
            boxShadow: "0 4px 14px rgba(239, 68, 68, 0.3)"
          };
        case "ghost":
          return {
            ...base,
            background: "transparent",
            color: "var(--nexo-text-secondary, #94a3b8)",
            border: "none"
          };
        case "glass":
          return {
            ...base,
            background: "rgba(255, 255, 255, 0.04)",
            backdropFilter: "blur(12px)",
            color: "var(--nexo-text-primary, #f8fafc)",
            border: "1px solid rgba(255, 255, 255, 0.1)"
          };
        case "primary":
        default:
          return {
            ...base,
            background: "linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)",
            color: "#fff",
            border: "none",
            boxShadow: "0 4px 16px rgba(56, 189, 248, 0.35)"
          };
      }
    };

    return (
      <button
        disabled={disabled || loading}
        style={{ ...getStyles(), ...style }}
        {...rest}
      >
        {loading ? (
          <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
        ) : (
          icon && <span>{icon}</span>
        )}
        <span>{children}</span>
      </button>
    );
  }
});

export const NexoButton = NexoButtonComp;

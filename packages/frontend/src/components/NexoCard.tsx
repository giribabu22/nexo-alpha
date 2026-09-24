import React, { useState, type ReactNode } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";

export interface NexoCardProps {
  readonly id?: string | undefined;
  readonly title?: ReactNode | undefined;
  readonly subtitle?: ReactNode | undefined;
  readonly badge?: ReactNode | undefined;
  readonly icon?: ReactNode | undefined;
  readonly headerActions?: ReactNode | undefined;
  readonly collapsible?: boolean | undefined;
  readonly defaultCollapsed?: boolean | undefined;
  readonly loading?: boolean | undefined;
  readonly variant?: "default" | "accent" | "glow" | "subtle" | undefined;
  readonly className?: string | undefined;
  readonly style?: React.CSSProperties | undefined;
  readonly children: ReactNode;
}

export const NexoCardComp: NexoComp<NexoCardProps> = nexoComp<NexoCardProps>({
  name: "NexoCard",
  purpose: "Glassmorphic container with collapse & badge support and DAG dirty tracking",
  render: ({
    title,
    subtitle,
    badge,
    icon,
    headerActions,
    collapsible = false,
    defaultCollapsed = false,
    loading = false,
    variant = "default",
    className = "",
    style,
    children
  }) => {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

    const getBorderColor = () => {
      if (variant === "accent") return "rgba(56, 189, 248, 0.4)";
      if (variant === "glow") return "rgba(129, 140, 248, 0.5)";
      if (variant === "subtle") return "rgba(255, 255, 255, 0.05)";
      return "var(--nexo-border, rgba(255, 255, 255, 0.08))";
    };

    const getBoxShadow = () => {
      if (variant === "accent") return "0 0 20px rgba(56, 189, 248, 0.15)";
      if (variant === "glow") return "0 0 25px rgba(129, 140, 248, 0.2)";
      return "0 8px 32px rgba(0, 0, 0, 0.35)";
    };

    return (
      <div
        className={`nexo-panel ${className}`}
        style={{
          border: `1px solid ${getBorderColor()}`,
          boxShadow: getBoxShadow(),
          transition: "all 0.25s ease",
          ...style
        }}
      >
        {(title || subtitle || badge || headerActions || icon) && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
              marginBottom: collapsed ? 0 : "16px",
              cursor: collapsible ? "pointer" : "default"
            }}
            onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {icon && <span style={{ fontSize: "1.2rem" }}>{icon}</span>}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {title && (
                    <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "var(--nexo-text-primary, #f8fafc)" }}>
                      {title}
                    </h3>
                  )}
                  {badge}
                </div>
                {subtitle && (
                  <p style={{ margin: "2px 0 0 0", fontSize: "0.85rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }} onClick={(e) => e.stopPropagation()}>
              {headerActions}
              {collapsible && (
                <button
                  type="button"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--nexo-text-secondary, #94a3b8)",
                    cursor: "pointer",
                    fontSize: "1rem",
                    padding: "4px"
                  }}
                  onClick={() => setCollapsed(!collapsed)}
                >
                  {collapsed ? "▼" : "▲"}
                </button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--nexo-text-secondary, #94a3b8)" }}>
            <div className="nexo-pulse-dot" style={{ display: "inline-block", marginRight: "8px" }}>●</div>
            Loading content...
          </div>
        ) : (
          !collapsed && children
        )}
      </div>
    );
  }
});

export const NexoCard = NexoCardComp;

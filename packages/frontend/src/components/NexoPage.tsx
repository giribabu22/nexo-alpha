import React, { type ReactNode } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";

export interface NexoPageProps {
  readonly id?: string | undefined;
  readonly title?: ReactNode | undefined;
  readonly subtitle?: ReactNode | undefined;
  readonly statusBadge?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly navbar?: ReactNode | undefined;
  readonly sidebar?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  readonly maxWidth?: string | number | undefined;
  readonly className?: string | undefined;
  readonly style?: React.CSSProperties | undefined;
  readonly children: ReactNode;
}

export const NexoPageComp: NexoComp<NexoPageProps> = nexoComp<NexoPageProps>({
  name: "NexoPage",
  purpose: "Main responsive layout scaffold hosting navbar, sidebar, header, and multi-nexoComp body",
  render: ({
    title,
    subtitle,
    statusBadge,
    actions,
    navbar,
    sidebar,
    footer,
    maxWidth = 1200,
    className = "",
    style,
    children
  }) => {
    return (
      <div
        className={`nexo-page-wrapper ${className}`}
        style={{
          minHeight: "100vh",
          background: "radial-gradient(ellipse at 50% 0%, #172554 0%, #0b0f19 70%)",
          color: "var(--nexo-text-primary, #f8fafc)",
          display: "flex",
          flexDirection: "column",
          ...style
        }}
      >
        {navbar}

        <div
          style={{
            flex: 1,
            display: "flex",
            maxWidth,
            width: "100%",
            margin: "0 auto",
            padding: "24px 20px"
          }}
        >
          {sidebar && (
            <aside
              style={{
                width: "260px",
                marginRight: "24px",
                flexShrink: 0
              }}
            >
              {sidebar}
            </aside>
          )}

          <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "24px" }}>
            {(title || subtitle || actions || statusBadge) && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "16px",
                  paddingBottom: "16px",
                  borderBottom: "1px solid var(--nexo-border, rgba(255, 255, 255, 0.08))"
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {typeof title === "string" ? (
                      <h1 style={{ margin: 0, fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
                        {title}
                      </h1>
                    ) : (
                      title
                    )}
                    {statusBadge}
                  </div>
                  {subtitle && (
                    <p style={{ margin: "6px 0 0 0", color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.95rem" }}>
                      {subtitle}
                    </p>
                  )}
                </div>

                {actions && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    {actions}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {children}
            </div>
          </main>
        </div>

        {footer && (
          <footer
            style={{
              borderTop: "1px solid var(--nexo-border, rgba(255, 255, 255, 0.08))",
              padding: "20px",
              textAlign: "center",
              color: "var(--nexo-text-secondary, #94a3b8)",
              fontSize: "0.85rem"
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    );
  }
});

export const NexoPage = NexoPageComp;

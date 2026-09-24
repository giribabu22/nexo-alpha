import React, { type InputHTMLAttributes, type ReactNode } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";

export interface NexoInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly id?: string | undefined;
  readonly label?: string | undefined;
  readonly icon?: ReactNode | undefined;
  readonly error?: string | undefined;
  readonly rightElement?: ReactNode | undefined;
}

export const NexoInputComp: NexoComp<NexoInputProps> = nexoComp<NexoInputProps>({
  name: "NexoInput",
  purpose: "Form input with sleek glass styling, icon affix, and validation state",
  dsa: { trackDirty: false, lruCache: false },
  render: ({
    label,
    icon,
    error,
    rightElement,
    style,
    disabled,
    ...rest
  }) => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
        {label && (
          <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--nexo-text-secondary, #94a3b8)" }}>
            {label}
          </label>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.04)",
            border: `1px solid ${error ? "var(--nexo-danger, #ef4444)" : "rgba(255, 255, 255, 0.1)"}`,
            borderRadius: "10px",
            padding: "0 12px",
            transition: "all 0.2s ease",
            opacity: disabled ? 0.6 : 1
          }}
        >
          {icon && <span style={{ marginRight: "8px", opacity: 0.7 }}>{icon}</span>}
          <input
            disabled={disabled}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "var(--nexo-text-primary, #f8fafc)",
              padding: "10px 0",
              fontSize: "0.95rem",
              outline: "none",
              ...style
            }}
            {...rest}
          />
          {rightElement && <div style={{ marginLeft: "8px" }}>{rightElement}</div>}
        </div>

        {error && (
          <span style={{ fontSize: "0.75rem", color: "var(--nexo-danger, #ef4444)" }}>
            {error}
          </span>
        )}
      </div>
    );
  }
});

export const NexoInput = NexoInputComp;

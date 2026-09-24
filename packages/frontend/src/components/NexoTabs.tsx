import React, { useState, type ReactNode } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";

export interface NexoTabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode | undefined;
  readonly badge?: ReactNode | undefined;
  readonly content: ReactNode;
}

export interface NexoTabsProps {
  readonly id?: string | undefined;
  readonly tabs: readonly NexoTabItem[];
  readonly defaultTabId?: string | undefined;
  readonly activeTabId?: string | undefined;
  readonly onTabChange?: ((id: string) => void) | undefined;
  readonly className?: string | undefined;
}

export const NexoTabsComp: NexoComp<NexoTabsProps> = nexoComp<NexoTabsProps>({
  name: "NexoTabs",
  purpose: "Segmented navigation tabs with animated active indicator and lazy tab rendering",
  render: ({
    tabs,
    defaultTabId,
    activeTabId,
    onTabChange,
    className = ""
  }) => {
    const [internalActive, setInternalActive] = useState<string>(() => {
      return defaultTabId ?? tabs[0]?.id ?? "";
    });

    const currentTab = activeTabId !== undefined ? activeTabId : internalActive;

    const handleSelect = (id: string) => {
      if (activeTabId === undefined) {
        setInternalActive(id);
      }
      if (onTabChange) {
        onTabChange(id);
      }
    };

    const activeItem = tabs.find((t) => t.id === currentTab) ?? tabs[0];

    return (
      <div className={`nexo-tabs-container ${className}`}>
        <div
          className="tab-bar"
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "1px solid var(--nexo-border, rgba(255, 255, 255, 0.08))",
            paddingBottom: "12px",
            marginBottom: "20px",
            overflowX: "auto"
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === currentTab;
            return (
              <button
                key={tab.id}
                type="button"
                className={`tab-btn ${isActive ? "active" : ""}`}
                onClick={() => handleSelect(tab.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderRadius: "10px",
                  border: isActive
                    ? "1px solid rgba(56, 189, 248, 0.4)"
                    : "1px solid transparent",
                  background: isActive
                    ? "rgba(56, 189, 248, 0.15)"
                    : "rgba(255, 255, 255, 0.03)",
                  color: isActive ? "#38bdf8" : "var(--nexo-text-secondary, #94a3b8)",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: "0.95rem",
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
              >
                {tab.icon && <span>{tab.icon}</span>}
                <span>{tab.label}</span>
                {tab.badge}
              </button>
            );
          })}
        </div>

        <div className="nexo-tab-content" style={{ animation: "nexoSlideUp 0.3s ease-out" }}>
          {activeItem?.content}
        </div>
      </div>
    );
  }
});

export const NexoTabs = NexoTabsComp;

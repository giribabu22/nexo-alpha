import React, { useEffect, useState } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";
import { useNexoClient } from "../context.js";
import { NexoBadge } from "./NexoBadge.js";
import { NexoCard } from "./NexoCard.js";
import type { WorkflowDescription } from "../workflows.js";

export interface UseWorkflowCatalogResult {
  readonly workflows: readonly WorkflowDescription[];
  readonly loading: boolean;
  readonly error: Error | null;
}

/** Every workflow the server exposes, with its limits and callable tools. */
export function useWorkflowCatalog(options: { readonly enabled?: boolean } = {}): UseWorkflowCatalogResult {
  const client = useNexoClient();
  const [workflows, setWorkflows] = useState<readonly WorkflowDescription[]>([]);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (options.enabled === false) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const names = await client.workflows.list();
        const described = await Promise.all(names.map((name) => client.workflows.describe(name)));
        if (active) {
          setWorkflows(described);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, options.enabled]);

  return { workflows, loading, error };
}

export interface NexoWorkflowCatalogProps {
  readonly id?: string | undefined;
  /** Render fixed descriptions instead of fetching. */
  readonly workflows?: readonly WorkflowDescription[] | undefined;
}

const muted: React.CSSProperties = { color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.85rem" };

export const NexoWorkflowCatalogComp: NexoComp<NexoWorkflowCatalogProps> = nexoComp<NexoWorkflowCatalogProps>({
  name: "NexoWorkflowCatalog",
  purpose: "Discover workflows, the tools their agents can call, and the permissions each tool needs",
  render: ({ workflows: fixed }) => {
    const fetched = useWorkflowCatalog({ enabled: fixed === undefined });
    const workflows = fixed ?? fetched.workflows;

    if (fixed === undefined && fetched.error !== null) {
      return <div className="nexo-panel" style={{ color: "var(--nexo-danger, #ef4444)" }}>{fetched.error.message}</div>;
    }
    if (workflows.length === 0) {
      return <div className="nexo-panel" style={muted}>{fixed === undefined && fetched.loading ? "Loading workflows…" : "No workflows are exposed."}</div>;
    }

    return (
      <div className="nexo-workflow-catalog" style={{ display: "grid", gap: "12px" }}>
        {workflows.map((workflow) => (
          <NexoCard
            key={workflow.name}
            title={workflow.name}
            subtitle={`max ${workflow.maxSteps} steps · ${workflow.allowedActions === null ? "any registered tool" : `${workflow.allowedActions.length} allowed action(s)`}`}
          >
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {workflow.tools.map((tool) => (
                <li key={tool.action} data-tool={tool.action} style={{ display: "flex", gap: "8px", alignItems: "baseline", padding: "4px 0", flexWrap: "wrap" }}>
                  <code>{tool.action}</code>
                  {!tool.registered && <NexoBadge variant="danger" size="sm">not registered</NexoBadge>}
                  {tool.description !== undefined && <span style={muted}>{tool.description}</span>}
                  {tool.permissions.map((permission) => (
                    <NexoBadge key={permission} variant="purple" size="sm">{permission}</NexoBadge>
                  ))}
                </li>
              ))}
            </ul>
          </NexoCard>
        ))}
      </div>
    );
  }
});

export const NexoWorkflowCatalog = NexoWorkflowCatalogComp;

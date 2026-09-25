import React, { useCallback, useEffect, useRef, useState } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";
import { useNexoClient } from "../context.js";
import { NexoButton } from "./NexoButton.js";
import type { NexoProject } from "../projects.js";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseProjectsResult {
  readonly projects: readonly NexoProject[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
  /** Creates a project (the user becomes owner), then re-fetches. */
  readonly create: (project: { readonly id: string; readonly name: string }) => Promise<NexoProject>;
}

/** Projects the signed-in user belongs to. */
export function useProjects(options: { readonly enabled?: boolean } = {}): UseProjectsResult {
  const client = useNexoClient();
  const [projects, setProjects] = useState<readonly NexoProject[]>([]);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const data = await client.projects.list();
      if (mountedRef.current) {
        setProjects(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    if (options.enabled === false) setLoading(false);
    else void refetch();
    return () => {
      mountedRef.current = false;
    };
  }, [refetch, options.enabled]);

  const create = useCallback(async (project: { readonly id: string; readonly name: string }) => {
    const created = await client.projects.create(project);
    await refetch();
    return created;
  }, [client, refetch]);

  return { projects, loading, error, refetch, create };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface NexoProjectSwitcherProps {
  readonly id?: string | undefined;
  /** The active project ID. */
  readonly value?: string | undefined;
  /** Called with the chosen (or newly created) project ID. */
  readonly onChange: (projectId: string) => void;
  /** Show a form to create a project. Default: false */
  readonly allowCreate?: boolean | undefined;
  /** Render fixed projects instead of fetching. */
  readonly projects?: readonly NexoProject[] | undefined;
}

const muted: React.CSSProperties = { color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.85rem" };

export const NexoProjectSwitcherComp: NexoComp<NexoProjectSwitcherProps> = nexoComp<NexoProjectSwitcherProps>({
  name: "NexoProjectSwitcher",
  purpose: "Choose the active project (tenant) and optionally create new ones",
  render: ({ value, onChange, allowCreate, projects: fixed }) => {
    const fetched = useProjects({ enabled: fixed === undefined });
    const projects = fixed ?? fetched.projects;
    const [newId, setNewId] = useState("");
    const [newName, setNewName] = useState("");
    const [createError, setCreateError] = useState<string | null>(null);

    return (
      <div className="nexo-project-switcher" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <label style={muted} htmlFor="nexo-project-select">Project</label>
        <select
          id="nexo-project-select"
          aria-label="Active project"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {value === undefined && <option value="" disabled>Select a project…</option>}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{`${project.name} (${project.id})`}</option>
          ))}
        </select>
        {projects.length === 0 && <span style={muted}>{fixed === undefined && fetched.loading ? "Loading…" : "No projects yet."}</span>}
        {fixed === undefined && fetched.error !== null && (
          <span style={{ color: "var(--nexo-danger, #ef4444)" }}>{fetched.error.message}</span>
        )}

        {allowCreate === true && fixed === undefined && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setCreateError(null);
              fetched
                .create({ id: newId.trim(), name: newName.trim() })
                .then((created) => {
                  setNewId("");
                  setNewName("");
                  onChange(created.id);
                })
                .catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)));
            }}
            style={{ display: "flex", gap: "6px" }}
          >
            <input aria-label="New project ID" placeholder="id (e.g. acme)" value={newId} onChange={(e) => setNewId(e.target.value)} />
            <input aria-label="New project name" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <NexoButton type="submit" size="sm" variant="secondary">Create</NexoButton>
            {createError !== null && <span style={{ color: "var(--nexo-danger, #ef4444)" }}>{createError}</span>}
          </form>
        )}
      </div>
    );
  }
});

export const NexoProjectSwitcher = NexoProjectSwitcherComp;

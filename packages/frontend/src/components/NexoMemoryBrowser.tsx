import React, { useCallback, useEffect, useRef, useState } from "react";
import { nexoComp, type NexoComp } from "../comp/nexo-comp.js";
import { useNexoClient } from "../context.js";
import { NexoBadge } from "./NexoBadge.js";
import { NexoButton } from "./NexoButton.js";
import { NexoCard } from "./NexoCard.js";
import type { MemoryEntry, MemoryQuery } from "../memory.js";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAgentMemoryResult {
  readonly entries: readonly MemoryEntry[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
  /** Forgets an entry, then re-fetches. */
  readonly forget: (key: string) => Promise<void>;
}

/** Memory entries matching `query`, re-fetched whenever the query changes. */
export function useAgentMemory(query: MemoryQuery = {}, options: { readonly enabled?: boolean } = {}): UseAgentMemoryResult {
  const client = useNexoClient();
  const [entries, setEntries] = useState<readonly MemoryEntry[]>([]);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const { text, scope, limit } = query;
  const tagsKey = (query.tags ?? []).join(",");

  const refetch = useCallback(async () => {
    try {
      const tags = tagsKey === "" ? [] : tagsKey.split(",");
      const data = await client.memory.recall({ text, tags, scope, limit });
      if (mountedRef.current) {
        setEntries(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [client, text, tagsKey, scope, limit]);

  useEffect(() => {
    mountedRef.current = true;
    if (options.enabled === false) {
      setLoading(false);
    } else {
      void refetch();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [refetch, options.enabled]);

  const forget = useCallback(async (key: string) => {
    await client.memory.forget(key);
    await refetch();
  }, [client, refetch]);

  return { entries, loading, error, refetch, forget };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface NexoMemoryBrowserProps {
  readonly id?: string | undefined;
  /** Render fixed entries instead of fetching (search and forget are then hidden). */
  readonly entries?: readonly MemoryEntry[] | undefined;
  /** Show "Forget" buttons. Default: false */
  readonly allowForget?: boolean | undefined;
}

const muted: React.CSSProperties = { color: "var(--nexo-text-secondary, #94a3b8)", fontSize: "0.85rem" };

function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export const NexoMemoryBrowserComp: NexoComp<NexoMemoryBrowserProps> = nexoComp<NexoMemoryBrowserProps>({
  name: "NexoMemoryBrowser",
  purpose: "Search and manage the agent memory recalled across workflow runs",
  render: ({ entries: fixed, allowForget }) => {
    const [text, setText] = useState("");
    const fetched = useAgentMemory({ text }, { enabled: fixed === undefined });
    const entries = fixed ?? fetched.entries;

    return (
      <NexoCard title="Agent memory" subtitle={`${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}>
        {fixed === undefined && (
          <input
            aria-label="Search memory"
            placeholder="Search keys, tags and values"
            value={text}
            onChange={(event) => setText(event.target.value)}
            style={{ width: "100%", marginBottom: "12px" }}
          />
        )}
        {fetched.error !== null && fixed === undefined && (
          <p style={{ color: "var(--nexo-danger, #ef4444)" }}>{fetched.error.message}</p>
        )}
        {entries.length === 0 ? (
          <p style={muted}>No memory entries{text !== "" ? " match this search" : ""}.</p>
        ) : (
          <table className="nexo-memory-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ ...muted, textAlign: "left" }}>
                <th>Key</th>
                <th>Value</th>
                <th>Tags</th>
                <th>Updated</th>
                {allowForget === true && fixed === undefined && <th />}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.key} data-memory-key={entry.key}>
                  <td><code>{entry.key}</code>{entry.scope !== undefined && <span style={muted}> · {entry.scope}</span>}</td>
                  <td title={typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)}>{preview(entry.value)}</td>
                  <td>{entry.tags.map((tag) => <NexoBadge key={tag} variant="neutral" size="sm">{tag}</NexoBadge>)}</td>
                  <td style={muted}>{entry.updatedAt.slice(0, 19).replace("T", " ")}</td>
                  {allowForget === true && fixed === undefined && (
                    <td>
                      <NexoButton variant="danger" size="sm" onClick={() => void fetched.forget(entry.key).catch(() => undefined)}>
                        Forget
                      </NexoButton>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </NexoCard>
    );
  }
});

export const NexoMemoryBrowser = NexoMemoryBrowserComp;

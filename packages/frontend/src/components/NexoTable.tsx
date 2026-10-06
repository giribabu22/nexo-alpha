/**
 * Tables. `NexoTable` renders rows you already have; `NexoResourceTable`
 * fetches a model's records itself, with search, paging and delete.
 *
 * ```tsx
 * <NexoResourceTable model={User} search allowDelete />
 * <NexoTable model={User} rows={users.items} loading={users.loading} error={users.error} />
 * ```
 */

import React, { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { humanize, type FieldName, type Infer, type NexoModel, type ResourceListQuery } from "@nexo-alpha/core/model";
import { useResource } from "../resource-hooks.js";
import { useNexoClient } from "../context.js";
import { NexoButton } from "./NexoButton.js";
import { NexoInput } from "./NexoInput.js";
import { NexoEmptyState, NexoErrorState, NexoLoader } from "./NexoFeedback.js";
import { NexoStack } from "./NexoLayout.js";

export interface NexoTableColumn<R> {
  /** The row property shown (and the default header). */
  readonly key: string;
  readonly label?: string | undefined;
  /** Custom cell content. Default: the formatted value. */
  readonly render?: ((row: R) => ReactNode) | undefined;
}

export interface NexoTableProps<R> {
  readonly rows: readonly R[];
  /** Supplies default columns and headers. */
  readonly model?: NexoModel | undefined;
  /** Property names or column definitions. Default: the model's fields (or the first row's keys). */
  readonly columns?: readonly (string | NexoTableColumn<R>)[] | undefined;
  /** Shows a loader instead of the empty state while there are no rows yet. */
  readonly loading?: boolean | undefined;
  readonly error?: Error | null | undefined;
  readonly onRetry?: (() => void) | undefined;
  /** Default: "No records yet" */
  readonly emptyText?: ReactNode;
  /** Extra cell at the end of each row, e.g. buttons. */
  readonly rowActions?: ((row: R) => ReactNode) | undefined;
  readonly onRowClick?: ((row: R) => void) | undefined;
}

/** Formats a cell value: booleans as Yes/No, lists comma-separated, missing values as "—". */
export function formatCell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(formatCell).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const cellStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--nexo-border, rgba(255, 255, 255, 0.08))",
  textAlign: "left",
  verticalAlign: "top"
};
const headStyle: CSSProperties = {
  ...cellStyle,
  fontSize: "0.8rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--nexo-text-secondary, #94a3b8)"
};

function resolveColumns<R>(props: NexoTableProps<R>): NexoTableColumn<R>[] {
  const { model, columns, rows } = props;
  const keys = columns ?? (model !== undefined
    ? Object.keys(model.fields).filter((key) => model.fields[key]?.kind !== "text")
    : Object.keys((rows[0] ?? {}) as object).filter((key) => key !== "createdAt" && key !== "updatedAt"));
  return keys.map((column) => {
    const definition = typeof column === "string" ? { key: column } : column;
    return { ...definition, label: definition.label ?? (model?.label(definition.key) ?? humanize(definition.key)) };
  });
}

/** A table of rows, with loading, error and empty states. */
export function NexoTable<R>(props: NexoTableProps<R>): React.JSX.Element {
  const { rows, loading, error, onRetry, emptyText = "No records yet", rowActions, onRowClick } = props;
  // Hooks before any early return.
  const client = useNexoClient();
  if (error) return <NexoErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) return loading ? <NexoLoader /> : <NexoEmptyState title={emptyText} />;

  const columns = resolveColumns(props).map((column) =>
    column.render === undefined && props.model?.fields[column.key]?.kind === "file"
      ? {
        ...column,
        render: (row: R) => {
          const fileId = (row as Record<string, unknown>)[column.key];
          return typeof fileId === "string"
            ? <a href={client.files.url(fileId)} target="_blank" rel="noreferrer">Download</a>
            : "—";
        }
      }
      : column
  );
  return (
    <div style={{ overflowX: "auto", opacity: loading ? 0.6 : 1, transition: "opacity 0.2s" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} style={headStyle}>{column.label}</th>)}
            {rowActions && <th style={headStyle} aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const record = row as Record<string, unknown>;
            return (
              <tr
                key={typeof record.id === "string" ? record.id : index}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} style={cellStyle}>
                    {column.render ? column.render(row) : formatCell(record[column.key])}
                  </td>
                ))}
                {rowActions && (
                  <td style={{ ...cellStyle, textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
                    {rowActions(row)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface NexoResourceTableProps<M extends NexoModel> {
  readonly model: M;
  readonly columns?: readonly (FieldName<M> | "id" | "createdAt" | "updatedAt" | NexoTableColumn<Infer<M>>)[] | undefined;
  /** Default: 20 */
  readonly pageSize?: number | undefined;
  /** Show a search box (the server resource needs `searchable` fields). Default: false */
  readonly search?: boolean | undefined;
  readonly where?: ResourceListQuery<M>["where"];
  readonly sort?: ResourceListQuery<M>["sort"];
  /** Show a Delete button on each row. Default: false */
  readonly allowDelete?: boolean | undefined;
  /** Ask before deleting (browser confirm dialog). Default: true */
  readonly confirmDelete?: boolean | undefined;
  readonly rowActions?: ((row: Infer<M>) => ReactNode) | undefined;
  readonly onRowClick?: ((row: Infer<M>) => void) | undefined;
  readonly emptyText?: ReactNode;
}

/** A model's records from the server, with optional search, paging and delete. */
export function NexoResourceTable<M extends NexoModel>({
  model,
  columns,
  pageSize = 20,
  search = false,
  where,
  sort,
  allowDelete = false,
  confirmDelete = true,
  rowActions,
  onRowClick,
  emptyText
}: NexoResourceTableProps<M>): React.JSX.Element {
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchText, setSearchText] = useState("");
  const [deleteError, setDeleteError] = useState<Error | null>(null);

  // Search after typing pauses, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchText(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const records = useResource(model, {
    limit: pageSize,
    offset,
    ...(searchText !== "" ? { search: searchText } : {}),
    ...(where !== undefined ? { where } : {}),
    ...(sort !== undefined ? { sort } : {})
  });

  // Step back when deleting empties the last page.
  useEffect(() => {
    if (!records.loading && records.items.length === 0 && offset > 0 && offset >= records.total) {
      setOffset(Math.max(0, offset - pageSize));
    }
  }, [records.loading, records.items.length, records.total, offset, pageSize]);

  async function remove(id: string): Promise<void> {
    if (confirmDelete && typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm("Delete this record?")) {
      return;
    }
    setDeleteError(null);
    try {
      await records.delete(id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  const actions = allowDelete || rowActions
    ? (row: Infer<M>) => (
      <NexoStack direction="row" gap={8} justify="flex-end">
        {rowActions?.(row)}
        {allowDelete && (
          <NexoButton variant="danger" size="sm" onClick={() => void remove(row.id)}>
            Delete
          </NexoButton>
        )}
      </NexoStack>
    )
    : undefined;

  const first = records.total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + pageSize, records.total);

  return (
    <NexoStack gap={12}>
      {search && (
        <NexoInput
          type="search"
          placeholder={`Search ${model.name}…`}
          aria-label={`Search ${model.name}`}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      )}
      {deleteError && <NexoErrorState title="Could not delete" error={deleteError} />}
      <NexoTable
        model={model}
        rows={records.items}
        columns={columns as readonly (string | NexoTableColumn<Infer<M>>)[] | undefined}
        loading={records.loading}
        error={records.error}
        onRetry={records.refetch}
        emptyText={emptyText ?? (searchText !== "" ? `No ${model.name} match "${searchText}"` : `No ${model.name} yet`)}
        rowActions={actions}
        onRowClick={onRowClick}
      />
      {records.total > pageSize && (
        <NexoStack direction="row" justify="space-between" align="center">
          <span style={{ fontSize: "0.85rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>
            {first}–{last} of {records.total}
          </span>
          <NexoStack direction="row" gap={8}>
            <NexoButton variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Previous
            </NexoButton>
            <NexoButton variant="secondary" size="sm" disabled={last >= records.total} onClick={() => setOffset(offset + pageSize)}>
              Next
            </NexoButton>
          </NexoStack>
        </NexoStack>
      )}
    </NexoStack>
  );
}

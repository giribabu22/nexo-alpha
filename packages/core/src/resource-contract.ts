/**
 * The HTTP contract of a `resource()`, shared by the server (`resource.ts`)
 * and the browser client (`@nexo-alpha/frontend`), so the URL and query
 * format are defined once. Browser-safe: no Node.js imports.
 *
 * | Call                   | HTTP                          | Success |
 * |------------------------|-------------------------------|---------|
 * | `list(query)`          | `GET    /api/<name>?…`        | 200 `{ items, total, limit, offset }` |
 * | `get(id)`              | `GET    /api/<name>/:id`      | 200 record (404 if missing) |
 * | `create(input)`        | `POST   /api/<name>`          | 201 record + `Location` header |
 * | `update(id, patch)`    | `PATCH  /api/<name>/:id`      | 200 record (404, 409 on conflict) |
 * | `delete(id)`           | `DELETE /api/<name>/:id`      | 204 (404 if missing) |
 *
 * List query string: `limit`, `offset`, `sort` (`name` or `-name` for
 * descending), `search`, and `<field>=<value>` for equality filters, e.g.
 * `/api/users?role=admin&sort=-createdAt&limit=20`.
 */

import type { FieldName, Infer, NexoModel } from "./model.js";
import { NexoValidationError } from "./errors.js";

/** The default API path of a model's resource: `/api/<name>`. */
export function resourcePath(model: Pick<NexoModel, "name">): string {
  return `/api/${model.name}`;
}

export interface ResourceListQuery<M extends NexoModel = NexoModel> {
  /** Page size. Default 50, capped by the resource's `maxLimit` (default 200). */
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  /** A field name, or `-field` for descending. Also `id`, `createdAt`, `updatedAt`. Default: creation order. */
  readonly sort?: `${FieldName<M> | "id" | "createdAt" | "updatedAt"}` | `-${FieldName<M> | "id" | "createdAt" | "updatedAt"}` | undefined;
  /** Case-insensitive text search over the resource's `searchable` fields. */
  readonly search?: string | undefined;
  /** Equality filters: `{ role: "admin" }`. */
  readonly where?: { readonly [K in FieldName<M>]?: Infer<M>[K & keyof Infer<M>] } | undefined;
}

export interface ResourceListResult<R> {
  readonly items: R[];
  /** Matching records before paging. */
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Query-string keys that are not field filters. A model may not declare fields with these names. */
export const LIST_PARAMS: readonly string[] = ["limit", "offset", "sort", "search"];

/** Encodes a list query as query-string parameters. */
export function encodeListQuery(query: ResourceListQuery = {}): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.limit !== undefined) params.limit = String(query.limit);
  if (query.offset !== undefined) params.offset = String(query.offset);
  if (query.sort !== undefined) params.sort = query.sort;
  if (query.search !== undefined && query.search !== "") params.search = query.search;
  for (const [key, value] of Object.entries(query.where ?? {})) {
    if (value !== undefined && value !== null) params[key] = String(value);
  }
  return params;
}

function nonNegativeInteger(raw: string, key: string, errors: string[]): number | undefined {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < 0) {
    errors.push(`Field "query.${key}" must be a non-negative integer, got "${raw}".`);
    return undefined;
  }
  return value;
}

/**
 * Decodes query-string parameters (all strings) into a typed list query,
 * converting filter values to their field's type. Throws NexoValidationError
 * listing every problem, including unknown parameters.
 */
export function decodeListQuery(model: NexoModel, params: Readonly<Record<string, unknown>>): ResourceListQuery {
  const errors: string[] = [];
  const query: { limit?: number; offset?: number; sort?: string; search?: string; where?: Record<string, unknown> } = {};
  const sortable = new Set(["id", "createdAt", "updatedAt", ...Object.keys(model.fields)]);

  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined) continue;
    if (typeof raw !== "string") {
      errors.push(`Field "query.${key}" must be given once.`);
      continue;
    }
    switch (key) {
      case "limit":
      case "offset": {
        const value = nonNegativeInteger(raw, key, errors);
        if (value !== undefined) query[key] = value;
        break;
      }
      case "sort": {
        if (!sortable.has(raw.replace(/^-/, ""))) {
          errors.push(`Field "query.sort" must name a field of "${model.name}" (optionally prefixed with "-"), got "${raw}".`);
        } else {
          query.sort = raw;
        }
        break;
      }
      case "search":
        query.search = raw;
        break;
      default: {
        const f = model.fields[key];
        if (f === undefined) {
          errors.push(
            `Field "query.${key}" is not a list parameter (${LIST_PARAMS.join(", ")}) or a field of "${model.name}".`
          );
          break;
        }
        if (f.kind === "array") {
          errors.push(`Field "query.${key}" is a list field and cannot be filtered on.`);
        } else if (f.kind === "number") {
          const value = Number(raw);
          if (raw.trim() === "" || Number.isNaN(value)) errors.push(`Field "query.${key}" must be a number, got "${raw}".`);
          else (query.where ??= {})[key] = value;
        } else if (f.kind === "boolean") {
          if (raw !== "true" && raw !== "false") errors.push(`Field "query.${key}" must be "true" or "false", got "${raw}".`);
          else (query.where ??= {})[key] = raw === "true";
        } else {
          (query.where ??= {})[key] = raw;
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new NexoValidationError(`Invalid ${model.name} query: ${errors.join("; ")}`, errors);
  }
  return query as ResourceListQuery;
}

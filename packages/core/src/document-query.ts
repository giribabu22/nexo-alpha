/**
 * Querying a collection: equality filters, text search, sorting and paging.
 *
 * A store may answer a {@link DocumentQuery} itself (`NexoDocumentStore.query`,
 * which the SQLite store does in SQL); otherwise {@link queryDocuments} answers
 * it in memory from `list()`. Both follow the same rules, so results do not
 * depend on the store:
 *
 * - `where`: strict equality per field.
 * - `search`: case-insensitive substring match in any of the fields.
 * - `sort`: numbers numerically, strings case-insensitively; missing values
 *   last in both directions; ties keep insertion order.
 * - Case-insensitive means ASCII letters only (as in SQLite), so "É" and "é" differ.
 * - `defaults` stands in for fields a document lacks (a model's defaults), so
 *   records stored before a field was added still match and sort by it.
 */

export type DocumentScalar = string | number | boolean;

export interface DocumentQuery {
  readonly where?: Readonly<Record<string, DocumentScalar>> | undefined;
  readonly search?: { readonly text: string; readonly fields: readonly string[] } | undefined;
  readonly sort?: { readonly field: string; readonly descending?: boolean | undefined } | undefined;
  /** Default: no limit. */
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  /** Values for fields a document lacks. */
  readonly defaults?: Readonly<Record<string, unknown>> | undefined;
}

export interface DocumentQueryResult<T> {
  /** The requested page, as stored (defaults are not filled in). */
  readonly items: T[];
  /** Matching documents before paging. */
  readonly total: number;
}

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Throws unless `field` is a plain property name (it may end up in a JSON path). */
export function assertQueryField(field: string): void {
  if (!FIELD_NAME.test(field)) throw new TypeError(`Invalid query field "${field}".`);
}

/** Lowercases ASCII letters only, matching SQLite's lower() and NOCASE. */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function rank(value: unknown): number {
  return typeof value === "number" || typeof value === "boolean" ? 0 : 1;
}

/** The sort order of two present values: numbers (and booleans) before strings. */
function compareValues(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return Number(a) - Number(b);
  const sa = asciiLower(typeof a === "string" ? a : JSON.stringify(a));
  const sb = asciiLower(typeof b === "string" ? b : JSON.stringify(b));
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Answers a query in memory. `documents` must be in insertion order (as `list()` returns them). */
export function queryDocuments<T>(documents: readonly T[], query: DocumentQuery): DocumentQueryResult<T> {
  const defaults = query.defaults ?? {};
  const value = (document: T, field: string): unknown => {
    const own = (document as Record<string, unknown>)[field];
    return own === undefined ? defaults[field] : own;
  };

  let matches = [...documents];

  const where = Object.entries(query.where ?? {});
  for (const [field] of where) assertQueryField(field);
  if (where.length > 0) matches = matches.filter((document) => where.every(([field, expected]) => value(document, field) === expected));

  if (query.search !== undefined) {
    for (const field of query.search.fields) assertQueryField(field);
    const text = asciiLower(query.search.text);
    matches = matches.filter((document) =>
      query.search!.fields.some((field) => {
        const found = value(document, field);
        return found !== undefined && found !== null && asciiLower(String(found)).includes(text);
      })
    );
  }

  if (query.sort !== undefined) {
    const { field, descending = false } = query.sort;
    assertQueryField(field);
    matches.sort((a, b) => {
      const va = value(a, field);
      const vb = value(b, field);
      const missingA = va === undefined || va === null;
      const missingB = vb === undefined || vb === null;
      if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
      return (descending ? -1 : 1) * compareValues(va, vb);
    });
  }

  const offset = query.offset ?? 0;
  const end = query.limit === undefined ? undefined : offset + query.limit;
  return { items: matches.slice(offset, end), total: matches.length };
}

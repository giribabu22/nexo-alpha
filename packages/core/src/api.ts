export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export interface NexoRequestContext {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Who is calling, on APIs with `auth.required` (set by the HTTP adapter
   * after authentication succeeds). Undefined on public APIs.
   */
  readonly auth?: NexoAuthResult | undefined;
}

export type NexoApiHandler = (
  context: NexoRequestContext
) => unknown | Promise<unknown>;

export interface NexoValidationOutcome {
  readonly valid: boolean;
  readonly errors?: readonly string[];
}

export type NexoRequestValidator = (
  context: NexoRequestContext
) => NexoValidationOutcome | Promise<NexoValidationOutcome>;

export interface NexoApiAuth {
  readonly required: boolean;
  readonly scopes?: readonly string[];
}

export interface NexoAuthResult {
  readonly authenticated: boolean;
  readonly scopes?: readonly string[];
  readonly identity?: unknown;
}

export type NexoAuthenticator = (
  context: NexoRequestContext
) => NexoAuthResult | Promise<NexoAuthResult>;

/**
 * A plain, dependency-free field descriptor — deliberately not a runtime
 * validation library's schema type (Zod/Joi/etc.). This mirrors the rest of
 * `@nexo-alpha/core`'s stance: declare the shape as data, and let callers
 * decide what to do with it. `validateField()` checks values against it;
 * `@nexo-alpha/hapi` validates requests against `NexoApi.schema` when an API
 * has no `validate` hook; `model()` builds these from `field.*` declarations.
 */
export interface NexoFieldSchema {
  readonly type: "string" | "number" | "boolean" | "object" | "array";
  readonly required?: boolean | readonly string[];
  readonly description?: string;
  /** For `type: "array"` only: the shape of each item. */
  readonly items?: NexoFieldSchema;
  /** For `type: "object"` only: nested field descriptors, keyed by property name. */
  readonly properties?: Readonly<Record<string, NexoFieldSchema>>;
  /** For `type: "string"` or `type: "array"`: minimum length or items count. */
  readonly minLength?: number;
  /** For `type: "string"` or `type: "array"`: maximum length or items count. */
  readonly maxLength?: number;
  /** For `type: "string"`: regex pattern as string or RegExp. */
  readonly pattern?: string | RegExp;
  /** For `type: "number"`: minimum value (inclusive). */
  readonly min?: number;
  /** For `type: "number"`: maximum value (inclusive). */
  readonly max?: number;
  /** For `type: "number"`: requires integer value. */
  readonly integer?: boolean;
  /** Allowed enumeration values. */
  readonly enum?: readonly (string | number | boolean)[];
}

/**
 * Declared request/response shape for a {@link NexoApi} — optional, additive
 * metadata alongside `auth`/`validate`/`handler`. Absent entirely on an API
 * that doesn't declare one, same as every other optional `NexoApi` field;
 * consumers (request validation, knowledge tooling) simply do less for that
 * API rather than guessing at its shape.
 */
export interface NexoApiSchema {
  readonly params?: Readonly<Record<string, NexoFieldSchema>>;
  readonly query?: Readonly<Record<string, NexoFieldSchema>>;
  readonly body?: NexoFieldSchema;
  readonly response?: NexoFieldSchema;
}

export interface NexoApi {
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly service?: string;
  readonly dependencies?: readonly string[];
  readonly auth?: NexoApiAuth;
  readonly validate?: NexoRequestValidator;
  readonly handler?: NexoApiHandler;
  /** Declared request/response shape. See {@link NexoApiSchema}. */
  readonly schema?: NexoApiSchema;
  /**
   * Receive the request body as raw bytes (`context.payload` is a Uint8Array,
   * any content type) instead of parsed JSON — for uploads. Bodies over
   * `maxBytes` (default 10 MB) are answered with 413 before the handler runs.
   */
  readonly rawBody?: { readonly maxBytes?: number };
}

const HTTP_RESPONSE = Symbol.for("nexo.httpResponse");

/**
 * A handler result that sets the HTTP status and headers — e.g. `202
 * Accepted` with a `Location` header. Build one with {@link httpResponse}.
 * (For 4xx errors, throw `NexoHttpError` instead.)
 */
export interface NexoHttpResponse<T = unknown> {
  readonly [HTTP_RESPONSE]: true;
  readonly statusCode: number;
  readonly body: T | undefined;
  readonly headers: Readonly<Record<string, string>>;
}

export function httpResponse<T>(statusCode: number, body?: T, headers: Readonly<Record<string, string>> = {}): NexoHttpResponse<T> {
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new RangeError(`Invalid HTTP status code ${statusCode}.`);
  }
  return { [HTTP_RESPONSE]: true, statusCode, body, headers };
}

export function isHttpResponse(value: unknown): value is NexoHttpResponse {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[HTTP_RESPONSE] === true;
}

/** Everything a {@link NexoApi} can declare besides its method, path and handler. */
export type NexoApiOptions = Partial<Omit<NexoApi, "method" | "path" | "handler">>;

function apiFor(method: HttpMethod) {
  return (path: string, handler: NexoApiHandler, options: NexoApiOptions = {}): NexoApi => ({
    ...options,
    name: options.name ?? `${method} ${path}`,
    method,
    path,
    handler
  });
}

/**
 * One-line API declarations. The name defaults to `"<METHOD> <path>"`.
 *
 * ```ts
 * app.module({
 *   name: "reports",
 *   apis: [
 *     api.get("/api/reports/revenue", () => revenueByMonth()),
 *     api.post("/api/reports/rebuild", rebuild, { auth: { required: true, scopes: ["reports:write"] } })
 *   ]
 * });
 * ```
 */
export const api = {
  get: apiFor("GET"),
  post: apiFor("POST"),
  put: apiFor("PUT"),
  patch: apiFor("PATCH"),
  delete: apiFor("DELETE")
};

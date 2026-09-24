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
 * `@nexo-alpha/core`'s stance: declare the shape as data, let a caller
 * (`@nexo-alpha/hapi`'s `validate` hook, `@nexo-alpha/tools`'s OpenAPI/client
 * generators) decide what to do with it. Nexo itself never validates a
 * request against this — that's still `NexoApi.validate`'s job; this exists
 * purely to be read, not executed.
 */
export interface NexoFieldSchema {
  readonly type: "string" | "number" | "boolean" | "object" | "array";
  readonly required?: boolean;
  readonly description?: string;
  /** For `type: "array"` only: the shape of each item. */
  readonly items?: NexoFieldSchema;
  /** For `type: "object"` only: nested field descriptors, keyed by property name. */
  readonly properties?: Readonly<Record<string, NexoFieldSchema>>;
}

/**
 * Declared request/response shape for a {@link NexoApi} — optional, additive
 * metadata alongside `auth`/`validate`/`handler`. Absent entirely on an API
 * that doesn't declare one, same as every other optional `NexoApi` field;
 * consumers (OpenAPI generation, typed client generation) simply produce
 * less for that API rather than guessing at its shape.
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
}

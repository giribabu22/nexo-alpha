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
}

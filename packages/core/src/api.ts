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

export interface NexoApi {
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly dependencies?: readonly string[];
  readonly handler?: NexoApiHandler;
}

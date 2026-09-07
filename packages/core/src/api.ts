export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export interface NexoApi {
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly dependencies?: readonly string[];
}

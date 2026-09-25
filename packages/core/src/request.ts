import type { NexoRequestContext } from "./api.js";

/**
 * Builds a {@link NexoRequestContext} with empty defaults — for calling
 * `app.dispatch()` or API handlers directly in tests and scripts.
 *
 * ```ts
 * await app.dispatch("getOrder", createRequestContext({ params: { id: "o-1" } }));
 * ```
 */
export function createRequestContext(overrides: Partial<NexoRequestContext> = {}): NexoRequestContext {
  return {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    payload: overrides.payload,
    headers: overrides.headers ?? {}
  };
}

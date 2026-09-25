import type { ToolResult } from "@nexo-alpha/agent";

export interface HttpToolOptions {
  /** Custom fetch implementation (defaults to the global `fetch`). */
  readonly fetch?: typeof fetch | undefined;
  /** Per-request timeout. Default: 10000 */
  readonly timeoutMs?: number | undefined;
}

/**
 * Sends one JSON request and maps the outcome to a ToolResult. Non-2xx
 * responses and network errors become `{ success: false, error }` — never
 * thrown — so the agent's verifier decides what happens next. Response
 * bodies of failures are truncated so secrets echoed by an API don't end up
 * in audit logs wholesale.
 */
export async function requestJson(
  options: HttpToolOptions,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: unknown }
): Promise<ToolResult> {
  const started = Date.now();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  try {
    const response = await fetchImpl(url, {
      method: init.method,
      headers: { "content-type": "application/json", accept: "application/json", ...init.headers },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text === "" ? undefined : JSON.parse(text);
    } catch {
      // Not JSON (e.g. Slack answers "ok"); keep the text.
    }
    if (!response.ok) {
      const detail = typeof data === "object" && data !== null && "message" in data ? String((data as { message: unknown }).message) : text;
      return { success: false, error: `HTTP ${response.status}: ${detail.slice(0, 200)}`, durationMs: Date.now() - started };
    }
    return { success: true, data, durationMs: Date.now() - started };
  } catch (error) {
    return {
      success: false,
      error: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - started
    };
  }
}

/** Reads a required, non-empty string from an intent payload. */
export function requiredString(payload: Readonly<Record<string, unknown>> | undefined, field: string): string | undefined {
  const value = payload?.[field];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function invalidInput(message: string): ToolResult {
  return { success: false, error: `Invalid input: ${message}`, durationMs: 0 };
}

/**
 * ContextCompressor — State-delta diffing & compression for token optimisation.
 *
 * Problem: Every BehaviorEngine.decide() call serialises the full `state`
 * payload including the entire ApplicationContext (modules, decisions,
 * constraints, source tree). When nothing changed between calls, this wastes
 * identical tokens on every round-trip.
 *
 * Solution:
 *  1. Hash the incoming state with SHA-256 (via FNV-1a for speed in hot paths)
 *  2. If the hash matches the last-seen snapshot → return the cached compressed form
 *  3. If it differs → compute a structural delta (added/removed/changed keys only)
 *     and return only the delta, tagged with a base reference hash so the
 *     receiver can reconstruct the full state if needed
 *
 * This is intentionally framework-agnostic — it works on any JSON-serialisable
 * object, not just ApplicationContext.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompressionStrategy =
  | "full"        // Always send full state (no compression)
  | "delta"       // Send only changed keys since last call
  | "hash-gate"   // Skip sending state entirely when unchanged (idempotent calls)
  | "selective";  // Send only the fields listed in `include`

export interface CompressOptions {
  readonly strategy?: CompressionStrategy;
  /** Fields to include (for "selective" strategy). Dot-notation supported: "application.name". */
  readonly include?: readonly string[];
  /** Fields to always exclude (any strategy). Dot-notation supported. */
  readonly exclude?: readonly string[];
  /** Maximum serialised byte length before truncation. Default: 32_000. */
  readonly maxBytes?: number;
}

export interface CompressResult<T = unknown> {
  /** The compressed state to send as the DecisionRequest.state */
  readonly payload: T;
  /** Whether this is a full state or a delta */
  readonly mode: "full" | "delta" | "skipped" | "selective";
  /** SHA-256 hash of the full uncompressed state */
  readonly stateHash: string;
  /** Hash of the previous state this delta is relative to (delta mode only) */
  readonly baseHash?: string;
  /** Estimated token count (chars / 4 as a fast approximation) */
  readonly estimatedTokens: number;
  /** Tokens saved vs sending full state */
  readonly tokensSaved: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function estimateTokens(json: string): number {
  // GPT tokenisation approximation: ~4 chars per token
  return Math.ceil(json.length / 4);
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== "object" || cur[key] === null) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function deleteNestedKey(obj: unknown, path: string): void {
  if (typeof obj !== "object" || obj === null) return;
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== "object" || cur[key] === null) return;
    cur = cur[key] as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]!];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.join() !== kb.join()) return false;
  return ka.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k]
    )
  );
}

/**
 * Compute a flat delta object: { added: {...}, removed: string[], changed: {...} }
 * Only top-level keys are diffed (deep diffing would be too expensive for hot paths).
 */
function computeDelta(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): {
  added: Record<string, unknown>;
  removed: string[];
  changed: Record<string, unknown>;
} {
  const added: Record<string, unknown> = {};
  const removed: string[] = [];
  const changed: Record<string, unknown> = {};

  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));

  for (const key of nextKeys) {
    if (!prevKeys.has(key)) {
      added[key] = next[key];
    } else if (!deepEqual(prev[key], next[key])) {
      changed[key] = next[key];
    }
  }

  for (const key of prevKeys) {
    if (!nextKeys.has(key)) {
      removed.push(key);
    }
  }

  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// ContextCompressor
// ---------------------------------------------------------------------------

/**
 * ContextCompressor tracks state snapshots and emits compressed payloads.
 *
 * Create one per "context session" (e.g. per agent instance, per workflow)
 * and call compress() before each DecisionRequest.
 */
export class ContextCompressor {
  private lastHash: string | undefined;
  private lastState: Record<string, unknown> | undefined;
  private readonly defaultOptions: Required<Omit<CompressOptions, "include">>;

  constructor(options: CompressOptions = {}) {
    this.defaultOptions = {
      strategy: options.strategy ?? "delta",
      exclude: options.exclude ?? [],
      maxBytes: options.maxBytes ?? 32_000
    };
  }

  /**
   * Compress `state` relative to the previously seen snapshot.
   *
   * Returns a `CompressResult` whose `.payload` should replace the raw `state`
   * in the outgoing DecisionRequest.
   */
  compress<T extends Record<string, unknown>>(
    state: T,
    options?: CompressOptions
  ): CompressResult<Record<string, unknown>> {
    const strategy = options?.strategy ?? this.defaultOptions.strategy;
    const exclude = [...this.defaultOptions.exclude, ...(options?.exclude ?? [])];
    const maxBytes = options?.maxBytes ?? this.defaultOptions.maxBytes;
    const include = options?.include;

    // --- 1. Clone & apply exclusions ---
    let working: Record<string, unknown> = JSON.parse(JSON.stringify(state));
    for (const path of exclude) {
      deleteNestedKey(working, path);
    }

    const fullJson = JSON.stringify(working);
    const stateHash = sha256(fullJson);
    const fullTokens = estimateTokens(fullJson);

    // --- 2. Selective strategy: pick only specified fields ---
    if (strategy === "selective" && include && include.length > 0) {
      const selective: Record<string, unknown> = {};
      for (const path of include) {
        const val = getNestedValue(working, path);
        if (val !== undefined) setNestedValue(selective, path, val);
      }
      const selJson = JSON.stringify(selective);
      const selTokens = estimateTokens(selJson);
      const payload = truncateIfNeeded(selective, maxBytes);

      this.lastHash = stateHash;
      this.lastState = working;

      return {
        payload,
        mode: "selective",
        stateHash,
        estimatedTokens: selTokens,
        tokensSaved: fullTokens - selTokens
      };
    }

    // --- 3. Hash-gate: skip entirely if unchanged ---
    if (strategy === "hash-gate" && this.lastHash === stateHash) {
      return {
        payload: { _nexo_state_ref: stateHash },
        mode: "skipped",
        stateHash,
        estimatedTokens: 1,
        tokensSaved: fullTokens - 1
      };
    }

    // --- 4. Delta: send only what changed ---
    if (strategy === "delta" && this.lastState && this.lastHash !== stateHash) {
      const delta = computeDelta(this.lastState, working);
      const hasDelta =
        Object.keys(delta.added).length > 0 ||
        delta.removed.length > 0 ||
        Object.keys(delta.changed).length > 0;

      if (hasDelta) {
        const deltaPayload: Record<string, unknown> = {
          _nexo_delta: true,
          _nexo_base: this.lastHash,
          ...delta.added,
          ...delta.changed,
          ...(delta.removed.length > 0 ? { _nexo_removed: delta.removed } : {})
        };
        const deltaJson = JSON.stringify(deltaPayload);
        const deltaTokens = estimateTokens(deltaJson);

        this.lastHash = stateHash;
        this.lastState = working;

        return {
          payload: truncateIfNeeded(deltaPayload, maxBytes),
          mode: "delta",
          stateHash,
          baseHash: this.lastHash,
          estimatedTokens: deltaTokens,
          tokensSaved: Math.max(0, fullTokens - deltaTokens)
        };
      }
    }

    // --- 5. Full fallback ---
    this.lastHash = stateHash;
    this.lastState = working;

    return {
      payload: truncateIfNeeded(working, maxBytes),
      mode: "full",
      stateHash,
      estimatedTokens: fullTokens,
      tokensSaved: 0
    };
  }

  /** Reset the compressor's snapshot (forces a full state on next call). */
  reset(): void {
    this.lastHash = undefined;
    this.lastState = undefined;
  }

  get lastStateHash(): string | undefined {
    return this.lastHash;
  }
}

function truncateIfNeeded(
  payload: Record<string, unknown>,
  maxBytes: number
): Record<string, unknown> {
  const json = JSON.stringify(payload);
  if (json.length <= maxBytes) return payload;

  // Trim the source tree (largest field) first, then truncate JSON
  const trimmed = { ...payload };
  delete trimmed["sourceTree"];

  const trimmedJson = JSON.stringify(trimmed);
  if (trimmedJson.length <= maxBytes) return trimmed;

  // Hard truncate as last resort — mark as truncated
  return {
    _nexo_truncated: true,
    _nexo_original_bytes: json.length,
    ...(JSON.parse(trimmedJson.slice(0, maxBytes - 100) + '"}') as Record<string, unknown>)
  };
}

export function createContextCompressor(options?: CompressOptions): ContextCompressor {
  return new ContextCompressor(options);
}

/**
 * Structured logging.
 *
 * {@link createLogger} writes one JSON object per line
 * (`{"time":…,"level":"info","msg":…,…fields}`), which log shippers and
 * OpenTelemetry collectors ingest directly. `child()` binds fields such as a
 * request ID to every line it writes.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;

export interface NexoLogger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every entry. */
  child(fields: LogFields): NexoLogger;
}

export interface LogEntry {
  readonly time: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly [field: string]: unknown;
}

export interface LoggerOptions {
  /** Minimum level written. Default: "info" */
  readonly level?: LogLevel;
  /** Fields added to every entry, e.g. `{ service: "api" }`. */
  readonly fields?: LogFields;
  /** Receives each entry. Default: JSON line to stdout (stderr for warn/error). */
  readonly sink?: (entry: LogEntry) => void;
  /** Clock override. */
  readonly now?: () => Date;
  /**
   * Field names whose values are replaced with "[REDACTED]" at any depth
   * (case-insensitive). Default: {@link DEFAULT_REDACT_KEYS}. Pass `[]` to
   * disable.
   */
  readonly redact?: readonly string[];
}

/** Field names redacted by default: credentials that must never reach logs. */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "api_key",
  "x-api-key"
];

const REDACTED = "[REDACTED]";

const LEVELS: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Redacts sensitive keys at any depth (cycle-safe, max depth 8). */
function redactValue(value: unknown, keys: ReadonlySet<string>, depth: number, seen: WeakSet<object>): unknown {
  if (keys.size === 0 || typeof value !== "object" || value === null || depth > 8) return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keys, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = keys.has(key.toLowerCase()) ? REDACTED : redactValue(inner, keys, depth + 1, seen);
  }
  return out;
}

/** Turns Error values into plain objects and redacts sensitive keys. */
function normalize(fields: LogFields, keys: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (keys.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message, stack: value.stack };
    } else {
      out[key] = redactValue(value, keys, 0, new WeakSet());
    }
  }
  return out;
}

function defaultSink(entry: LogEntry): void {
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ time: entry.time, level: entry.level, msg: entry.msg, logError: "unserializable fields" });
  }
  (entry.level === "warn" || entry.level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

export function createLogger(options: LoggerOptions = {}): NexoLogger {
  const minimum = LEVELS[options.level ?? "info"];
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const redactKeys = new Set((options.redact ?? DEFAULT_REDACT_KEYS).map((key) => key.toLowerCase()));

  function build(bound: LogFields): NexoLogger {
    function write(level: LogLevel, msg: string, fields?: LogFields): void {
      if (LEVELS[level] < minimum) return;
      try {
        sink({ ...normalize(bound, redactKeys), ...normalize(fields ?? {}, redactKeys), time: now().toISOString(), level, msg });
      } catch {
        // Logging must never break the caller.
      }
    }
    return {
      debug: (msg, fields) => write("debug", msg, fields),
      info: (msg, fields) => write("info", msg, fields),
      warn: (msg, fields) => write("warn", msg, fields),
      error: (msg, fields) => write("error", msg, fields),
      child: (fields) => build({ ...bound, ...fields })
    };
  }

  return build(options.fields ?? {});
}

/** A logger that discards everything. */
export const noopLogger: NexoLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger;
  }
};

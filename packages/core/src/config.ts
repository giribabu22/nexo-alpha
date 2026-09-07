export interface EnvConfigOptions {
  readonly prefix?: string;
  readonly env?: Record<string, string | undefined>;
}

export function loadEnvConfig(
  options: EnvConfigOptions = {}
): Record<string, unknown> {
  const prefix = options.prefix ?? "NEXO_";
  const source = options.env ?? process.env;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || !key.startsWith(prefix)) {
      continue;
    }

    const stripped = key.slice(prefix.length);
    if (!stripped) {
      continue;
    }

    const camelKey = stripped
      .toLowerCase()
      .replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());

    if (value === "true") {
      result[camelKey] = true;
    } else if (value === "false") {
      result[camelKey] = false;
    } else if (/^-?\d+(\.\d+)?$/.test(value) && !isNaN(Number(value))) {
      result[camelKey] = Number(value);
    } else {
      try {
        result[camelKey] = JSON.parse(value);
      } catch {
        result[camelKey] = value;
      }
    }
  }

  return result;
}

export function defineConfig<T extends Record<string, unknown>>(config: T): T {
  return config;
}

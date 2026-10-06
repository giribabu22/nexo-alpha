import type {
  NexoClientOptions,
  NexoHealth,
  NexoKnowledge,
  NexoModuleInfo
} from "./types.js";
import { NexoWorkflowsClient } from "./workflows.js";
import { NexoMemoryClient } from "./memory.js";
import { NexoProjectsClient } from "./projects.js";
import type { NexoMetricsSnapshot } from "./metrics.js";

export class NexoApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "NexoApiError";
    this.status = status;
    this.payload = payload;
  }
}

export class NexoClient {
  readonly baseUrl: string;
  /** Workflow API: start, inspect, resume and wait for workflow runs. */
  readonly workflows: NexoWorkflowsClient;
  /** Agent memory API: recall, inspect, edit and forget memory entries. */
  readonly memory: NexoMemoryClient;
  /** Projects API: list, create and manage members of projects (tenants). */
  readonly projects: NexoProjectsClient;
  /** The active project, sent as `x-project-id` on every request. */
  readonly projectId: string | undefined;
  private readonly options: NexoClientOptions;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  constructor(options: NexoClientOptions = {}) {
    this.options = options;
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.projectId = options.projectId;
    this.workflows = new NexoWorkflowsClient(this, options.workflowsPath);
    this.memory = new NexoMemoryClient(this, options.memoryPath);
    this.projects = new NexoProjectsClient(this, options.projectsPath);
    this.defaultHeaders = {
      "Accept": "application/json",
      ...(options.headers ?? {}),
      ...(options.projectId !== undefined ? { "x-project-id": options.projectId } : {})
    };
    this.fetchFn = options.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : fetch);
  }

  /** A client with the same settings that works in another project. */
  forProject(projectId: string | undefined): NexoClient {
    return new NexoClient({ ...this.options, projectId });
  }

  private resolveUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  async api<T = unknown>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const url = this.resolveUrl(path);
    const authHeaders: Record<string, string> = {};

    if (this.options.auth?.token !== undefined) {
      const token = typeof this.options.auth.token === "function"
        ? await this.options.auth.token()
        : this.options.auth.token;
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;
    }

    if (this.options.auth?.apiKey !== undefined) {
      const apiKey = typeof this.options.auth.apiKey === "function"
        ? await this.options.auth.apiKey()
        : this.options.auth.apiKey;
      if (apiKey) authHeaders["x-api-key"] = apiKey;
    }

    const headers = {
      ...this.defaultHeaders,
      ...authHeaders,
      ...(init?.headers as Record<string, string> | undefined)
    };

    const timeout = init?.timeoutMs ?? this.options.timeoutMs;
    let timer: NodeJS.Timeout | undefined;

    const requestInit: RequestInit = {
      ...init,
      headers
    };

    if (init?.signal !== undefined) {
      requestInit.signal = init.signal;
    } else if (timeout && timeout > 0) {
      const controller = new AbortController();
      requestInit.signal = controller.signal;
      timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeout}ms`)), timeout);
    }

    try {
      const response = await this.fetchFn(url, requestInit);

      if (!response.ok) {
        let errorPayload: unknown;
        let errorMessage = `HTTP ${response.status} ${response.statusText}`;
        try {
          errorPayload = await response.json();
          if (errorPayload && typeof errorPayload === "object" && "error" in errorPayload) {
            errorMessage = String((errorPayload as { error: unknown }).error);
          } else if (errorPayload && typeof errorPayload === "object" && "message" in errorPayload) {
            errorMessage = String((errorPayload as { message: unknown }).message);
          }
        } catch {
          // response is not JSON
        }
        throw new NexoApiError(errorMessage, response.status, errorPayload);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.api<T>(path, { method: "GET" });
  }

  post<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const requestInit: RequestInit = {
      ...init,
      method: "POST",
      headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) }
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }
    return this.api<T>(path, requestInit);
  }

  put<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const requestInit: RequestInit = {
      ...init,
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) }
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }
    return this.api<T>(path, requestInit);
  }

  patch<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const requestInit: RequestInit = {
      ...init,
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) }
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }
    return this.api<T>(path, requestInit);
  }

  delete<T = unknown>(path: string): Promise<T> {
    return this.api<T>(path, { method: "DELETE" });
  }

  async getHealth(): Promise<NexoHealth> {
    return this.get<NexoHealth>("/api/health");
  }

  async getKnowledge(): Promise<NexoKnowledge> {
    return this.get<NexoKnowledge>("/api/knowledge");
  }

  /** Metrics snapshot from `createMetricsApiModule()` (`@nexo-alpha/tools`). */
  async getMetrics(path = "/metrics"): Promise<NexoMetricsSnapshot> {
    return this.get<NexoMetricsSnapshot>(path);
  }

  async getModules(): Promise<readonly NexoModuleInfo[]> {
    const health = await this.getHealth();
    return health.moduleGraph ?? [];
  }
}

export function createNexoClient(options?: NexoClientOptions): NexoClient {
  return new NexoClient(options);
}

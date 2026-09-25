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

  async api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const url = this.resolveUrl(path);
    const headers = {
      ...this.defaultHeaders,
      ...(init?.headers as Record<string, string> | undefined)
    };

    const response = await this.fetchFn(url, {
      ...init,
      headers
    });

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
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.api<T>(path, { method: "GET" });
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return this.api<T>(path, init);
  }

  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method: "PUT",
      headers: { "Content-Type": "application/json" }
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return this.api<T>(path, init);
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

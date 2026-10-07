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
import type { NexoModel } from "@nexo-alpha/core/model";
import { NexoResourceClient, type NexoResourceClientOptions } from "./resource.js";
import { NexoSession } from "./session.js";
import { NexoAuthClient } from "./auth.js";
import { NexoFilesClient } from "./files.js";

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
  /** The signed-in session; its token is sent on every request (unless `auth.token` is set). */
  readonly session: NexoSession;
  /** Sign-in API of a server `createAuth()` module: login, register, logout, me. */
  readonly auth: NexoAuthClient;
  /** Uploads and download URLs of a server `createFiles()` module. */
  readonly files: NexoFilesClient;
  /** The active project, sent as `x-project-id` on every request. */
  readonly projectId: string | undefined;
  private readonly options: NexoClientOptions;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchFn: typeof fetch;
  private readonly resourceCache = new Map<string, NexoResourceClient<NexoModel>>();

  constructor(options: NexoClientOptions = {}) {
    this.options = options;
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.projectId = options.projectId;
    this.workflows = new NexoWorkflowsClient(this, options.workflowsPath);
    this.memory = new NexoMemoryClient(this, options.memoryPath);
    this.projects = new NexoProjectsClient(this, options.projectsPath);
    this.session = options.session ?? new NexoSession();
    this.auth = new NexoAuthClient(this, options.authPath);
    this.files = new NexoFilesClient(this, options.filesPath);
    this.defaultHeaders = {
      "Accept": "application/json",
      ...(options.headers ?? {}),
      ...(options.projectId !== undefined ? { "x-project-id": options.projectId } : {})
    };
    this.fetchFn = options.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : fetch);
  }

  /**
   * Typed client for the server `resource()` of `model`. The same instance is
   * returned for the same model and path, so change notifications reach every
   * list showing it.
   */
  resource<M extends NexoModel>(model: M, options: NexoResourceClientOptions = {}): NexoResourceClient<M> {
    const key = `${model.name} ${options.path ?? ""}`;
    let resource = this.resourceCache.get(key);
    if (resource === undefined || resource.model !== model) {
      resource = new NexoResourceClient<NexoModel>(this, model, options);
      this.resourceCache.set(key, resource);
    }
    return resource as unknown as NexoResourceClient<M>;
  }

  /**
   * Typed client proxy for `@nexo-alpha/data` resources:
   *
   * ```ts
   * const api = nexo.resources<{ users: typeof User }>();
   * const page = await api.users.list();
   * const user = await api.users.get("id");
   * ```
   */
  resources<R extends Record<string, any>>(resourcesMap?: R): {
    [K in keyof R]: {
      readonly path: string;
      list(query?: Record<string, any>): Promise<any>;
      get(id: string): Promise<any>;
      create(data: any): Promise<any>;
      update(id: string, patch: any): Promise<any>;
      delete(id: string): Promise<void>;
    };
  } {
    const proxyCache = new Map<string, any>();
    return new Proxy({} as any, {
      get: (_target, prop: string | symbol) => {
        if (typeof prop !== "string") return undefined;
        let cached = proxyCache.get(prop);
        if (cached) return cached;

        const resDef = resourcesMap?.[prop];
        const path = (resDef?.path ?? `/${prop.replace(/([A-Z])/g, "-$1").toLowerCase()}`).replace(/\/+$/, "");

        cached = {
          path,
          list: (query: Record<string, any> = {}) => {
            const params = new URLSearchParams();
            if (query.limit !== undefined) params.set("limit", String(query.limit));
            if (query.cursor !== undefined) params.set("cursor", String(query.cursor));
            if (query.sort !== undefined) params.set("sort", String(query.sort));
            if (query.where !== undefined && typeof query.where === "object" && query.where !== null) {
              for (const [k, v] of Object.entries(query.where)) {
                if (v !== undefined && v !== null) params.set(`where[${k}]`, String(v));
              }
            }
            const qs = params.toString();
            return this.get(qs ? `${path}?${qs}` : path);
          },
          get: (id: string) => this.get(`${path}/${encodeURIComponent(id)}`),
          create: (data: unknown) => this.post(path, data),
          update: (id: string, patch: unknown) => this.patch(`${path}/${encodeURIComponent(id)}`, patch),
          delete: (id: string) => this.delete(`${path}/${encodeURIComponent(id)}`)
        };
        proxyCache.set(prop, cached);
        return cached;
      }
    });
  }

  /** A client with the same settings that works in another project. */
  forProject(projectId: string | undefined): NexoClient {
    return new NexoClient({ ...this.options, projectId, session: this.session });
  }

  private resolveUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  async api<T = unknown>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    return this.request(path, init, async (response) =>
      // 204 No Content has no body.
      response.status === 204 ? (undefined as T) : ((await response.json()) as T)
    );
  }

  /**
   * Sends a request with the client's auth, session, project and timeout, and
   * reads a successful response with `read` (e.g. `(r) => r.blob()`). Failed
   * responses throw NexoApiError, as with `api()`.
   */
  async request<T>(
    path: string,
    init: (RequestInit & { timeoutMs?: number }) | undefined,
    read: (response: Response) => Promise<T>
  ): Promise<T> {
    const url = this.resolveUrl(path);
    const authHeaders: Record<string, string> = {};

    if (this.options.auth?.token !== undefined) {
      const token = typeof this.options.auth.token === "function"
        ? await this.options.auth.token()
        : this.options.auth.token;
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;
    }

    const sessionToken = authHeaders["Authorization"] === undefined ? this.session.token : undefined;
    if (sessionToken !== undefined) authHeaders["Authorization"] = `Bearer ${sessionToken}`;

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
        // The server no longer accepts this session (expired, signed out elsewhere).
        if (response.status === 401 && sessionToken !== undefined && this.session.token === sessionToken) {
          this.session.clear();
        }
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

      return await read(response);
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

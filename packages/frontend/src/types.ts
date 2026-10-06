import type { NexoSession } from "./session.js";

export interface NexoModuleInfo {
  readonly name: string;
  readonly description?: string | undefined;
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly externalDependencies?: readonly string[] | undefined;
}

export interface NexoHealth {
  readonly status: string;
  readonly framework: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
  readonly modules: readonly string[];
  readonly moduleGraph?: readonly NexoModuleInfo[] | undefined;
}

export interface NexoDecision {
  readonly id?: string | undefined;
  readonly title: string;
  readonly reason?: string | undefined;
  readonly status?: string | undefined;
}

export interface NexoConstraint {
  readonly description: string;
  readonly reason?: string | undefined;
}

export interface NexoIntent {
  readonly entityKind: string;
  readonly entityName: string;
  readonly purpose: string;
  readonly evidence?: {
    readonly file: string;
    readonly line?: number | undefined;
  } | undefined;
}

export interface NexoDevelopmentState {
  readonly completed?: readonly string[] | undefined;
  readonly inProgress?: readonly string[] | undefined;
}

export interface NexoKnowledge {
  readonly decisions: readonly NexoDecision[];
  readonly constraints: readonly NexoConstraint[];
  readonly intents: readonly NexoIntent[];
  readonly developmentState: NexoDevelopmentState | null;
}

export interface NexoAuthOptions {
  readonly token?: string | (() => string | Promise<string>) | undefined;
  readonly apiKey?: string | (() => string | Promise<string>) | undefined;
}

export interface NexoClientOptions {
  readonly baseUrl?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly fetch?: typeof fetch | undefined;
  /** Authentication credentials: auto-injects `Authorization: Bearer <token>` or `x-api-key`. */
  readonly auth?: NexoAuthOptions | undefined;
  /** Global request timeout in milliseconds. */
  readonly timeoutMs?: number | undefined;
  /** Route prefix of the workflow API (`createWorkflowApiModule`). Default: "/workflows" */
  readonly workflowsPath?: string | undefined;
  /** Route prefix of the memory API (`createMemoryApiModule`). Default: "/memory" */
  readonly memoryPath?: string | undefined;
  /** Active project: sent as the `x-project-id` header on every request. */
  readonly projectId?: string | undefined;
  /** Route prefix of the projects API (`createProjectApiModule`). Default: "/projects" */
  readonly projectsPath?: string | undefined;
  /** Route prefix of the sign-in API (`createAuth`). Default: "/api/auth" */
  readonly authPath?: string | undefined;
  /** Route prefix of the files API (`createFiles`). Default: "/api/files" */
  readonly filesPath?: string | undefined;
  /** Session to use, e.g. one shared by several clients. Default: a new one (persisted in localStorage in browsers). */
  readonly session?: NexoSession | undefined;
}

export interface UsePollingOptions {
  readonly pollInterval?: number | undefined;
  readonly enabled?: boolean | undefined;
}

export interface UseApiOptions<T = unknown> extends UsePollingOptions {
  readonly initialData?: T | undefined;
}

export interface UseApiResult<T = unknown> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

export interface UseMutationResult<TData = unknown, TVariables = void> {
  readonly mutate: (variables: TVariables) => Promise<TData>;
  readonly data: TData | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly reset: () => void;
}


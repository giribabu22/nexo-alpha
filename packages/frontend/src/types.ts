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

export interface NexoClientOptions {
  readonly baseUrl?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly fetch?: typeof fetch | undefined;
}

export interface UsePollingOptions {
  readonly pollInterval?: number | undefined;
  readonly enabled?: boolean | undefined;
}

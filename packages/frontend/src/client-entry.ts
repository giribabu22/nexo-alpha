/**
 * React-free entry point: `import { createNexoClient } from "@nexo-alpha/frontend/client"`.
 * Use it from Node scripts, CLIs and servers that don't have React installed.
 */

export { NexoClient, createNexoClient, NexoApiError } from "./client.js";
export { NexoWorkflowsClient } from "./workflows.js";
export { NexoMemoryClient } from "./memory.js";
export { NexoProjectsClient } from "./projects.js";
export { NexoResourceClient } from "./resource.js";
export { NexoSession } from "./session.js";
export type { NexoSessionOptions, SessionStorageLike } from "./session.js";
export { NexoAuthClient } from "./auth.js";
export { NexoFilesClient } from "./files.js";
export type { NexoRegisterInput } from "./auth.js";
export type { NexoResourceClientOptions } from "./resource.js";
export { createQuery } from "./query.js";
export type { NexoQuery, NexoQueryState, CreateQueryOptions } from "./query.js";
export type { NexoProject } from "./projects.js";
export { summarizeMetrics } from "./metrics.js";

export type { MemoryEntry, MemoryQuery, RememberRequest } from "./memory.js";
export type {
  NexoMetricsSnapshot,
  NexoMetricsTotals,
  NexoApiMetrics,
  NexoCronJobMetrics,
  NexoWorkflowMetrics,
  NexoQueueMetrics
} from "./metrics.js";

export type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepRecord,
  StartRunRequest,
  WaitForRunOptions,
  WorkflowDescription,
  WorkflowToolInfo
} from "./workflows.js";

export type {
  NexoClientOptions,
  NexoAuthOptions,
  NexoHealth,
  NexoKnowledge,
  NexoModuleInfo
} from "./types.js";

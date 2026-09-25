/**
 * React-free entry point: `import { createNexoClient } from "@nexo-alpha/frontend/client"`.
 * Use it from Node scripts, CLIs and servers that don't have React installed.
 */

export { NexoClient, createNexoClient, NexoApiError } from "./client.js";
export { NexoWorkflowsClient } from "./workflows.js";
export { NexoMemoryClient } from "./memory.js";
export { NexoProjectsClient } from "./projects.js";
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
  NexoHealth,
  NexoKnowledge,
  NexoModuleInfo
} from "./types.js";

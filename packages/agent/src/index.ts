// ---- Agent ----------------------------------------------------------------
export {
  createAgent
} from "./agent.js";

export type {
  NexoAgent,
  AgentOptions,
  ExecuteOptions,
  RunOptions
} from "./agent.js";

// ---- Understand (Intent Parsing) -------------------------------------------
export {
  createSimpleIntentParser,
  createStepIntentParser
} from "./understand.js";

export type {
  IntentParser,
  IntentParserOptions,
  SimpleIntentParserOptions,
  SimpleIntentParserMapping
} from "./understand.js";

// ---- Workflow (Phase 6 & 7 Autonomous Engine & Persistence) --------------
export {
  createWorkflow,
  generateWorkflowId
} from "./workflow.js";

export type {
  NexoWorkflow,
  WorkflowState,
  WorkflowStatus,
  WorkflowOptions,
  RunWorkflowOptions,
  WorkflowEvent,
  WorkflowEventListener
} from "./workflow.js";

export {
  createInMemoryWorkflowStore,
  createKnowledgeWorkflowStore,
  createFileWorkflowStore,
  createDocumentWorkflowStore
} from "./workflow-store.js";

export type {
  WorkflowStore,
  WorkflowFilter,
  DocumentWorkflowStoreOptions
} from "./workflow-store.js";

// ---- Workflow HTTP API ----------------------------------------------------
export { createWorkflowApiModule } from "./workflow-api.js";
export type { WorkflowApiOptions, WorkflowJobQueue, WorkflowJobPayload } from "./workflow-api.js";

// ---- Durable audit trail --------------------------------------------------
export { createDocumentAuditTrail } from "./audit-trail.js";
export type { AuditQuery, DocumentAuditTrail, DocumentAuditTrailOptions } from "./audit-trail.js";

// ---- Memory HTTP API ------------------------------------------------------
export { createMemoryApiModule } from "./memory-api.js";
export type { MemoryApiOptions } from "./memory-api.js";

// ---- Agent Memory ---------------------------------------------------------
export {
  createAgentMemory,
  createInMemoryAgentMemory,
  createFileAgentMemory,
  createDocumentAgentMemory
} from "./memory.js";

export type {
  AgentMemory,
  MemoryBackend,
  MemoryEntry,
  RememberOptions,
  RecallQuery,
  DocumentAgentMemoryOptions
} from "./memory.js";

// ---- Tool Registry --------------------------------------------------------
export {
  createToolRegistry
} from "./tool-registry.js";

export type {
  ToolRegistry,
  NexoTool,
  ToolContext,
  ToolResult
} from "./tool-registry.js";

// ---- Toolkits (tool plugins) ----------------------------------------------
export { installToolkit } from "./toolkit.js";
export type { AgentToolkit } from "./toolkit.js";

// ---- Tool Permissions (RBAC) ----------------------------------------------
export { toolPermissionRule } from "./tool-permissions.js";
export type { ToolPermissionRuleOptions } from "./tool-permissions.js";

// ---- Verifier Registry ----------------------------------------------------
export {
  createVerifierRegistry
} from "./verifier.js";

export type {
  VerifierRegistry,
  ResultVerifier,
  VerificationContext,
  VerificationResult,
  VerificationStatus,
  FailureRecovery
} from "./verifier.js";

// ---- Audit ----------------------------------------------------------------
export {
  createExecutionAuditLog
} from "./audit.js";

export type {
  ExecutionAuditLog,
  ExecutionRecord,
  ExecutionStatus
} from "./audit.js";

// ---- DSC Agent (instrumented + deduplicated) --------------------------------
export {
  createDscAgent
} from "./dsc-agent.js";

export type {
  DscAgentOptions
} from "./dsc-agent.js";

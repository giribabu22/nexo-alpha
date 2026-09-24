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
  RunWorkflowOptions
} from "./workflow.js";

export {
  createInMemoryWorkflowStore,
  createKnowledgeWorkflowStore,
  createFileWorkflowStore
} from "./workflow-store.js";

export type {
  WorkflowStore,
  WorkflowFilter
} from "./workflow-store.js";

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

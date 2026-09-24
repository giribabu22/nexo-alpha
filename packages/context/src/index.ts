export {
  buildContext,
  contextToJson,
  describeStructure,
  hashStructure,
  hashSourceTree,
  hashSourceFile,
  hashSourceTreeFiles
} from "./context.js";

export type {
  ApplicationContext,
  ApplicationStructure,
  CallEdge,
  CallSite,
  DependencyEdge,
  ImportEdge,
  ModuleContext,
  SourceFile,
  SourceTree,
  SymbolInfo
} from "./context.js";

export {
  createKnowledge,
  knowledgeToJson,
  knowledgeFromJson,
  KNOWLEDGE_SCHEMA_VERSION
} from "./knowledge.js";

export type {
  ApplicationKnowledge,
  SerializedKnowledge,
  DevelopmentState,
  IntentEntityKind,
  NexoConstraint,
  NexoDecision,
  NexoHistoryEntry,
  NexoIntent,
  NexoIntentEvidence
} from "./knowledge.js";

// DSC-accelerated context builders
export {
  buildContextWithDsc,
  contextToJsonWithDsc,
  buildContextSnapshotWithDsc
} from "./dsc-context.js";

export type {
  DscContextOptions,
  DscContextSnapshot
} from "./dsc-context.js";

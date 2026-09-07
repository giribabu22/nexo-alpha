export {
  buildContext,
  contextToJson,
  describeStructure,
  hashStructure,
  hashSourceTree
} from "./context.js";

export type {
  ApplicationContext,
  ApplicationStructure,
  DependencyEdge,
  ModuleContext,
  SourceFile,
  SourceTree
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
  NexoConstraint,
  NexoDecision,
  NexoHistoryEntry
} from "./knowledge.js";

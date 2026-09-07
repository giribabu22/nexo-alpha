export {
  buildContext,
  contextToJson,
  describeStructure,
  hashStructure
} from "./context.js";

export type {
  ApplicationContext,
  ApplicationStructure,
  DependencyEdge,
  ModuleContext
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

// ---- Core types -----------------------------------------------------------
export type {
  DecisionIntent,
  DecisionOutcome,
  DecisionOutcomeType,
  ApproveOutcome,
  RejectOutcome,
  AskUserOutcome,
  EscalateOutcome,
  DeferOutcome,
  DecisionContext,
  DecisionRule,
  DecisionRuleKind,
  DecisionAuditEntry,
  DecisionAuditLog,
  DecisionEngineOptions,
  EvaluateOptions
} from "./types.js";

// ---- Engine ---------------------------------------------------------------
export {
  DecisionEngine,
  createDecisionEngine
} from "./engine.js";

// ---- Built-in rule factories ----------------------------------------------
export {
  permissionRule,
  stateRule,
  constraintRule,
  confirmationRule,
  escalationRule,
  rateLimitRule
} from "./rules.js";

// ---- Role-based access control --------------------------------------------
export {
  createAccessControl,
  permissionMatches,
  rbacRule
} from "./rbac.js";

export type {
  AccessControl,
  RoleDefinition,
  RbacRuleOptions
} from "./rbac.js";

export type {
  PermissionRuleOptions,
  StateRuleOptions,
  ConstraintRuleOptions,
  ConfirmationRuleOptions,
  EscalationRuleOptions,
  RateLimitRuleOptions
} from "./rules.js";

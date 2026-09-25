export {
  createApplication,
  NexoApplication
} from "./application.js";

export type {
  ApplicationOptions,
  ApplicationState
} from "./application.js";

export type {
  NexoModule
} from "./module.js";

export {
  NexoService
} from "./service.js";

export type {
  NexoServiceDefinition
} from "./service.js";

export type {
  NexoApi,
  NexoApiSchema,
  NexoFieldSchema,
  HttpMethod,
  NexoRequestContext,
  NexoApiHandler,
  NexoValidationOutcome,
  NexoRequestValidator,
  NexoApiAuth,
  NexoAuthResult,
  NexoAuthenticator,
  NexoHttpResponse
} from "./api.js";

export { httpResponse, isHttpResponse } from "./api.js";

export {
  scopeMatches,
  missingScopes,
  apiKeyAuthenticator,
  jwtAuthenticator,
  anyAuthenticator,
  signToken,
  verifyToken,
  scopesFromClaims
} from "./auth.js";

export { createRequestContext } from "./request.js";

export {
  runInProject,
  currentProjectId,
  isValidProjectId,
  scopeByProject,
  createProjectRegistry,
  createProjectApiModule
} from "./projects.js";
export type {
  Project,
  ProjectRegistry,
  ProjectRegistryOptions,
  ProjectApiOptions,
  ScopeByProjectOptions
} from "./projects.js";

export { createRateLimiter } from "./rate-limit.js";

export {
  withTimeout,
  retry,
  createCircuitBreaker,
  NexoTimeoutError,
  NexoCircuitOpenError
} from "./resilience.js";
export type { RetryOptions, CircuitBreaker, CircuitBreakerOptions, CircuitState } from "./resilience.js";
export type { RateLimiter, RateLimiterOptions, RateLimitResult } from "./rate-limit.js";

export {
  createLogger,
  noopLogger,
  DEFAULT_REDACT_KEYS
} from "./logger.js";

export type {
  NexoLogger,
  LogLevel,
  LogFields,
  LogEntry,
  LoggerOptions
} from "./logger.js";

export {
  createInMemoryDocumentStore,
  createFileDocumentStore,
  createSqliteDocumentStore
} from "./storage.js";

export type {
  NexoDocumentStore,
  SqliteDocumentStoreOptions
} from "./storage.js";

export type {
  ApiKeyEntry,
  ApiKeyAuthenticatorOptions,
  JwtAuthenticatorOptions,
  TokenClaims,
  SignTokenOptions,
  VerifyTokenOptions,
  VerifyTokenResult
} from "./auth.js";

export type {
  NexoJob,
  NexoJobRunner
} from "./job.js";

export {
  NexoEventBus,
  NexoEvent
} from "./events.js";

export type {
  ApiCalledEvent,
  ApiErrorEvent,
  JobRanEvent,
  JobFailedEvent
} from "./events.js";

export {
  NexoError,
  NexoConfigurationError,
  NexoLifecycleError,
  NexoResolutionError,
  NexoPluginError,
  NexoValidationError,
  NexoAuthenticationError,
  NexoHttpError
} from "./errors.js";

export {
  loadEnvConfig,
  defineConfig
} from "./config.js";

export type {
  EnvConfigOptions
} from "./config.js";

export {
  NexoContainer
} from "./container.js";

export type {
  ServiceToken,
  ServiceLifetime,
  ServiceFactory,
  BindOptions
} from "./container.js";

export {
  NexoMiddlewarePipeline
} from "./middleware.js";

export type {
  NexoMiddleware
} from "./middleware.js";

export type {
  NexoPlugin,
  InstalledPluginRecord
} from "./plugin.js";

export {
  LifecycleRegistry
} from "./lifecycle.js";

export type {
  LifecyclePhase,
  LifecycleHook
} from "./lifecycle.js";

export type {
  NexoDecision,
  NexoConstraint
} from "./knowledge.js";

// DSC (Deterministic State & Computation) integration layer
export {
  installDscPlugin,
  resolveDscOrchestrator,
  resolveDscInterceptor,
  DSC_ORCHESTRATOR,
  DSC_INTERCEPTOR,
  DSC_COLLECTOR
} from "./dsc-plugin.js";

export type {
  DscOrchestratorLike,
  DscInterceptorLike,
  DscCollectorLike,
  DscPluginOptions,
  InstalledDscPlugin
} from "./dsc-plugin.js";

// DSA (Data Structures & Algorithms) core utilities
export {
  topoSort,
  memoize,
  CountingMap
} from "./dsa.js";

export type {
  TopoNode,
  TopoSortResult
} from "./dsa.js";

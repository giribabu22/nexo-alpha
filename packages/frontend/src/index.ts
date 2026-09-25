// Types
export type {
  NexoHealth,
  NexoModuleInfo,
  NexoDecision,
  NexoConstraint,
  NexoIntent,
  NexoDevelopmentState,
  NexoKnowledge,
  NexoClientOptions,
  UsePollingOptions
} from "./types.js";

// Client & RPC
export {
  NexoClient,
  createNexoClient,
  NexoApiError
} from "./client.js";

// Workflow API client (also available React-free from "@nexo-alpha/frontend/client")
export {
  NexoWorkflowsClient,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowStepRecord,
  type StartRunRequest,
  type WaitForRunOptions,
  type WorkflowDescription,
  type WorkflowToolInfo
} from "./workflows.js";

export {
  NexoProjectsClient,
  type NexoProject
} from "./projects.js";

export {
  NexoMemoryClient,
  type MemoryEntry,
  type MemoryQuery,
  type RememberRequest
} from "./memory.js";

export {
  summarizeMetrics,
  type NexoMetricsSnapshot,
  type NexoMetricsTotals,
  type NexoApiMetrics,
  type NexoCronJobMetrics,
  type NexoWorkflowMetrics,
  type NexoQueueMetrics
} from "./metrics.js";

export {
  createNexoRpcClient,
  type NexoRpcClient,
  type NexoRpcClientOptions,
  type RpcRouteConfig,
  type RpcCaller,
  type InferRpcInput,
  type InferRpcOutput
} from "./rpc.js";

// Context & Provider
export {
  NexoProvider,
  useNexoClient,
  type NexoProviderProps
} from "./context.js";

// React Hooks
export {
  useNexoHealth,
  useNexoKnowledge,
  useNexoModuleGraph,
  useNexoApi,
  useNexoRpcQuery,
  useNexoRpcMutation,
  type UseNexoHealthResult,
  type UseNexoKnowledgeResult,
  type UseNexoModuleGraphResult,
  type UseNexoApiOptions,
  type UseNexoApiResult,
  type UseNexoRpcQueryResult,
  type UseNexoRpcMutationResult
} from "./hooks.js";

export {
  useWorkflowRuns,
  useWorkflowRun,
  useWorkflowActions,
  type UseWorkflowRunsOptions,
  type UseWorkflowRunsResult,
  type UseWorkflowRunOptions,
  type UseWorkflowRunResult,
  type UseWorkflowActionsResult
} from "./workflow-hooks.js";

// NexoComp Core Layer (React in background, NexoComp everywhere)
export {
  nexoComp,
  defineNexoComp,
  type NexoComp,
  type NexoCompOptions,
  type NexoCompMetadata,
  type NexoCompDsaConfig
} from "./comp/nexo-comp.js";

// Built-in NexoComps
export {
  NexoCard,
  NexoCardComp,
  type NexoCardProps
} from "./components/NexoCard.js";

export {
  NexoBadge,
  NexoBadgeComp,
  type NexoBadgeProps,
  type NexoBadgeVariant
} from "./components/NexoBadge.js";

export {
  NexoMetric,
  NexoMetricComp,
  type NexoMetricProps
} from "./components/NexoMetric.js";

export {
  NexoButton,
  NexoButtonComp,
  type NexoButtonProps,
  type NexoButtonVariant
} from "./components/NexoButton.js";

export {
  NexoInput,
  NexoInputComp,
  type NexoInputProps
} from "./components/NexoInput.js";

export {
  NexoTabs,
  NexoTabsComp,
  type NexoTabsProps,
  type NexoTabItem
} from "./components/NexoTabs.js";

export {
  NexoTerminal,
  NexoTerminalComp,
  type NexoTerminalProps,
  type TerminalEntry
} from "./components/NexoTerminal.js";

export {
  NexoPage,
  NexoPageComp,
  type NexoPageProps
} from "./components/NexoPage.js";

export {
  NexoServerStatus,
  NexoServerStatusComp,
  type NexoServerStatusProps
} from "./components/NexoServerStatus.js";

export {
  NexoKnowledgeInspector,
  NexoKnowledgeInspectorComp,
  type NexoKnowledgeInspectorProps
} from "./components/NexoKnowledgeInspector.js";

export {
  NexoModuleGraph,
  NexoModuleGraphComp,
  type NexoModuleGraphProps
} from "./components/NexoModuleGraph.js";

export {
  NexoDscDashboard,
  NexoDscDashboardComp,
  type NexoDscDashboardProps
} from "./components/NexoDscDashboard.js";

export {
  NexoWorkflowStatusBadge,
  NexoWorkflowRunList,
  NexoWorkflowRunListComp,
  NexoWorkflowRunDetail,
  NexoWorkflowRunDetailComp,
  NexoWorkflowDashboard,
  NexoWorkflowDashboardComp,
  type NexoWorkflowRunListProps,
  type NexoWorkflowRunDetailProps,
  type NexoWorkflowDashboardProps
} from "./components/NexoWorkflowRuns.js";

export {
  NexoProjectSwitcher,
  NexoProjectSwitcherComp,
  useProjects,
  type NexoProjectSwitcherProps,
  type UseProjectsResult
} from "./components/NexoProjectSwitcher.js";

export {
  NexoWorkflowCatalog,
  NexoWorkflowCatalogComp,
  useWorkflowCatalog,
  type NexoWorkflowCatalogProps,
  type UseWorkflowCatalogResult
} from "./components/NexoWorkflowCatalog.js";

export {
  NexoMetricsDashboard,
  NexoMetricsDashboardComp,
  useNexoMetrics,
  type NexoMetricsDashboardProps,
  type UseNexoMetricsOptions,
  type UseNexoMetricsResult
} from "./components/NexoMetricsDashboard.js";

export {
  NexoMemoryBrowser,
  NexoMemoryBrowserComp,
  useAgentMemory,
  type NexoMemoryBrowserProps,
  type UseAgentMemoryResult
} from "./components/NexoMemoryBrowser.js";

// DSA (Data Structures & Algorithms) Optimization Layer
// --- Core Structures ---
export {
  NexoLruCache
} from "./dsa/lru.js";

export {
  NexoRadixTrie,
  type RouteMatchResult
} from "./dsa/trie.js";

export {
  NexoElementGraph,
  type ElementNode
} from "./dsa/graph.js";

// --- New DSA: O(1) Ring-Buffer Queue for BFS ---
export {
  ArrayDeque
} from "./dsa/queue.js";

// --- New DSA: O(log n) Min-Heap for priority rendering ---
export {
  MinHeap,
  createDepthHeap
} from "./dsa/heap.js";

// --- New DSA: Probabilistic Bloom Filter for cache pre-check ---
export {
  NexoBloomFilter
} from "./dsa/bloom.js";

// --- New DSA: Bounded Ring Buffer for telemetry ---
export {
  RingBuffer
} from "./dsa/ring-buffer.js";

// --- New DSA: Topological Sort for dependency ordering ---
export {
  topoSort,
  type TopoNode,
  type TopoSortResult
} from "./dsa/topo-sort.js";

export {
  NexoElement,
  NexoElementRoot,
  useNexoElementGraph,
  type NexoElementProps,
  type NexoElementRootProps
} from "./dsa/reactive-element.js";

// Trie + LRU High-Performance Router
export {
  NexoRouter,
  createNexoRouter,
  type RouteDefinition,
  type MatchedRoute,
  type NavigationListener
} from "./router/router.js";

export {
  NexoRouterProvider,
  NexoRoutes,
  NexoRoute,
  NexoLink,
  useNexoRoute,
  useNexoParams,
  useNexoNavigate,
  type NexoRouterProviderProps,
  type NexoRouteProps,
  type NexoLinkProps
} from "./router/components.js";

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

// DSA (Data Structures & Algorithms) Optimization Layer
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

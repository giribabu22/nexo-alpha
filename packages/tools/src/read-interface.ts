import type {
  ApplicationState,
  NexoApi,
  NexoApplication,
  NexoService
} from "@nexo-alpha/core";
import {
  buildContext,
  type ApplicationContext,
  type ApplicationKnowledge,
  type ApplicationStructure,
  type DevelopmentState,
  type IntentEntityKind,
  type ModuleContext,
  type NexoConstraint,
  type NexoDecision,
  type NexoHistoryEntry,
  type NexoIntent,
  type SourceTree
} from "@nexo-alpha/context";
import {
  buildKnowledgeGraph,
  searchKnowledgeGraph,
  traceCallers,
  traceDependents,
  traceImpact,
  type KnowledgeGraph,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  type TraceImpactOptions,
  type TraceImpactResult
} from "./knowledge-graph.js";

export interface ApplicationArchitecture {
  readonly modules: readonly ModuleContext[];
  readonly apis: readonly NexoApi[];
  readonly services: readonly NexoService[];
}

export interface ApplicationStatus {
  readonly state: ApplicationState;
  readonly developmentState: DevelopmentState;
}

const EMPTY_DEVELOPMENT_STATE: DevelopmentState = {
  completed: [],
  inProgress: [],
  blocked: [],
  knownIssues: []
};

export interface NexoReadInterface {
  getApplication(): ApplicationContext["application"];
  getModules(): readonly ModuleContext[];
  getModule(name: string): ModuleContext | undefined;
  getApi(name: string): NexoApi | undefined;
  getService(name: string): NexoService | undefined;
  getDependencies(moduleName: string): readonly string[];
  getDependents(moduleName: string): readonly string[];
  getConfiguration(): Readonly<Record<string, unknown>>;
  getArchitecture(): ApplicationArchitecture;
  /**
   * A rollup of the application's registered structure (module/API/service/
   * job counts, declared dependency edges) plus a deterministic hash of
   * it — derived from the live registry, not from parsing source. Use the
   * hash to detect whether a previously captured snapshot is stale
   * relative to the application's current structure.
   */
  getStructure(): { readonly structure: ApplicationStructure; readonly structureHash: string };
  getDecisions(): readonly NexoDecision[];
  getConstraints(): readonly NexoConstraint[];
  /** Every recorded "why does this exist" record. See `NexoIntent` in `@nexo-alpha/context`. */
  getIntents(): readonly NexoIntent[];
  /** The most recently recorded intent for one entity, or `undefined` if none was recorded. */
  getIntent(entityKind: IntentEntityKind, entityName: string): NexoIntent | undefined;
  getCurrentWork(): DevelopmentState;
  getStatus(): ApplicationStatus;
  getHistory(): readonly NexoHistoryEntry[];
  /**
   * The unified knowledge graph over registered structure (always present,
   * free — the same "no source parsing involved" stance as `getStructure()`)
   * plus, when a `sourceTree` was supplied to `createReadInterface`, scanned
   * source (files/symbols/imports/calls) — see `buildKnowledgeGraph` in
   * `@nexo-alpha/tools`'s `knowledge-graph.ts`. Never `undefined`; when no
   * `sourceTree` was supplied, the graph simply has no file/symbol nodes —
   * `search()`/`traceCallers()`/`traceDependents()` still work over the
   * module/API/service/job/dependency portion.
   */
  getKnowledgeGraph(): Promise<KnowledgeGraph>;
  /** Edges of kind "calls" pointing at `nodeId` — "what calls this." */
  traceCallers(nodeId: string): Promise<readonly KnowledgeGraphEdge[]>;
  /** Every edge pointing at `nodeId` — "what would be affected if this changed." */
  traceDependents(nodeId: string): Promise<readonly KnowledgeGraphEdge[]>;
  /**
   * Multi-hop traversal from `nodeId` — the full transitive blast radius,
   * not just the immediate neighbors `traceDependents()` returns. See
   * `traceImpact` in `@nexo-alpha/tools`'s `knowledge-graph.ts` for the
   * BFS/shortest-path/cycle-protection behavior and `options` shape.
   */
  traceImpact(nodeId: string, options?: TraceImpactOptions): Promise<TraceImpactResult>;
  /** Case-insensitive keyword search over node names/descriptions/summaries — not semantic search. */
  search(query: string): Promise<readonly KnowledgeGraphNode[]>;
}

export function createReadInterface(
  app: NexoApplication,
  knowledge?: ApplicationKnowledge,
  sourceTree?: SourceTree
): NexoReadInterface {
  const getGraph = async (): Promise<KnowledgeGraph> =>
    buildKnowledgeGraph(buildContext(app, knowledge, sourceTree));

  return {
    getApplication() {
      return buildContext(app, knowledge).application;
    },

    getModules() {
      return buildContext(app, knowledge).modules;
    },

    getModule(name) {
      return buildContext(app, knowledge).modules.find((module) => module.name === name);
    },

    getApi(name) {
      return app.getApis().find((api) => api.name === name);
    },

    getService(name) {
      return app.getServices().find((service) => service.name === name);
    },

    getDependencies(moduleName) {
      return app.getDependencies(moduleName);
    },

    getDependents(moduleName) {
      return app.getDependents(moduleName);
    },

    getConfiguration() {
      return app.getAllConfig();
    },

    getArchitecture() {
      return {
        modules: buildContext(app, knowledge).modules,
        apis: app.getApis(),
        services: app.getServices()
      };
    },

    getStructure() {
      const context = buildContext(app, knowledge);
      return { structure: context.structure, structureHash: context.structureHash };
    },

    getDecisions() {
      return knowledge?.getDecisions() ?? [];
    },

    getConstraints() {
      return knowledge?.getConstraints() ?? [];
    },

    getIntents() {
      return knowledge?.getIntents() ?? [];
    },

    getIntent(entityKind, entityName) {
      return knowledge?.getIntent(entityKind, entityName);
    },

    getCurrentWork() {
      return knowledge?.getDevelopmentState() ?? EMPTY_DEVELOPMENT_STATE;
    },

    getStatus() {
      return {
        state: app.state,
        developmentState: knowledge?.getDevelopmentState() ?? EMPTY_DEVELOPMENT_STATE
      };
    },

    getHistory() {
      return knowledge?.getHistory() ?? [];
    },

    getKnowledgeGraph() {
      return getGraph();
    },

    async traceCallers(nodeId) {
      return traceCallers(await getGraph(), nodeId);
    },

    async traceDependents(nodeId) {
      return traceDependents(await getGraph(), nodeId);
    },

    async traceImpact(nodeId, options) {
      return traceImpact(await getGraph(), nodeId, options);
    },

    async search(query) {
      return searchKnowledgeGraph(await getGraph(), query);
    }
  };
}

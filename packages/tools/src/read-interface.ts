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
  type ModuleContext,
  type NexoConstraint,
  type NexoDecision,
  type NexoHistoryEntry
} from "@nexo-alpha/context";

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
  getCurrentWork(): DevelopmentState;
  getStatus(): ApplicationStatus;
  getHistory(): readonly NexoHistoryEntry[];
}

export function createReadInterface(
  app: NexoApplication,
  knowledge?: ApplicationKnowledge
): NexoReadInterface {
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
    }
  };
}

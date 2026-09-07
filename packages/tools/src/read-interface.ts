import type {
  ApplicationState,
  DevelopmentState,
  NexoApi,
  NexoApplication,
  NexoConstraint,
  NexoDecision,
  NexoService
} from "@nexo/core";
import {
  buildContext,
  type ApplicationContext,
  type ModuleContext
} from "@nexo/context";

export interface ApplicationArchitecture {
  readonly modules: readonly ModuleContext[];
  readonly apis: readonly NexoApi[];
  readonly services: readonly NexoService[];
}

export interface ApplicationStatus {
  readonly state: ApplicationState;
  readonly developmentState: DevelopmentState;
}

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
  getDecisions(): readonly NexoDecision[];
  getConstraints(): readonly NexoConstraint[];
  getCurrentWork(): DevelopmentState;
  getStatus(): ApplicationStatus;
}

export function createReadInterface(
  app: NexoApplication
): NexoReadInterface {
  return {
    getApplication() {
      return buildContext(app).application;
    },

    getModules() {
      return buildContext(app).modules;
    },

    getModule(name) {
      return buildContext(app).modules.find((module) => module.name === name);
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
        modules: buildContext(app).modules,
        apis: app.getApis(),
        services: app.getServices()
      };
    },

    getDecisions() {
      return app.getDecisions();
    },

    getConstraints() {
      return app.getConstraints();
    },

    getCurrentWork() {
      return app.getDevelopmentState();
    },

    getStatus() {
      return {
        state: app.state,
        developmentState: app.getDevelopmentState()
      };
    }
  };
}

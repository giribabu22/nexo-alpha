import type {
  ApplicationState,
  NexoApi,
  NexoApplication,
  NexoJob,
  NexoService
} from "@nexo/core";

export interface ModuleContext {
  readonly name: string;
  readonly description?: string | undefined;
  readonly purpose?: string | undefined;
  readonly status?: string | undefined;
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly apis: readonly NexoApi[];
  readonly services: readonly NexoService[];
  readonly events: readonly string[];
  readonly jobs: readonly NexoJob[];
}

export interface ApplicationContext {
  readonly application: {
    readonly name: string;
    readonly version: string;
    readonly description?: string | undefined;
    readonly state: ApplicationState;
  };
  readonly modules: readonly ModuleContext[];
}

export function buildContext(app: NexoApplication): ApplicationContext {
  const modules = app.getModules().map((module): ModuleContext => ({
    name: module.name,
    ...(module.description !== undefined && { description: module.description }),
    ...(module.purpose !== undefined && { purpose: module.purpose }),
    ...(module.status !== undefined && { status: module.status }),
    dependencies: module.dependencies ?? [],
    dependents: app.getDependents(module.name),
    apis: module.apis ?? [],
    services: module.services ?? [],
    events: module.events ?? [],
    jobs: module.jobs ?? []
  }));

  return {
    application: {
      name: app.name,
      version: app.version,
      ...(app.description !== undefined && { description: app.description }),
      state: app.state
    },
    modules
  };
}

export function contextToJson(context: ApplicationContext): string {
  return JSON.stringify(context, null, 2);
}

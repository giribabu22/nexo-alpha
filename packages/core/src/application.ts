import type { NexoModule } from "./module.js";
import type { NexoApi } from "./api.js";
import type { NexoService } from "./service.js";
import type { NexoJob } from "./job.js";
import type { NexoDecision } from "./decision.js";
import type { NexoConstraint } from "./constraint.js";
import type { DevelopmentState } from "./development-state.js";
import type { NexoHistoryEntry } from "./history.js";
import { NexoConfigurationError, NexoLifecycleError } from "./errors.js";
import { NexoEventBus } from "./events.js";

export interface ApplicationOptions {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly config?: Record<string, unknown>;
}

export type ApplicationState =
  | "created"
  | "initializing"
  | "running"
  | "stopping"
  | "stopped";

export class NexoApplication {
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly events: NexoEventBus = new NexoEventBus();

  private readonly modules = new Map<string, NexoModule>();
  private config: Readonly<Record<string, unknown>>;
  private readonly decisions: NexoDecision[] = [];
  private readonly constraints: NexoConstraint[] = [];
  private readonly history: NexoHistoryEntry[] = [];
  private developmentState: DevelopmentState = {
    completed: [],
    inProgress: [],
    blocked: [],
    knownIssues: []
  };

  private _state: ApplicationState = "created";

  constructor(options: ApplicationOptions) {
    this.name = options.name;
    this.version = options.version ?? "0.1.0";
    this.description = options.description;
    this.config = options.config ?? {};
  }

  get state(): ApplicationState {
    return this._state;
  }

  module(module: NexoModule): this {
    if (this.modules.has(module.name)) {
      throw new NexoConfigurationError(
        `Nexo module "${module.name}" is already registered.`
      );
    }

    this.modules.set(module.name, module);

    return this;
  }

  getModule(name: string): NexoModule | undefined {
    return this.modules.get(name);
  }

  getModules(): readonly NexoModule[] {
    return [...this.modules.values()];
  }

  getConfig<T = unknown>(key: string): T | undefined {
    return this.config[key] as T | undefined;
  }

  getAllConfig(): Readonly<Record<string, unknown>> {
    return this.config;
  }

  getDependencies(moduleName: string): readonly string[] {
    return this.modules.get(moduleName)?.dependencies ?? [];
  }

  getDependents(moduleName: string): readonly string[] {
    return [...this.modules.values()]
      .filter((module) => module.dependencies?.includes(moduleName))
      .map((module) => module.name);
  }

  getApis(): readonly NexoApi[] {
    return [...this.modules.values()].flatMap((module) => module.apis ?? []);
  }

  getServices(): readonly NexoService[] {
    return [...this.modules.values()].flatMap(
      (module) => module.services ?? []
    );
  }

  getJobs(): readonly NexoJob[] {
    return [...this.modules.values()].flatMap((module) => module.jobs ?? []);
  }

  private requireModule(moduleName: string): NexoModule {
    const module = this.modules.get(moduleName);

    if (!module) {
      throw new NexoConfigurationError(
        `Nexo module "${moduleName}" is not registered.`
      );
    }

    return module;
  }

  addApiToModule(moduleName: string, api: NexoApi): this {
    const module = this.requireModule(moduleName);

    if (module.apis?.some((existing) => existing.name === api.name)) {
      throw new NexoConfigurationError(
        `API "${api.name}" is already registered on module "${moduleName}".`
      );
    }

    this.modules.set(moduleName, {
      ...module,
      apis: [...(module.apis ?? []), api]
    });

    return this;
  }

  updateApi(
    moduleName: string,
    apiName: string,
    patch: Partial<NexoApi>
  ): NexoApi {
    const module = this.requireModule(moduleName);
    const existing = module.apis?.find((api) => api.name === apiName);

    if (!existing) {
      throw new NexoConfigurationError(
        `API "${apiName}" is not registered on module "${moduleName}".`
      );
    }

    const updated: NexoApi = { ...existing, ...patch };

    this.modules.set(moduleName, {
      ...module,
      apis: (module.apis ?? []).map((api) =>
        api.name === apiName ? updated : api
      )
    });

    return updated;
  }

  addServiceToModule(moduleName: string, service: NexoService): this {
    const module = this.requireModule(moduleName);

    if (
      module.services?.some((existing) => existing.name === service.name)
    ) {
      throw new NexoConfigurationError(
        `Service "${service.name}" is already registered on module "${moduleName}".`
      );
    }

    this.modules.set(moduleName, {
      ...module,
      services: [...(module.services ?? []), service]
    });

    return this;
  }

  updateService(
    moduleName: string,
    serviceName: string,
    patch: Partial<NexoService>
  ): NexoService {
    const module = this.requireModule(moduleName);
    const existing = module.services?.find(
      (service) => service.name === serviceName
    );

    if (!existing) {
      throw new NexoConfigurationError(
        `Service "${serviceName}" is not registered on module "${moduleName}".`
      );
    }

    const updated: NexoService = { ...existing, ...patch };

    this.modules.set(moduleName, {
      ...module,
      services: (module.services ?? []).map((service) =>
        service.name === serviceName ? updated : service
      )
    });

    return updated;
  }

  updateConfig(patch: Record<string, unknown>): Readonly<Record<string, unknown>> {
    this.config = { ...this.config, ...patch };
    return this.config;
  }

  addModuleDependency(moduleName: string, dependencyName: string): readonly string[] {
    const module = this.requireModule(moduleName);

    if (dependencyName === moduleName) {
      throw new NexoConfigurationError(
        `Module "${moduleName}" cannot depend on itself.`
      );
    }

    if (!this.modules.has(dependencyName)) {
      throw new NexoConfigurationError(
        `Nexo module "${dependencyName}" is not registered.`
      );
    }

    if (module.dependencies?.includes(dependencyName)) {
      throw new NexoConfigurationError(
        `Module "${moduleName}" already depends on "${dependencyName}".`
      );
    }

    const dependencies = [...(module.dependencies ?? []), dependencyName];

    this.modules.set(moduleName, { ...module, dependencies });

    return dependencies;
  }

  addHistoryEntry(entry: Omit<NexoHistoryEntry, "timestamp">): this {
    this.history.push({ ...entry, timestamp: new Date().toISOString() });
    return this;
  }

  getHistory(): readonly NexoHistoryEntry[] {
    return [...this.history];
  }

  addDecision(decision: NexoDecision): this {
    this.decisions.push(decision);
    return this;
  }

  getDecisions(): readonly NexoDecision[] {
    return [...this.decisions];
  }

  addConstraint(constraint: NexoConstraint): this {
    this.constraints.push(constraint);
    return this;
  }

  getConstraints(): readonly NexoConstraint[] {
    return [...this.constraints];
  }

  setDevelopmentState(patch: Partial<DevelopmentState>): this {
    this.developmentState = { ...this.developmentState, ...patch };
    return this;
  }

  getDevelopmentState(): DevelopmentState {
    return this.developmentState;
  }

  async start(): Promise<void> {
    if (this._state === "running") {
      return;
    }

    if (this._state !== "created" && this._state !== "stopped") {
      throw new NexoLifecycleError(
        `Cannot start application while in "${this._state}" state.`
      );
    }

    this._state = "initializing";

    for (const module of this.modules.values()) {
      await module.initialize?.();
    }

    for (const module of this.modules.values()) {
      await module.start?.();
    }

    this._state = "running";
  }

  async stop(): Promise<void> {
    if (this._state === "stopped") {
      return;
    }

    if (this._state !== "running") {
      throw new NexoLifecycleError(
        `Cannot stop application while in "${this._state}" state.`
      );
    }

    this._state = "stopping";

    const modules = [...this.modules.values()].reverse();

    for (const module of modules) {
      await module.stop?.();
    }

    this._state = "stopped";
  }
}

export function createApplication(
  options: ApplicationOptions
): NexoApplication {
  return new NexoApplication(options);
}

import type { NexoModule } from "./module.js";
import type { NexoApi } from "./api.js";
import type { NexoService } from "./service.js";
import type { NexoJob } from "./job.js";
import { NexoConfigurationError, NexoLifecycleError } from "./errors.js";
import { NexoEvent, NexoEventBus } from "./events.js";

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
  | "stopped"
  | "failed";

export class NexoApplication {
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly events: NexoEventBus = new NexoEventBus();

  private readonly modules = new Map<string, NexoModule>();
  private config: Readonly<Record<string, unknown>>;

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

  private assertModifiable(): void {
    if (this._state !== "created" && this._state !== "stopped") {
      throw new NexoLifecycleError(
        `Cannot modify application structure or configuration while in state "${this._state}".`
      );
    }
  }

  module(module: NexoModule): this {
    this.assertModifiable();

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
    this.assertModifiable();
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
    this.assertModifiable();
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
    this.assertModifiable();
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
    this.assertModifiable();
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

  addJobToModule(moduleName: string, job: NexoJob): this {
    this.assertModifiable();
    const module = this.requireModule(moduleName);

    if (module.jobs?.some((existing) => existing.name === job.name)) {
      throw new NexoConfigurationError(
        `Job "${job.name}" is already registered on module "${moduleName}".`
      );
    }

    this.modules.set(moduleName, {
      ...module,
      jobs: [...(module.jobs ?? []), job]
    });

    return this;
  }

  updateJob(moduleName: string, jobName: string, patch: Partial<NexoJob>): NexoJob {
    this.assertModifiable();
    const module = this.requireModule(moduleName);
    const existing = module.jobs?.find((job) => job.name === jobName);

    if (!existing) {
      throw new NexoConfigurationError(
        `Job "${jobName}" is not registered on module "${moduleName}".`
      );
    }

    const updated: NexoJob = { ...existing, ...patch };

    this.modules.set(moduleName, {
      ...module,
      jobs: (module.jobs ?? []).map((job) => (job.name === jobName ? updated : job))
    });

    return updated;
  }

  updateConfig(patch: Record<string, unknown>): Readonly<Record<string, unknown>> {
    this.assertModifiable();
    this.config = { ...this.config, ...patch };
    return this.config;
  }

  addModuleDependency(moduleName: string, dependencyName: string): readonly string[] {
    this.assertModifiable();
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
    this.events.emit(NexoEvent.APPLICATION_INITIALIZING, { state: this._state });

    try {
      for (const module of this.modules.values()) {
        await module.initialize?.();
      }

      for (const module of this.modules.values()) {
        await module.start?.();
      }
    } catch (error) {
      this._state = "failed";
      this.events.emit(NexoEvent.APPLICATION_FAILED, {
        state: this._state,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    this._state = "running";
    this.events.emit(NexoEvent.APPLICATION_STARTED, { state: this._state });
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
    this.events.emit(NexoEvent.APPLICATION_STOPPING, { state: this._state });

    const modules = [...this.modules.values()].reverse();

    try {
      for (const module of modules) {
        await module.stop?.();
      }
    } catch (error) {
      this._state = "failed";
      this.events.emit(NexoEvent.APPLICATION_FAILED, {
        state: this._state,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    this._state = "stopped";
    this.events.emit(NexoEvent.APPLICATION_STOPPED, { state: this._state });
  }

  /**
   * Recovers a "failed" application back to "stopped" so it can be
   * started again. Only valid from the "failed" state.
   *
   * This is a best-effort cleanup, not a rollback: reset() does not know
   * which modules successfully completed initialize()/start() before the
   * failure, so it calls stop() on every registered module (in reverse
   * registration order, same as a normal stop()) and tolerates each one
   * failing or being a no-op for a module that never started. Errors are
   * collected and returned rather than thrown, since a caller recovering
   * from a failure needs to see every cleanup problem, not just the
   * first one.
   */
  async reset(): Promise<readonly Error[]> {
    if (this._state !== "failed") {
      throw new NexoLifecycleError(
        `Cannot reset application while in "${this._state}" state.`
      );
    }

    const modules = [...this.modules.values()].reverse();
    const errors: Error[] = [];

    for (const module of modules) {
      try {
        await module.stop?.();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this._state = "stopped";
    this.events.emit(NexoEvent.APPLICATION_RESET, { state: this._state, errors });

    return errors;
  }
}

export function createApplication(
  options: ApplicationOptions
): NexoApplication {
  return new NexoApplication(options);
}

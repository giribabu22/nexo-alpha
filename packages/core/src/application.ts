import type { NexoModule } from "./module.js";
import type {
  NexoApi,
  NexoRequestContext,
  NexoAuthenticator,
  NexoAuthResult
} from "./api.js";
import type { NexoService } from "./service.js";
import type { NexoJob } from "./job.js";
import {
  NexoConfigurationError,
  NexoLifecycleError,
  NexoPluginError,
  NexoValidationError,
  NexoAuthenticationError
} from "./errors.js";
import { NexoEvent, NexoEventBus } from "./events.js";
import {
  NexoContainer,
  type ServiceToken,
  type ServiceFactory,
  type BindOptions
} from "./container.js";
import {
  NexoMiddlewarePipeline,
  type NexoMiddleware
} from "./middleware.js";
import type {
  NexoPlugin,
  InstalledPluginRecord
} from "./plugin.js";
import {
  LifecycleRegistry,
  type LifecyclePhase,
  type LifecycleHook
} from "./lifecycle.js";
import type {
  NexoDecision,
  NexoConstraint
} from "./knowledge.js";

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
  readonly container: NexoContainer = new NexoContainer();

  private readonly modules = new Map<string, NexoModule>();
  private readonly plugins = new Map<string, InstalledPluginRecord>();
  private readonly lifecycle = new LifecycleRegistry();
  private readonly middleware = new NexoMiddlewarePipeline<NexoRequestContext, unknown>();
  private readonly decisions: NexoDecision[] = [];
  private readonly constraints: NexoConstraint[] = [];

  private config: Readonly<Record<string, unknown>>;
  private authenticator?: NexoAuthenticator;
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

  /* -------------------------------------------------------------------------- */
  /* Modules                                                                    */
  /* -------------------------------------------------------------------------- */

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

  /* -------------------------------------------------------------------------- */
  /* Configuration                                                              */
  /* -------------------------------------------------------------------------- */

  getConfig<T = unknown>(key: string): T | undefined {
    return this.config[key] as T | undefined;
  }

  getAllConfig(): Readonly<Record<string, unknown>> {
    return this.config;
  }

  updateConfig(patch: Record<string, unknown>): Readonly<Record<string, unknown>> {
    this.assertModifiable();
    this.config = { ...this.config, ...patch };
    return this.config;
  }

  /* -------------------------------------------------------------------------- */
  /* Dependency Injection / Container                                           */
  /* -------------------------------------------------------------------------- */

  provide<T>(
    token: ServiceToken<T>,
    valueOrFactory: T | ServiceFactory<T>,
    options?: BindOptions
  ): this {
    if (typeof valueOrFactory === "function") {
      this.container.bind(token, valueOrFactory as ServiceFactory<T>, options);
    } else {
      this.container.bindValue(token, valueOrFactory);
    }
    return this;
  }

  resolve<T>(token: ServiceToken<T>): T {
    return this.container.resolve(token);
  }

  /* -------------------------------------------------------------------------- */
  /* Middleware                                                                 */
  /* -------------------------------------------------------------------------- */

  useMiddleware(
    ...middlewares: NexoMiddleware<NexoRequestContext, unknown>[]
  ): this {
    this.middleware.use(...middlewares);
    return this;
  }

  getMiddleware(): readonly NexoMiddleware<NexoRequestContext, unknown>[] {
    return this.middleware.getMiddlewares();
  }

  /* -------------------------------------------------------------------------- */
  /* Plugins                                                                    */
  /* -------------------------------------------------------------------------- */

  async use<TOptions = unknown>(
    plugin: NexoPlugin<TOptions>,
    options?: TOptions
  ): Promise<this> {
    this.assertModifiable();

    if (this.plugins.has(plugin.name)) {
      throw new NexoPluginError(
        `Nexo plugin "${plugin.name}" is already installed.`
      );
    }

    if (plugin.dependencies && plugin.dependencies.length > 0) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new NexoPluginError(
            `Plugin "${plugin.name}" requires dependency plugin "${dep}", which is not installed.`
          );
        }
      }
    }

    await plugin.install(this, options);

    this.plugins.set(plugin.name, {
      plugin,
      options,
      installedAt: new Date()
    });

    this.events.emit(NexoEvent.PLUGIN_INSTALLED, {
      plugin: plugin.name,
      version: plugin.version
    });

    return this;
  }

  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  getPlugin(name: string): NexoPlugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  getPlugins(): readonly NexoPlugin[] {
    return [...this.plugins.values()].map((r) => r.plugin);
  }

  /* -------------------------------------------------------------------------- */
  /* Lifecycle Hooks                                                            */
  /* -------------------------------------------------------------------------- */

  hook(phase: LifecyclePhase, fn: LifecycleHook): this {
    this.assertModifiable();
    this.lifecycle.add(phase, fn);
    return this;
  }

  onBeforeInit(fn: LifecycleHook): this {
    return this.hook("beforeInit", fn);
  }

  onAfterInit(fn: LifecycleHook): this {
    return this.hook("afterInit", fn);
  }

  onBeforeStart(fn: LifecycleHook): this {
    return this.hook("beforeStart", fn);
  }

  onAfterStart(fn: LifecycleHook): this {
    return this.hook("afterStart", fn);
  }

  onBeforeStop(fn: LifecycleHook): this {
    return this.hook("beforeStop", fn);
  }

  onAfterStop(fn: LifecycleHook): this {
    return this.hook("afterStop", fn);
  }

  /* -------------------------------------------------------------------------- */
  /* Decisions & Constraints                                                    */
  /* -------------------------------------------------------------------------- */

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

  /* -------------------------------------------------------------------------- */
  /* API Dispatch & Authentication                                              */
  /* -------------------------------------------------------------------------- */

  setAuthenticator(authenticator: NexoAuthenticator): this {
    this.authenticator = authenticator;
    return this;
  }

  async dispatch(
    apiName: string,
    request: NexoRequestContext
  ): Promise<unknown> {
    const api = this.getApis().find((item) => item.name === apiName);
    if (!api) {
      throw new NexoConfigurationError(`API "${apiName}" is not registered.`);
    }

    const startTime = Date.now();

    try {
      // 1. Authentication
      if (api.auth?.required) {
        if (!this.authenticator) {
          throw new NexoAuthenticationError(
            `Authentication is required for API "${apiName}", but no authenticator is configured.`
          );
        }
        const authResult: NexoAuthResult = await this.authenticator(request);
        if (!authResult.authenticated) {
          throw new NexoAuthenticationError(
            `Authentication failed for API "${apiName}".`
          );
        }
        if (api.auth.scopes && api.auth.scopes.length > 0) {
          const userScopes = authResult.scopes ?? [];
          const missing = api.auth.scopes.filter((s) => !userScopes.includes(s));
          if (missing.length > 0) {
            throw new NexoAuthenticationError(
              `Missing required scope(s): ${missing.join(", ")}`
            );
          }
        }
      }

      // 2. Validation
      if (api.validate) {
        const validation = await api.validate(request);
        if (!validation.valid) {
          throw new NexoValidationError(
            `Request validation failed for API "${apiName}".`,
            validation.errors ?? []
          );
        }
      }

      // 3. Middleware & Handler Execution
      const result = await this.middleware.execute(request, async (ctx) => {
        if (!api.handler) {
          return undefined;
        }
        return await api.handler(ctx);
      });

      const durationMs = Date.now() - startTime;
      this.events.emit(NexoEvent.API_CALLED, {
        api: api.name,
        method: api.method,
        path: api.path,
        statusCode: 200,
        durationMs
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.events.emit(NexoEvent.API_ERROR, {
        api: api.name,
        method: api.method,
        path: api.path,
        durationMs,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Lifecycle Transitions                                                      */
  /* -------------------------------------------------------------------------- */

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
      await this.lifecycle.run("beforeInit", this);

      for (const module of this.modules.values()) {
        await module.initialize?.();
      }

      await this.lifecycle.run("afterInit", this);

      await this.lifecycle.run("beforeStart", this);

      for (const module of this.modules.values()) {
        await module.start?.();
        if (module.services) {
          for (const service of module.services) {
            await service.onStart?.();
          }
        }
      }

      await this.lifecycle.run("afterStart", this);
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
      await this.lifecycle.run("beforeStop", this);

      for (const module of modules) {
        if (module.services) {
          for (const service of [...module.services].reverse()) {
            await service.onStop?.();
          }
        }
        await module.stop?.();
      }

      await this.lifecycle.run("afterStop", this);
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
        if (module.services) {
          for (const service of [...module.services].reverse()) {
            try {
              await service.onStop?.();
            } catch (serviceErr) {
              errors.push(
                serviceErr instanceof Error ? serviceErr : new Error(String(serviceErr))
              );
            }
          }
        }
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

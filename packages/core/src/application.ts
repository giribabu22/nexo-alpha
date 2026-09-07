import type { NexoModule } from "./module.js";
import type { NexoApi } from "./api.js";
import type { NexoService } from "./service.js";
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
  private readonly config: Readonly<Record<string, unknown>>;

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

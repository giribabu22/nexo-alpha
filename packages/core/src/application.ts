import type { NexoModule } from "./module.js";
import { NexoConfigurationError, NexoLifecycleError } from "./errors.js";

export interface ApplicationOptions {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
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

  private readonly modules = new Map<string, NexoModule>();

  private _state: ApplicationState = "created";

  constructor(options: ApplicationOptions) {
    this.name = options.name;
    this.version = options.version ?? "0.1.0";
    this.description = options.description;
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

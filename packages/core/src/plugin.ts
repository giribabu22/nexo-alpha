import type { NexoApplication } from "./application.js";

export interface NexoPlugin<TOptions = any> {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly dependencies?: readonly string[];
  install(app: NexoApplication, options?: TOptions): Promise<void> | void;
}

export interface InstalledPluginRecord<TOptions = unknown> {
  readonly plugin: NexoPlugin<TOptions>;
  readonly options?: TOptions;
  readonly installedAt: Date;
}

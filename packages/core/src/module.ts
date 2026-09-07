import type { NexoApi } from "./api.js";
import type { NexoService } from "./service.js";
import type { NexoJob } from "./job.js";

export interface NexoModule {
  readonly name: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly status?: string;
  readonly dependencies?: readonly string[];
  readonly apis?: readonly NexoApi[];
  readonly services?: readonly NexoService[];
  readonly events?: readonly string[];
  readonly jobs?: readonly NexoJob[];

  initialize?(): Promise<void> | void;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}

import type { NexoApi } from "./api.js";
import type { NexoService } from "./service.js";
import type { NexoJob } from "./job.js";
import type { NexoMigration } from "./migrations.js";

export interface NexoModule {
  readonly name: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly status?: string;
  readonly dependencies?: readonly string[];
  readonly externalDependencies?: readonly string[];
  readonly apis?: readonly NexoApi[];
  readonly services?: readonly NexoService[];
  readonly events?: readonly string[];
  readonly jobs?: readonly NexoJob[];
  /**
   * Paths (relative to the project root a source-tree scan is run against,
   * POSIX-style — e.g. `"src/orders/order-service.ts"`) of the file(s) that
   * implement this module. Purely declarative, like `dependencies` — Nexo
   * never infers this from naming or content, only reflects what's
   * declared here. Used by `@nexo-alpha/tools`'s `buildKnowledgeGraph()` to
   * link a module node to its file/symbol nodes when a source tree was
   * scanned; a path that isn't found in the scanned tree is simply not
   * linked, not treated as an error.
   */
  readonly sourceFiles?: readonly string[];
  /**
   * Migrations for the collections this module owns, shipped by the package
   * that provides it (e.g. sign-in accounts). Ids start "nexo:". Runners
   * collect them from the app's modules and run them before the app's own;
   * apps can't pass, edit or reorder them.
   */
  readonly migrations?: readonly NexoMigration[];

  initialize?(): Promise<void> | void;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}

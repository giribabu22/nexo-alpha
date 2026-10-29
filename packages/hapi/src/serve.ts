/**
 * The short path to a running app: models in, HTTP server out.
 *
 * ```ts
 * import { serve } from "@nexo-alpha/hapi";
 * import { Task } from "./tasks/task.model.js";
 *
 * const app = await serve({ resources: [Task] });
 * // SQLite at data/app.db, GET/POST /api/tasks, GET/PATCH/DELETE /api/tasks/:id,
 * // on port 3000 (or $PORT); Ctrl+C stops it cleanly.
 * await app.resource(Task).create({ title: "Seed data from server code" });
 * ```
 *
 * It only wires the existing primitives (`createApplication`, a document
 * store, `resource`, `createAuth`, `createFiles`, `startHapiServer`), so
 * anything it does can be done by hand, and each piece can be replaced: pass
 * a `store`, an `app`, ready-made `modules`, or a `(store) => resource(…)`
 * function for a resource with options.
 *
 * With `migrations`, pending ones are applied before the app starts; if one
 * fails, nothing listens (docs/architecture/migrations-design.md §8).
 */

import type Hapi from "@hapi/hapi";
import {
  NexoConfigurationError,
  NexoMigrationError,
  createApplication,
  createAuth,
  createDiskBlobStore,
  createFileDocumentStore,
  createFiles,
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  isResource,
  migrationStatus,
  resource,
  runMigrations,
  type CreateAuthOptions,
  type CreateFilesOptions,
  type MigrationRunOptions,
  type NexoApplication,
  type NexoAuth,
  type NexoBlobStore,
  type NexoDocumentStore,
  type NexoFiles,
  type NexoMigration,
  type NexoModel,
  type NexoModule,
  type NexoResource,
  type RunMigrationsResult
} from "@nexo-alpha/core";
import { startHapiServer, type CreateHapiServerOptions } from "./create-server.js";

/** A model (served with default options) or a function that builds a module, usually `resource()`, on the store. */
export type ServeResource = NexoModel | ((store: NexoDocumentStore) => NexoModule);

export type ServeAuthOptions = Omit<CreateAuthOptions, "store" | "secret"> & {
  /** Signs session tokens, at least 32 bytes. Default: `process.env.AUTH_SECRET` */
  readonly secret?: string;
};

export type ServeFilesOptions = Omit<CreateFilesOptions, "store" | "blobs"> & {
  /** Where file contents go. Default: a disk store in `directory` */
  readonly blobs?: NexoBlobStore;
  /** Default: "data/files" */
  readonly directory?: string;
};

export type ServeMigrationsOptions = MigrationRunOptions & {
  readonly list: readonly NexoMigration[];
  /**
   * Apply pending migrations before starting. Default: true. With false,
   * `serve()` only checks, and refuses to start while any are pending (for
   * teams that run `nexo migrate up` in their deploy pipeline).
   */
  readonly auto?: boolean;
};

export interface ServeOptions extends CreateHapiServerOptions {
  /** Default: "nexo-app". Ignored when `app` is given. */
  readonly name?: string;
  /**
   * Where records are stored: a store, or a path. A path ending in `.json` is
   * a JSON file store; any other path (or ":memory:") is SQLite, which needs
   * Node.js 22.5 or later. Default: "data/app.db", or an in-memory store
   * when there are no `resources`, `auth` or `files`, so no file is created.
   */
  readonly store?: NexoDocumentStore | string;
  /** Served at `/api/<model name>`, in this order. */
  readonly resources?: readonly ServeResource[];
  /** Any other modules: hand-written APIs, jobs, integrations. */
  readonly modules?: readonly NexoModule[];
  /** Accounts at /api/auth (`createAuth`); also authenticates resources with `auth`. */
  readonly auth?: true | ServeAuthOptions;
  /** Uploads at /api/files (`createFiles`), for models with `field.file()`. */
  readonly files?: true | ServeFilesOptions;
  /** An application to add the modules to, instead of a new one. It must not be started yet. */
  readonly app?: NexoApplication;
  /** Stop cleanly and exit on SIGINT (Ctrl+C) and SIGTERM. Default: true */
  readonly handleSignals?: boolean;
  /**
   * Migrations for `store`, applied before the app starts: a list, or
   * `{ list, auto, allowDestructive, production, maxChanges }`. In production
   * (`NODE_ENV=production`), destructive ones run only if their id is in
   * `allowDestructive`. If any fails, `serve()` rejects and nothing listens.
   */
  readonly migrations?: readonly NexoMigration[] | ServeMigrationsOptions;
}

export interface NexoServedApp {
  readonly app: NexoApplication;
  readonly server: Hapi.Server;
  readonly store: NexoDocumentStore;
  /** Present when `auth` was set. */
  readonly auth: NexoAuth | undefined;
  /** Present when `files` was set. */
  readonly files: NexoFiles | undefined;
  /** What `migrations` applied at start; undefined without `migrations`. */
  readonly migrations: RunMigrationsResult | undefined;
  /** e.g. "http://localhost:3000" */
  readonly url: string;
  /** The served resource for `model`, for calls from server code. Throws if the model isn't served. */
  resource<M extends NexoModel>(model: M): NexoResource<M>;
  /** Stops the server and the application, then closes the store if `serve()` opened it. */
  stop(): Promise<void>;
}

async function openStore(location: string): Promise<NexoDocumentStore> {
  if (location.endsWith(".json")) return createFileDocumentStore(location);
  try {
    return await createSqliteDocumentStore(location);
  } catch (error) {
    if (!(error instanceof NexoConfigurationError)) throw error;
    throw new NexoConfigurationError(`${error.message} Pass store: "data/app.json" to use a JSON file instead.`);
  }
}

export async function serve(options: ServeOptions = {}): Promise<NexoServedApp> {
  const {
    name, store: storeOption, resources = [], modules = [], auth: authOption, files: filesOption,
    app: appOption, handleSignals = true, migrations: migrationsOption, ...serverOptions
  } = options;

  const app = appOption ?? createApplication({ name: name ?? "nexo-app" });
  // With nothing to store (e.g. an `app` whose resources have their own store), no database file is created.
  const needsStore = resources.length > 0 || authOption !== undefined || filesOption !== undefined || migrationsOption !== undefined;
  const ownsStore = typeof storeOption !== "object";
  const store = typeof storeOption === "object"
    ? storeOption
    : storeOption === undefined && !needsStore
      ? createInMemoryDocumentStore()
      : await openStore(storeOption ?? "data/app.db");

  let server: Hapi.Server | undefined;
  try {
    const log = (message: string, fields: Record<string, unknown>): void => {
      if (serverOptions.logging === false) return;
      if (serverOptions.logger !== undefined) serverOptions.logger.info(message, fields);
      else if (process.env.NODE_ENV !== "test") console.log(`${message} ${JSON.stringify(fields)}`);
    };
    let migrations: RunMigrationsResult | undefined;
    if (migrationsOption !== undefined) {
      const { list, auto = true, ...runOptions }: ServeMigrationsOptions = Array.isArray(migrationsOption)
        ? { list: migrationsOption as readonly NexoMigration[] }
        : (migrationsOption as ServeMigrationsOptions);
      if (auto) {
        migrations = await runMigrations(store, list, runOptions);
        for (const applied of migrations.applied) log("migration applied", { ...applied });
      } else {
        const { pending } = await migrationStatus(store, list);
        if (pending.length > 0) {
          throw new NexoMigrationError(
            `serve(): ${pending.length} migration${pending.length === 1 ? " is" : "s are"} pending (${pending.map((m) => m.id).join(", ")}) ` +
              "and migrations.auto is false. Run nexo migrate up first."
          );
        }
      }
    }

    let auth: NexoAuth | undefined;
    if (authOption !== undefined) {
      const { secret = process.env.AUTH_SECRET, ...rest } = authOption === true ? {} : authOption;
      if (secret === undefined || secret === "") {
        throw new NexoConfigurationError("serve(): auth needs a secret: set AUTH_SECRET (at least 32 bytes) or pass auth: { secret }.");
      }
      auth = createAuth({ ...rest, store, secret });
      app.module(auth);
    }

    let files: NexoFiles | undefined;
    if (filesOption !== undefined) {
      const { blobs, directory = "data/files", ...rest } = filesOption === true ? {} : filesOption;
      files = createFiles({ ...rest, store, blobs: blobs ?? createDiskBlobStore(directory) });
      app.module(files);
    }

    for (const entry of resources) {
      app.module(typeof entry === "function" ? entry(store) : resource(entry, { store }));
    }
    for (const module of modules) app.module(module);

    const served = new Map<NexoModel, NexoResource<NexoModel>>();
    for (const module of app.getModules()) {
      if (isResource(module)) served.set(module.model, module);
    }

    await app.start();
    server = await startHapiServer(app, {
      ...serverOptions,
      port: serverOptions.port ?? (Number(process.env.PORT) || 3000),
      ...(serverOptions.authenticate === undefined && auth !== undefined ? { authenticate: auth.authenticate } : {})
    });
    const running = server;

    let stopping: Promise<void> | undefined;
    const onSignal = (): void => {
      void stop().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error("serve(): stopping failed:", error);
          process.exit(1);
        }
      );
    };
    const stop = (): Promise<void> => {
      stopping ??= (async () => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        await running.stop({ timeout: 5000 });
        await app.stop();
        if (ownsStore) await store.close();
      })();
      return stopping;
    };
    if (handleSignals) {
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    }

    const url = running.info.uri;
    if (serverOptions.logging !== false) {
      if (serverOptions.logger !== undefined) serverOptions.logger.info("app ready", { name: app.name, url });
      else if (process.env.NODE_ENV !== "test") console.log(`${app.name} ready at ${url}`);
    }

    return {
      app,
      server: running,
      store,
      auth,
      files,
      migrations,
      url,
      resource<M extends NexoModel>(model: M): NexoResource<M> {
        const found = served.get(model);
        if (found === undefined) {
          throw new NexoConfigurationError(`serve(): model "${model.name}" is not served; add it to resources.`);
        }
        return found as unknown as NexoResource<M>;
      },
      stop
    };
  } catch (error) {
    // Undo what started, so a failed start (e.g. the port is taken) leaves nothing open.
    try { await server?.stop(); } catch { /* best effort */ }
    if (app.state === "running") {
      try { await app.stop(); } catch { /* best effort */ }
    }
    if (ownsStore) {
      try { await store.close(); } catch { /* best effort */ }
    }
    throw error;
  }
}

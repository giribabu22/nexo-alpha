/**
 * Resources: a model's records with CRUD behavior and a REST API, from one
 * call. A resource is a `NexoModule`, so `app.module(users)` serves it, and
 * server code calls the same operations directly:
 *
 * ```ts
 * export const users = resource(User, { store, searchable: ["name", "email"] });
 * app.module(users);                       // GET/POST /api/users, GET/PATCH/DELETE /api/users/:id
 * await users.create({ name: "Ann", email: "ann@example.com" });
 * const { items, total } = await users.list({ where: { role: "admin" }, sort: "-createdAt" });
 * ```
 *
 * Every write validates against the model (unknown fields are rejected),
 * checks that `ref` fields point at existing records, and stamps `id`,
 * `createdAt` and `updatedAt`. Updates use compare-and-swap, so concurrent
 * updates to the same record never overwrite each other silently: they are
 * retried, and answered with 409 if the record keeps changing.
 *
 * Listing runs in the store when it can (`store.query`: the SQLite store
 * filters, sorts and pages in SQL); other stores load the collection and do
 * it in memory, which is fine for thousands of records. Results are the same
 * either way.
 */

import { httpResponse, type NexoApi, type NexoApiAuth, type NexoRequestContext } from "./api.js";
import type { NexoModule } from "./module.js";
import type { NexoDocumentStore } from "./storage.js";
import { queryDocuments, type DocumentQuery, type DocumentScalar } from "./document-query.js";
import { mimeMatches } from "./files-contract.js";
import { attachFile, detachFile } from "./file-attachments.js";
import { NexoConfigurationError, NexoHttpError, NexoValidationError } from "./errors.js";
import type { FieldName, Infer, InferInput, InferPatch, NexoModel } from "./model.js";
import {
  LIST_PARAMS,
  decodeListQuery,
  resourcePath,
  type ResourceListQuery,
  type ResourceListResult
} from "./resource-contract.js";

export type ResourceOperation = "list" | "get" | "create" | "update" | "delete";

export const RESOURCE_OPERATIONS: readonly ResourceOperation[] = ["list", "get", "create", "update", "delete"];

/**
 * Scopes required to read (`list`, `get`) and to write (`create`, `update`,
 * `delete`). A scope list for one operation replaces its group's, e.g.
 * `{ write: ["notes:write"], delete: ["notes:admin"] }`.
 */
export interface ResourceAuth {
  readonly read?: readonly string[];
  readonly write?: readonly string[];
  readonly list?: readonly string[];
  readonly get?: readonly string[];
  readonly create?: readonly string[];
  readonly update?: readonly string[];
  readonly delete?: readonly string[];
}

/** A stored change, passed to `onChange`. */
export interface ResourceChange<M extends NexoModel> {
  readonly operation: "create" | "update" | "delete";
  /** The record as stored (for `delete`, as it was). */
  readonly record: Infer<M>;
  /** The record before an update; undefined otherwise. */
  readonly previous: Infer<M> | undefined;
  /** The HTTP request, when the change came through the API. */
  readonly request: NexoRequestContext | undefined;
}

export interface ResourceWriteInfo<M extends NexoModel> {
  readonly operation: "create" | "update";
  /** The record before an update; undefined on create. */
  readonly existing: Infer<M> | undefined;
  /** The HTTP request, when the write came through the API; undefined for direct calls. */
  readonly request: NexoRequestContext | undefined;
}

export interface ResourceOptions<M extends NexoModel> {
  /** Where records are stored. Wrap with `scopeByProject()` for per-tenant data. */
  readonly store: NexoDocumentStore;
  /** API path. Default: `/api/<model name>`. A frontend client must then use the same path. */
  readonly path?: string;
  readonly description?: string;
  /**
   * `true`: every route needs an authenticated caller. `{ read, write }`:
   * routes in that group need those scopes; a group left out is public.
   * Requires `createHapiServer({ authenticate })`. Direct calls are not checked.
   */
  readonly auth?: boolean | ResourceAuth;
  /** Fields that `list({ search })` matches against (case-insensitive substring). */
  readonly searchable?: readonly FieldName<M>[];
  /**
   * Fields often used in `where` filters, indexed by stores that support it
   * (SQLite) so those lists stay fast on large collections.
   * Default: the model's `ref` fields (e.g. `customerId`).
   */
  readonly indexes?: readonly FieldName<M>[];
  /** Operations served over HTTP. Default: all five. Direct calls are always available. */
  readonly expose?: readonly ResourceOperation[];
  /** Default page size. Default: 50 */
  readonly defaultLimit?: number;
  /** Largest page size a caller may request. Default: 200 */
  readonly maxLimit?: number;
  /**
   * Runs before every create and update with the complete record about to be
   * stored; return it (possibly changed). Use it for computed fields and
   * rules — throw `NexoHttpError(403, …)` to refuse. The result is validated
   * again; `id` and `createdAt` cannot be changed.
   */
  readonly beforeWrite?: (record: Infer<M>, info: ResourceWriteInfo<M>) => Infer<M> | Promise<Infer<M>>;
  /**
   * Runs after every create, update and delete is stored — for webhooks,
   * audit logs, notifications or cache invalidation. It is awaited: if it
   * throws, the caller gets the error, but the change stays stored, so
   * catch errors you want to tolerate (e.g. a webhook being down).
   */
  readonly onChange?: (change: ResourceChange<M>) => void | Promise<void>;
}

export interface NexoResource<M extends NexoModel> extends NexoModule {
  readonly model: M;
  /** The API path, e.g. `/api/users`. */
  readonly path: string;
  readonly apis: readonly NexoApi[];
  list(query?: ResourceListQuery<M>): Promise<ResourceListResult<Infer<M>>>;
  /** Throws NexoHttpError 404 if there is no such record. */
  get(id: string): Promise<Infer<M>>;
  create(input: InferInput<M>): Promise<Infer<M>>;
  /** Changes only the fields given; `null` clears an optional field. Throws 404 if missing. */
  update(id: string, patch: InferPatch<M>): Promise<Infer<M>>;
  /** Throws NexoHttpError 404 if there is no such record. */
  delete(id: string): Promise<void>;
}

const MAX_UPDATE_ATTEMPTS = 5;
/** Thrown inside a write to mean "the record changed meanwhile; try again" (and undo file claims). */
const RETRY = Symbol("retry");

const SEARCHABLE_KINDS = new Set(["string", "text", "email", "enum", "date", "ref"]);

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function resource<M extends NexoModel>(model: M, options: ResourceOptions<M>): NexoResource<M> {
  const name = model.name;
  const path = (options.path ?? resourcePath(model)).replace(/\/+$/, "");
  const store = options.store;
  const searchable: readonly string[] = options.searchable ?? [];
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;
  const expose = new Set(options.expose ?? RESOURCE_OPERATIONS);

  for (const key of Object.keys(model.fields)) {
    if (LIST_PARAMS.includes(key)) {
      throw new NexoConfigurationError(
        `Model "${name}" has a field named "${key}", which resource() reserves for list queries (${LIST_PARAMS.join(", ")}). Rename the field.`
      );
    }
  }
  for (const key of searchable) {
    const searchField = model.fields[key];
    if (searchField === undefined) {
      throw new NexoConfigurationError(`resource("${name}"): searchable field "${key}" is not a field of the model.`);
    }
    if (!SEARCHABLE_KINDS.has(searchField.kind)) {
      throw new NexoConfigurationError(`resource("${name}"): searchable field "${key}" must hold text, not ${searchField.kind}.`);
    }
  }
  if (!path.startsWith("/")) {
    throw new NexoConfigurationError(`resource("${name}"): path must start with "/", got "${path}".`);
  }

  const refFields = Object.entries(model.fields).filter(([, f]) => f.ref !== undefined);
  const fileFields = Object.entries(model.fields)
    .filter(([, f]) => f.kind === "file" || (f.kind === "array" && f.item?.kind === "file"))
    .map(([key]) => key);

  /** The uploaded files a record references. */
  function fileIds(record: Record<string, unknown> | undefined): Set<string> {
    const ids = new Set<string>();
    for (const key of fileFields) {
      const value = record?.[key];
      for (const id of Array.isArray(value) ? value : [value]) if (typeof id === "string") ids.add(id);
    }
    return ids;
  }
  const ownerOf = (id: unknown): string => `${name}/${String(id)}`;

  /**
   * Claims `added` files for the record before it is stored, so a crash can only
   * leave a file claimed, never remove one that is in use. Claims are undone if
   * the write then fails.
   */
  async function claimFiles<T>(owner: string, added: Iterable<string>, write: () => Promise<T>): Promise<T> {
    const claimed: string[] = [];
    try {
      for (const id of added) {
        await attachFile(store, id, owner);
        claimed.push(id);
      }
      return await write();
    } catch (error) {
      await Promise.all(claimed.map((id) => detachFile(store, id, owner).catch(() => undefined)));
      throw error;
    }
  }
  const indexed: readonly string[] = options.indexes
    ?? refFields.filter(([, f]) => f.kind === "ref" || f.kind === "file").map(([key]) => key);
  for (const key of indexed) {
    if (model.fields[key] === undefined) {
      throw new NexoConfigurationError(`resource("${name}"): indexed field "${key}" is not a field of the model.`);
    }
  }
  // Created on first use, once.
  let indexing: Promise<unknown> | undefined;

  // So records stored before a defaulted field existed still match filters and sort by it.
  const defaults = Object.fromEntries(
    Object.entries(model.fields)
      .filter(([, f]) => f.presence === "defaulted" && ["string", "number", "boolean"].includes(typeof f.defaultValue))
      .map(([key, f]) => [key, f.defaultValue])
  );

  function notFound(id: string): NexoHttpError {
    return new NexoHttpError(404, "NOT_FOUND", `${name} "${id}" not found.`);
  }

  /** Checks that ref fields point at existing records; on update, only refs that changed. */
  async function checkRefs(values: Record<string, unknown>, previous?: Record<string, unknown>): Promise<void> {
    const errors: string[] = [];
    for (const [key, f] of refFields) {
      const value = values[key];
      if (value === undefined || value === null) continue;
      if (previous !== undefined && JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
      const ids = Array.isArray(value) ? value : [value];
      for (const id of ids) {
        const target = await store.get<{ type?: string }>(f.ref!, String(id));
        if (target === undefined) {
          errors.push(`Field "body.${key}" references a missing ${f.ref} record "${String(id)}".`);
        } else if (f.kind === "file" && f.accept !== undefined && !mimeMatches(target.type ?? "", f.accept)) {
          errors.push(`Field "body.${key}" must be a file of type ${f.accept.join(" or ")}, got ${target.type ?? "unknown"}.`);
        }
      }
    }
    if (errors.length > 0) throw new NexoValidationError(`Invalid ${name}: ${errors.join("; ")}`, errors);
  }

  /** Runs beforeWrite and re-validates its result, keeping the system fields intact. */
  async function finalize(
    record: Record<string, unknown>,
    info: ResourceWriteInfo<M>
  ): Promise<Record<string, unknown>> {
    if (options.beforeWrite === undefined) return record;
    const changed = { ...(await options.beforeWrite(record as Infer<M>, info)) } as Record<string, unknown>;
    changed.id = record.id;
    changed.createdAt = record.createdAt;
    changed.updatedAt = record.updatedAt;
    const outcome = model.validate(changed);
    if (!outcome.valid) {
      const errors = outcome.errors ?? [];
      throw new NexoValidationError(`beforeWrite produced an invalid ${name}: ${errors.join("; ")}`, errors);
    }
    return changed;
  }

  async function list(query: ResourceListQuery<M> = {}): Promise<ResourceListResult<Infer<M>>> {
    const limit = Math.min(query.limit ?? defaultLimit, maxLimit);
    const offset = query.offset ?? 0;

    const search = query.search?.trim();
    if (search !== undefined && search !== "" && searchable.length === 0) {
      throw new NexoValidationError(`Resource "${name}" has no searchable fields.`, [
        `Field "query.search" is not supported: resource("${name}") declares no searchable fields.`
      ]);
    }
    const where = Object.fromEntries(
      Object.entries(query.where ?? {}).filter(([, value]) => value !== undefined && value !== null)
    ) as Record<string, DocumentScalar>;

    const documentQuery: DocumentQuery = {
      where,
      ...(search !== undefined && search !== "" ? { search: { text: search, fields: searchable } } : {}),
      ...(query.sort !== undefined
        ? { sort: { field: query.sort.replace(/^-/, ""), descending: query.sort.startsWith("-") } }
        : {}),
      limit,
      offset,
      defaults
    };
    if (store.index !== undefined && indexed.length > 0) {
      indexing ??= Promise.all(
        indexed.map((key) => store.index!(name, key, defaults[key] !== undefined ? { default: defaults[key] as DocumentScalar } : {}))
      ).catch((error: unknown) => {
        indexing = undefined; // try again next time
        throw error;
      });
      await indexing;
    }
    const result = store.query !== undefined
      ? await store.query(name, documentQuery)
      : queryDocuments(await store.list(name), documentQuery);

    return {
      items: result.items.map((document) => model.hydrate(document)) as Infer<M>[],
      total: result.total,
      limit,
      offset
    };
  }

  async function get(id: string): Promise<Infer<M>> {
    const document = await store.get(name, id);
    if (document === undefined) throw notFound(id);
    return model.hydrate(document) as Infer<M>;
  }

  async function create(input: unknown, request?: NexoRequestContext): Promise<Infer<M>> {
    const values = model.parse(input);
    const now = new Date().toISOString();
    const record = await finalize(
      { id: newId(), ...values, createdAt: now, updatedAt: now },
      { operation: "create", existing: undefined, request }
    );
    await checkRefs(record);
    await claimFiles(ownerOf(record.id), fileIds(record), () => store.put(name, record.id as string, record));
    await options.onChange?.({ operation: "create", record: record as Infer<M>, previous: undefined, request });
    return record as Infer<M>;
  }

  async function update(id: string, patch: unknown, request?: NexoRequestContext): Promise<Infer<M>> {
    const changes = model.parsePatch(patch);
    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
      const current = await store.get<Record<string, unknown>>(name, id);
      if (current === undefined) throw notFound(id);

      const existing = model.hydrate(current) as Infer<M>;
      const merged: Record<string, unknown> = { ...existing, ...changes, updatedAt: new Date().toISOString() };
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete merged[key];
      }
      const next = await finalize(merged, { operation: "update", existing, request });
      await checkRefs(next, existing as Record<string, unknown>);
      const before = fileIds(existing as Record<string, unknown>);
      const after = fileIds(next);
      const stored = await claimFiles(ownerOf(id), [...after].filter((f) => !before.has(f)), async () => {
        if (await store.replaceIf(name, id, current, next)) return true;
        throw RETRY;
      }).catch((error: unknown) => {
        if (error === RETRY) return false;
        throw error;
      });
      if (stored) {
        for (const file of before) if (!after.has(file)) await detachFile(store, file, ownerOf(id));
        await options.onChange?.({ operation: "update", record: next as Infer<M>, previous: existing, request });
        return next as Infer<M>;
      }
    }
    throw new NexoHttpError(409, "CONFLICT", `${name} "${id}" kept changing while being updated; try again.`);
  }

  async function remove(id: string, request?: NexoRequestContext): Promise<void> {
    const existing = options.onChange === undefined && fileFields.length === 0
      ? undefined
      : await store.get<Record<string, unknown>>(name, id);
    if (!(await store.delete(name, id))) throw notFound(id);
    for (const file of fileIds(existing)) await detachFile(store, file, ownerOf(id));
    if (options.onChange !== undefined && existing !== undefined) {
      await options.onChange({ operation: "delete", record: model.hydrate(existing) as Infer<M>, previous: undefined, request });
    }
  }

  function authFor(operation: ResourceOperation): NexoApiAuth | undefined {
    if (options.auth === undefined || options.auth === false) return undefined;
    if (options.auth === true) return { required: true };
    const group = operation === "list" || operation === "get" ? "read" : "write";
    const scopes = options.auth[operation] ?? options.auth[group];
    return scopes === undefined ? undefined : { required: true, scopes };
  }

  const idParam = { id: { type: "string" as const, required: true } };
  const withAuth = (auth: NexoApiAuth | undefined) => (auth === undefined ? {} : { auth });

  const routes: Record<ResourceOperation, NexoApi> = {
    list: {
      name: `${name}.list`,
      method: "GET",
      path,
      description: `List ${name}. Query: limit, offset, sort (field or -field), ${searchable.length > 0 ? "search, " : ""}and <field>=<value> filters.`,
      ...withAuth(authFor("list")),
      schema: {
        response: {
          type: "object",
          properties: {
            items: { type: "array", items: model.recordSchema },
            total: { type: "number" },
            limit: { type: "number" },
            offset: { type: "number" }
          }
        }
      },
      handler: (context) => list(decodeListQuery(model, context.query) as ResourceListQuery<M>)
    },
    get: {
      name: `${name}.get`,
      method: "GET",
      path: `${path}/:id`,
      description: `Get one ${name} record by id.`,
      ...withAuth(authFor("get")),
      schema: { params: idParam, response: model.recordSchema },
      handler: (context) => get(context.params.id!)
    },
    create: {
      name: `${name}.create`,
      method: "POST",
      path,
      description: `Create a ${name} record.`,
      ...withAuth(authFor("create")),
      schema: { body: model.schema, response: model.recordSchema },
      // The model's own check, so one 400 lists every problem (unknown fields too), worded as in the browser.
      validate: (context) => model.validate(context.payload ?? {}),
      handler: async (context) => {
        const record = await create(context.payload ?? {}, context);
        return httpResponse(201, record, { location: `${path}/${record.id}` });
      }
    },
    update: {
      name: `${name}.update`,
      method: "PATCH",
      path: `${path}/:id`,
      description: `Change some fields of a ${name} record; null clears an optional field.`,
      ...withAuth(authFor("update")),
      schema: { params: idParam, body: model.patchSchema, response: model.recordSchema },
      validate: (context) => model.validate(context.payload ?? {}, { partial: true }),
      handler: (context) => update(context.params.id!, context.payload ?? {}, context)
    },
    delete: {
      name: `${name}.delete`,
      method: "DELETE",
      path: `${path}/:id`,
      description: `Delete a ${name} record.`,
      ...withAuth(authFor("delete")),
      schema: { params: idParam },
      handler: async (context) => {
        await remove(context.params.id!, context);
        return undefined;
      }
    }
  };

  return {
    name,
    description: options.description ?? `CRUD API for ${name}.`,
    purpose: `Stores ${name} records and serves them at ${path}.`,
    apis: RESOURCE_OPERATIONS.filter((operation) => expose.has(operation)).map((operation) => routes[operation]),
    model,
    path,
    list,
    get,
    create: (input) => create(input),
    update: (id, patch) => update(id, patch),
    delete: remove
  };
}

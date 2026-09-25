/**
 * HTTP API for {@link AgentMemory}, as a plain `@nexo-alpha/core` module:
 *
 * ```
 * GET    /memory?text=&tags=a,b&scope=&limit=   → { entries }   (recall)
 * GET    /memory/:key                           → entry (404 if unknown)
 * PUT    /memory/:key   { value, tags?, scope? } → entry
 * DELETE /memory/:key                           → 204 (404 if unknown)
 * ```
 *
 * Writes change what agents recall in later runs, so protect them: use
 * `auth` for all routes and `writeAuth` to require extra scopes for
 * PUT/DELETE.
 */

import {
  NexoHttpError,
  type NexoApi,
  type NexoApiAuth,
  type NexoModule,
  type NexoRequestContext
} from "@nexo-alpha/core";
import type { AgentMemory, RecallQuery } from "./memory.js";

export interface MemoryApiOptions {
  readonly memory: AgentMemory;
  /** Module name. Default: "memory" */
  readonly name?: string | undefined;
  /** Route prefix. Default: "/memory" */
  readonly basePath?: string | undefined;
  /** Auth for read routes (and write routes unless `writeAuth` is set). */
  readonly auth?: NexoApiAuth | undefined;
  /** Auth for PUT/DELETE. Default: `auth` */
  readonly writeAuth?: NexoApiAuth | undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.split(",").map((item) => item.trim()).filter((item) => item !== "");
}

function queryString(context: NexoRequestContext, name: string): string | undefined {
  const value = context.query[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function createMemoryApiModule(options: MemoryApiOptions): NexoModule {
  const { memory } = options;
  const basePath = (options.basePath ?? "/memory").replace(/\/+$/, "");
  const readAuth = options.auth !== undefined ? { auth: options.auth } : {};
  const writeAuthValue = options.writeAuth ?? options.auth;
  const writeAuth = writeAuthValue !== undefined ? { auth: writeAuthValue } : {};

  function key(context: NexoRequestContext): string {
    return context.params.key ?? "";
  }

  const apis: NexoApi[] = [
    {
      name: "recallMemory",
      method: "GET",
      path: basePath,
      description: "Recalls memory entries by text, tags, scope and limit.",
      ...readAuth,
      schema: {
        query: {
          text: { type: "string" },
          tags: { type: "string", description: "Comma-separated; every tag must match." },
          scope: { type: "string" },
          limit: { type: "number" }
        }
      },
      validate: (context) => {
        const limit = queryString(context, "limit");
        return limit === undefined || /^[1-9]\d*$/.test(limit)
          ? { valid: true }
          : { valid: false, errors: ['"limit" must be a positive integer.'] };
      },
      handler: async (context) => {
        const text = queryString(context, "text");
        const tags = stringList(context.query.tags);
        const scope = queryString(context, "scope");
        const limit = queryString(context, "limit");
        const query: RecallQuery = {
          ...(text !== undefined ? { text } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(scope !== undefined ? { scope } : {}),
          ...(limit !== undefined ? { limit: Number(limit) } : {})
        };
        return { entries: await memory.recall(query) };
      }
    },
    {
      name: "getMemoryEntry",
      method: "GET",
      path: `${basePath}/:key`,
      description: "Returns one memory entry.",
      ...readAuth,
      handler: async (context) => {
        const entry = await memory.get(key(context));
        if (entry === undefined) {
          throw new NexoHttpError(404, "MEMORY_NOT_FOUND", `Memory entry "${key(context)}" not found.`);
        }
        return entry;
      }
    },
    {
      name: "putMemoryEntry",
      method: "PUT",
      path: `${basePath}/:key`,
      description: "Stores a value under a key, replacing any previous value.",
      ...writeAuth,
      schema: {
        body: {
          type: "object",
          properties: {
            value: { type: "object", required: true, description: "Any JSON value." },
            tags: { type: "array", items: { type: "string" } },
            scope: { type: "string" }
          }
        }
      },
      validate: (context) => {
        const body = context.payload as Record<string, unknown> | null | undefined;
        const errors: string[] = [];
        if (typeof body !== "object" || body === null || !("value" in body) || body.value === undefined) {
          errors.push('"value" is required.');
        } else {
          if (body.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every((tag) => typeof tag === "string"))) {
            errors.push('"tags" must be an array of strings.');
          }
          if (body.scope !== undefined && typeof body.scope !== "string") errors.push('"scope" must be a string.');
        }
        return errors.length > 0 ? { valid: false, errors } : { valid: true };
      },
      handler: async (context) => {
        const body = context.payload as { value: unknown; tags?: string[]; scope?: string };
        return memory.remember(key(context), body.value, {
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
          ...(body.scope !== undefined ? { scope: body.scope } : {})
        });
      }
    },
    {
      name: "deleteMemoryEntry",
      method: "DELETE",
      path: `${basePath}/:key`,
      description: "Forgets a memory entry.",
      ...writeAuth,
      handler: async (context) => {
        if (!(await memory.forget(key(context)))) {
          throw new NexoHttpError(404, "MEMORY_NOT_FOUND", `Memory entry "${key(context)}" not found.`);
        }
        return undefined;
      }
    }
  ];

  return {
    name: options.name ?? "memory",
    description: "HTTP API for browsing and editing agent memory.",
    apis
  };
}

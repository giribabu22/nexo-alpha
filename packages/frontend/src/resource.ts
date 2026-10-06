/**
 * Typed client for a server `resource()`, driven by the same model:
 *
 * ```ts
 * const users = client.resource(User);          // User from a shared model file
 * const { items } = await users.list({ where: { role: "admin" } });
 * const ann = await users.create({ name: "Ann", email: "ann@example.com" });
 * ```
 *
 * Input is validated against the model before any request is sent; a
 * failure throws the same `NexoApiError` (status 400, `payload.errors`) the
 * server would answer with. Every successful write notifies `onChange`
 * listeners, which is how `useResource` lists refresh after a form saves.
 * The operations are arrow functions, so they can be passed as callbacks.
 */

import {
  encodeListQuery,
  resourcePath,
  type Infer,
  type InferInput,
  type InferPatch,
  type NexoModel,
  type ResourceListQuery,
  type ResourceListResult
} from "@nexo-alpha/core/model";
import { NexoApiError, type NexoClient } from "./client.js";

export interface NexoResourceClientOptions {
  /** API path, if the server's `resource()` was given a custom `path`. Default: `/api/<model name>` */
  readonly path?: string | undefined;
}

export class NexoResourceClient<M extends NexoModel> {
  readonly model: M;
  readonly path: string;
  private readonly client: NexoClient;
  private readonly listeners = new Set<() => void>();

  constructor(client: NexoClient, model: M, options: NexoResourceClientOptions = {}) {
    this.client = client;
    this.model = model;
    this.path = (options.path ?? resourcePath(model)).replace(/\/+$/, "");
  }

  readonly list = (query: ResourceListQuery<M> = {}): Promise<ResourceListResult<Infer<M>>> => {
    const params = new URLSearchParams(encodeListQuery(query as ResourceListQuery)).toString();
    return this.client.get(params === "" ? this.path : `${this.path}?${params}`);
  };

  /** Rejects with NexoApiError 404 if there is no such record. */
  readonly get = (id: string): Promise<Infer<M>> => this.client.get(this.recordPath(id));

  readonly create = async (input: InferInput<M>): Promise<Infer<M>> => {
    this.check(input, false);
    const record = await this.client.post<Infer<M>>(this.path, input);
    this.notify();
    return record;
  };

  /** Changes only the fields given; `null` clears an optional field. */
  readonly update = async (id: string, patch: InferPatch<M>): Promise<Infer<M>> => {
    this.check(patch, true);
    const record = await this.client.patch<Infer<M>>(this.recordPath(id), patch);
    this.notify();
    return record;
  };

  readonly delete = async (id: string): Promise<void> => {
    await this.client.delete(this.recordPath(id));
    this.notify();
  };

  /** Called after every successful create, update or delete through this client. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private recordPath(id: string): string {
    return `${this.path}/${encodeURIComponent(id)}`;
  }

  private check(input: unknown, partial: boolean): void {
    const outcome = this.model.validate(input, { partial });
    if (!outcome.valid) {
      const errors = outcome.errors ?? [];
      throw new NexoApiError("Validation failed", 400, { error: "Validation failed", errors });
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

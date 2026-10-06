/**
 * React hooks for server `resource()`s. Lists and records refresh by
 * themselves after any create, update or delete made through the same
 * client — a form anywhere on the page updates every table showing that model.
 *
 * ```tsx
 * const users = useResource(User, { sort: "name" });
 * if (users.error) return <NexoErrorState error={users.error} onRetry={users.refetch} />;
 * return <NexoTable model={User} rows={users.items} loading={users.loading} />;
 * ```
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  Infer,
  InferInput,
  InferPatch,
  NexoModel,
  ResourceListQuery,
  ResourceListResult
} from "@nexo-alpha/core/model";
import { useNexoClient } from "./context.js";
import { createQuery, type NexoQueryState } from "./query.js";
import type { NexoResourceClient, NexoResourceClientOptions } from "./resource.js";

/** The client's typed resource client for `model` (shared by every hook using the same model). */
export function useResourceClient<M extends NexoModel>(model: M, options: NexoResourceClientOptions = {}): NexoResourceClient<M> {
  const client = useNexoClient();
  return useMemo(() => client.resource(model, options), [client, model, options.path]);
}

export interface UseResourceResult<M extends NexoModel> extends NexoQueryState<ResourceListResult<Infer<M>>> {
  /** The current page of records (empty while loading the first time). */
  readonly items: readonly Infer<M>[];
  /** Matching records across all pages. */
  readonly total: number;
  readonly refetch: () => Promise<void>;
  readonly create: (input: InferInput<M>) => Promise<Infer<M>>;
  readonly update: (id: string, patch: InferPatch<M>) => Promise<Infer<M>>;
  readonly delete: (id: string) => Promise<void>;
}

/** A page of a model's records, plus the operations that change them. */
export function useResource<M extends NexoModel>(
  model: M,
  query: ResourceListQuery<M> = {},
  options: NexoResourceClientOptions = {}
): UseResourceResult<M> {
  const resource = useResourceClient(model, options);
  const key = JSON.stringify(query);
  const listQuery = useMemo(
    () => createQuery(() => resource.list(JSON.parse(key) as ResourceListQuery<M>)),
    [resource, key]
  );
  const state = useSyncExternalStore(listQuery.subscribe, listQuery.getState, listQuery.getState);

  useEffect(() => {
    void listQuery.refetch();
    return resource.onChange(() => void listQuery.refetch());
  }, [resource, listQuery]);

  return useMemo(
    () => ({
      ...state,
      items: state.data?.items ?? [],
      total: state.data?.total ?? 0,
      refetch: listQuery.refetch,
      create: resource.create,
      update: resource.update,
      delete: resource.delete
    }),
    [state, listQuery, resource]
  );
}

export interface UseRecordResult<M extends NexoModel> extends NexoQueryState<Infer<M>> {
  readonly refetch: () => Promise<void>;
  readonly update: (patch: InferPatch<M>) => Promise<Infer<M>>;
  readonly delete: () => Promise<void>;
}

/** One record by id. With `id` undefined the hook stays idle (useful while a route param is missing). */
export function useRecord<M extends NexoModel>(
  model: M,
  id: string | undefined,
  options: NexoResourceClientOptions = {}
): UseRecordResult<M> {
  const resource = useResourceClient(model, options);
  const recordQuery = useMemo(
    () => createQuery(() => resource.get(id!), { enabled: id !== undefined }),
    [resource, id]
  );
  const state = useSyncExternalStore(recordQuery.subscribe, recordQuery.getState, recordQuery.getState);

  useEffect(() => {
    if (id === undefined) return;
    void recordQuery.refetch();
    return resource.onChange(() => void recordQuery.refetch());
  }, [resource, recordQuery, id]);

  return useMemo(
    () => ({
      ...state,
      refetch: recordQuery.refetch,
      update: (patch: InferPatch<M>) => resource.update(id!, patch),
      delete: () => resource.delete(id!)
    }),
    [state, recordQuery, resource, id]
  );
}

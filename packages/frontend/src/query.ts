/**
 * The React-free state behind `useResource` and `useRecord`: loads data,
 * tracks loading and error, and lets only the latest request update the
 * state, so a slow early response never overwrites a newer one.
 */

export interface NexoQueryState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

export interface NexoQuery<T> {
  getState(): NexoQueryState<T>;
  /** Called whenever the state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Loads again. Keeps the previous data visible while loading. */
  refetch(): Promise<void>;
}

export interface CreateQueryOptions {
  /** When false, the query starts idle (`loading: false`) until `refetch()` is called. Default: true */
  readonly enabled?: boolean | undefined;
}

export function createQuery<T>(load: () => Promise<T>, options: CreateQueryOptions = {}): NexoQuery<T> {
  let state: NexoQueryState<T> = { data: null, loading: options.enabled !== false, error: null };
  let latest = 0;
  const listeners = new Set<() => void>();

  function set(next: NexoQueryState<T>): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refetch() {
      const request = ++latest;
      if (!state.loading) set({ ...state, loading: true });
      try {
        const data = await load();
        if (request === latest) set({ data, loading: false, error: null });
      } catch (error) {
        if (request === latest) {
          set({ data: state.data, loading: false, error: error instanceof Error ? error : new Error(String(error)) });
        }
      }
    }
  };
}

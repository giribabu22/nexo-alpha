import { useEffect, useState, useCallback, useRef } from "react";
import { useNexoClient } from "./context.js";
import type {
  NexoHealth,
  NexoKnowledge,
  NexoModuleInfo,
  UsePollingOptions
} from "./types.js";

export interface UseNexoHealthResult {
  readonly health: NexoHealth | null;
  readonly loading: boolean;
  readonly isConnected: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export function useNexoHealth(options: UsePollingOptions = {}): UseNexoHealthResult {
  const client = useNexoClient();
  const [health, setHealth] = useState<NexoHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await client.getHealth();
      if (mountedRef.current) {
        setHealth(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    if (options.enabled === false) {
      setLoading(false);
      return;
    }

    void fetchHealth();

    if (options.pollInterval && options.pollInterval > 0) {
      const intervalId = setInterval(() => {
        void fetchHealth();
      }, options.pollInterval);

      return () => {
        mountedRef.current = false;
        clearInterval(intervalId);
      };
    }

    return () => {
      mountedRef.current = false;
    };
  }, [fetchHealth, options.enabled, options.pollInterval]);

  return {
    health,
    loading,
    isConnected: health?.status === "ok",
    error,
    refetch: fetchHealth,
    refresh: fetchHealth
  };
}

export interface UseNexoKnowledgeResult {
  readonly knowledge: NexoKnowledge | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export function useNexoKnowledge(options: UsePollingOptions = {}): UseNexoKnowledgeResult {
  const client = useNexoClient();
  const [knowledge, setKnowledge] = useState<NexoKnowledge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetchKnowledge = useCallback(async () => {
    try {
      const data = await client.getKnowledge();
      if (mountedRef.current) {
        setKnowledge(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    mountedRef.current = true;
    if (options.enabled === false) {
      setLoading(false);
      return;
    }

    void fetchKnowledge();

    if (options.pollInterval && options.pollInterval > 0) {
      const intervalId = setInterval(() => {
        void fetchKnowledge();
      }, options.pollInterval);

      return () => {
        mountedRef.current = false;
        clearInterval(intervalId);
      };
    }

    return () => {
      mountedRef.current = false;
    };
  }, [fetchKnowledge, options.enabled, options.pollInterval]);

  return {
    knowledge,
    loading,
    error,
    refetch: fetchKnowledge,
    refresh: fetchKnowledge
  };
}

export interface UseNexoModuleGraphResult {
  readonly modules: readonly NexoModuleInfo[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

export function useNexoModuleGraph(options: UsePollingOptions = {}): UseNexoModuleGraphResult {
  const { health, loading, error, refetch } = useNexoHealth(options);
  const modules = health?.moduleGraph ?? [];

  return {
    modules,
    loading,
    error,
    refetch
  };
}

export interface UseNexoApiOptions<T = unknown> {
  readonly immediate?: boolean | undefined;
  readonly method?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
  readonly body?: unknown | undefined;
  readonly initialData?: T | undefined;
}

export interface UseNexoApiResult<T = unknown> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly execute: (overrideBody?: unknown) => Promise<T | null>;
}

export function useNexoApi<T = unknown>(
  path: string,
  options: UseNexoApiOptions<T> = {}
): UseNexoApiResult<T> {
  const client = useNexoClient();
  const [data, setData] = useState<T | null>(options.initialData ?? null);
  const [loading, setLoading] = useState(options.immediate ?? true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const execute = useCallback(
    async (overrideBody?: unknown): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const method = options.method ?? "GET";
        const body = overrideBody !== undefined ? overrideBody : options.body;
        let result: T;

        if (method === "POST") {
          result = await client.post<T>(path, body);
        } else if (method === "PUT") {
          result = await client.put<T>(path, body);
        } else if (method === "DELETE") {
          result = await client.delete<T>(path);
        } else {
          result = await client.get<T>(path);
        }

        if (mountedRef.current) {
          setData(result);
          setLoading(false);
        }
        return result;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) {
          setError(errorObj);
          setLoading(false);
        }
        return null;
      }
    },
    [client, path, options.method, options.body]
  );

  useEffect(() => {
    mountedRef.current = true;
    if (options.immediate ?? true) {
      void execute();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [execute, options.immediate]);

  return {
    data,
    loading,
    error,
    execute
  };
}

export interface UseNexoRpcQueryResult<TData> {
  readonly data: TData | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<void>;
}

export function useNexoRpcQuery<TData>(
  queryFn: () => Promise<TData>,
  deps: readonly unknown[] = []
): UseNexoRpcQueryResult<TData> {
  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await queryFn();
      if (mountedRef.current) {
        setData(result);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    void execute();
    return () => {
      mountedRef.current = false;
    };
  }, [execute]);

  return {
    data,
    loading,
    error,
    refetch: execute
  };
}

export interface UseNexoRpcMutationResult<TInput, TOutput> {
  readonly mutate: (input?: TInput) => Promise<TOutput | null>;
  readonly data: TOutput | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

export function useNexoRpcMutation<TInput = void, TOutput = unknown>(
  mutationFn: (input?: TInput) => Promise<TOutput>
): UseNexoRpcMutationResult<TInput, TOutput> {
  const [data, setData] = useState<TOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const mutate = useCallback(async (input?: TInput): Promise<TOutput | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutationFn(input);
      if (mountedRef.current) {
        setData(result);
        setLoading(false);
      }
      return result;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) {
        setError(errorObj);
        setLoading(false);
      }
      return null;
    }
  }, [mutationFn]);

  return {
    mutate,
    data,
    loading,
    error
  };
}

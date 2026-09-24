import { NexoClient, createNexoClient } from "./client.js";
import type { NexoClientOptions } from "./types.js";

export interface RpcRouteConfig {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
  readonly path?: string | undefined;
}

export interface NexoRpcClientOptions extends NexoClientOptions {
  readonly client?: NexoClient | undefined;
  readonly routes?: Readonly<Record<string, RpcRouteConfig>> | undefined;
}

export type InferRpcInput<TEndpoint> = TEndpoint extends { input: infer TIn }
  ? TIn
  : TEndpoint extends (input: infer TIn) => any
  ? TIn
  : void;

export type InferRpcOutput<TEndpoint> = TEndpoint extends { output: infer TOut }
  ? TOut
  : TEndpoint extends (...args: any[]) => infer TOut
  ? Awaited<TOut>
  : unknown;

export type RpcCaller<TEndpoint> = {
  (input?: InferRpcInput<TEndpoint>): Promise<InferRpcOutput<TEndpoint>>;
  query: (input?: InferRpcInput<TEndpoint>) => Promise<InferRpcOutput<TEndpoint>>;
  mutate: (input?: InferRpcInput<TEndpoint>) => Promise<InferRpcOutput<TEndpoint>>;
};

export type NexoRpcClient<TContract> = {
  [TModule in keyof TContract]: {
    [TEndpoint in keyof TContract[TModule]]: RpcCaller<TContract[TModule][TEndpoint]>;
  };
};

function inferMethod(endpointName: string): "GET" | "POST" | "PUT" | "DELETE" {
  const lower = endpointName.toLowerCase();
  if (lower.startsWith("get") || lower.startsWith("list") || lower.startsWith("fetch") || lower.startsWith("find")) {
    return "GET";
  }
  if (lower.startsWith("delete") || lower.startsWith("remove")) {
    return "DELETE";
  }
  if (lower.startsWith("update") || lower.startsWith("put")) {
    return "PUT";
  }
  return "POST";
}

function resolveEndpointCall(
  client: NexoClient,
  moduleName: string,
  endpointName: string,
  routes: Readonly<Record<string, RpcRouteConfig>> | undefined,
  input: unknown
): Promise<unknown> {
  const routeKey = `${moduleName}.${endpointName}`;
  const customRoute = routes?.[routeKey];

  const method = customRoute?.method ?? inferMethod(endpointName);
  let rawPath = customRoute?.path ?? `/api/${moduleName}/${endpointName}`;

  let body: unknown = undefined;
  let queryParams: Record<string, string> = {};

  if (input && typeof input === "object" && !Array.isArray(input)) {
    const inputObj = { ...(input as Record<string, unknown>) };

    // Replace path parameters matching {param} or :param
    rawPath = rawPath.replace(/\{(\w+)\}|:(\w+)/g, (_, p1, p2) => {
      const key = p1 || p2;
      if (key in inputObj) {
        const val = inputObj[key];
        delete inputObj[key];
        return encodeURIComponent(String(val));
      }
      return _;
    });

    const remainingKeys = Object.keys(inputObj);

    if (method === "GET" || method === "DELETE") {
      for (const k of remainingKeys) {
        const val = inputObj[k];
        if (val !== undefined && val !== null) {
          queryParams[k] = String(val);
        }
      }
    } else {
      if (remainingKeys.length > 0) {
        body = inputObj;
      }
    }
  } else if (input !== undefined) {
    if (method !== "GET" && method !== "DELETE") {
      body = input;
    }
  }

  // Append query string if any
  const queryString = new URLSearchParams(queryParams).toString();
  const finalPath = queryString ? `${rawPath}?${queryString}` : rawPath;

  const init: RequestInit = { method };
  if (body !== undefined && (method === "POST" || method === "PUT" || method === "PATCH")) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  return client.api(finalPath, init);
}

export function createNexoRpcClient<TContract>(
  options: NexoRpcClientOptions = {}
): NexoRpcClient<TContract> {
  const client = options.client ?? createNexoClient(options);
  const routes = options.routes;

  const moduleProxyCache = new Map<string, any>();

  return new Proxy({} as NexoRpcClient<TContract>, {
    get(_target, moduleProp) {
      if (typeof moduleProp !== "string" || moduleProp === "then") {
        return undefined;
      }

      if (moduleProxyCache.has(moduleProp)) {
        return moduleProxyCache.get(moduleProp);
      }

      const endpointProxy = new Proxy({}, {
        get(_targetEndpoint, endpointProp) {
          if (typeof endpointProp !== "string" || endpointProp === "then") {
            return undefined;
          }

          const caller = (input?: unknown) =>
            resolveEndpointCall(client, moduleProp, endpointProp, routes, input);

          caller.query = (input?: unknown) => caller(input);
          caller.mutate = (input?: unknown) => caller(input);

          return caller;
        }
      });

      moduleProxyCache.set(moduleProp, endpointProxy);
      return endpointProxy;
    }
  });
}

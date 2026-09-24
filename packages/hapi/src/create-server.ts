import Hapi from "@hapi/hapi";
import {
  NexoEvent,
  type NexoApi,
  type NexoApplication,
  type NexoAuthenticator,
  type NexoRequestContext,
  type DscInterceptorLike,
  DSC_INTERCEPTOR
} from "@nexo-alpha/core";

export interface CreateHapiServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly authenticate?: NexoAuthenticator;
  readonly bindLifecycle?: boolean;
  readonly cors?: boolean;
  /**
   * When true (default), automatically resolves the DscInterceptor from the
   * app container (if installed via installDscPlugin) and wraps every route
   * handler with DSC timing + payload-size tracking.
   */
  readonly dscInstrument?: boolean;
}

export function toHapiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function missingScopes(api: NexoApi, granted: readonly string[] | undefined): string[] {
  const required = api.auth?.scopes ?? [];
  const grantedSet = new Set(granted ?? []);
  return required.filter((scope) => !grantedSet.has(scope));
}

export async function createHapiServer(
  app: NexoApplication,
  options: CreateHapiServerOptions = {}
): Promise<Hapi.Server> {
  const server = Hapi.server({
    port: options.port ?? 3000,
    host: options.host ?? "localhost",
    ...(options.cors ? { routes: { cors: true } } : {})
  });

  // --- DSC: resolve interceptor from DI container if available ---
  let interceptor: DscInterceptorLike | undefined;
  if (options.dscInstrument !== false) {
    try {
      interceptor = app.container.resolve<DscInterceptorLike>(DSC_INTERCEPTOR);
    } catch {
      // Not installed — run uninstrumented
    }
  }

  const apis = app.getApis();

  for (const api of apis) {
    if (api.auth?.required && options.authenticate === undefined) {
      throw new Error(
        `API "${api.name}" requires auth, but no "authenticate" option was provided to createHapiServer().`
      );
    }
  }

  for (const api of apis) {
    if (api.handler === undefined) continue;
    // Hapi generates HEAD responses from GET automatically
    if (api.method === "HEAD") continue;

    // Wrap the handler with DSC timing + payload tracking if interceptor present
    const rawHandler = api.handler;
    const trackedHandler = interceptor
      ? interceptor.instrument(
          `hapi:${api.method}:${api.path}`,
          rawHandler,
          { stage: "execute", trackPayloadSize: true }
        )
      : rawHandler;

    server.route({
      method: api.method,
      path: toHapiPath(api.path),
      handler: async (request, h) => {
        const startedAt = Date.now();

        const respond = (statusCode: number, body?: unknown) => {
          app.events.emit(NexoEvent.API_CALLED, {
            api: api.name,
            method: api.method,
            path: api.path,
            statusCode,
            durationMs: Date.now() - startedAt
          });
          return body === undefined
            ? h.response().code(statusCode)
            : h.response(body as Hapi.ResponseValue).code(statusCode);
        };

        const context: NexoRequestContext = {
          params: request.params as Record<string, string>,
          query: request.query as Record<string, unknown>,
          payload: request.payload,
          headers: request.headers as Record<string, string>
        };

        if (api.auth?.required) {
          const authResult = await (options.authenticate as NexoAuthenticator)(context);
          if (!authResult.authenticated) return respond(401, { error: "Unauthorized" });
          const missing = missingScopes(api, authResult.scopes);
          if (missing.length > 0) return respond(403, { error: "Forbidden", missingScopes: missing });
        }

        if (api.validate) {
          const outcome = await api.validate(context);
          if (!outcome.valid) {
            return respond(400, { error: "Validation failed", errors: outcome.errors ?? [] });
          }
        }

        let result: unknown;
        try {
          result = await trackedHandler(context);
        } catch (error) {
          app.events.emit(NexoEvent.API_ERROR, {
            api: api.name,
            method: api.method,
            path: api.path,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }

        return result === undefined ? respond(204) : respond(200, result);
      }
    });
  }

  return server;
}

export async function startHapiServer(
  app: NexoApplication,
  options: CreateHapiServerOptions = {}
): Promise<Hapi.Server> {
  const server = await createHapiServer(app, options);
  await server.start();

  if (options.bindLifecycle !== false) {
    const onStopping = async () => {
      try { await server.stop(); } catch { /* best effort */ }
    };
    app.events.on(NexoEvent.APPLICATION_STOPPING, onStopping);
  }

  return server;
}

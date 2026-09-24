import Hapi from "@hapi/hapi";
import {
  NexoEvent,
  type NexoApi,
  type NexoApplication,
  type NexoAuthenticator,
  type NexoRequestContext
} from "@nexo-alpha/core";

export interface CreateHapiServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly authenticate?: NexoAuthenticator;
  readonly bindLifecycle?: boolean;
  readonly cors?: boolean;
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

  const apis = app.getApis();

  for (const api of apis) {
    if (api.auth?.required && options.authenticate === undefined) {
      throw new Error(
        `API "${api.name}" requires auth, but no "authenticate" option was provided to createHapiServer().`
      );
    }
  }

  for (const api of apis) {
    if (api.handler === undefined) {
      continue;
    }

    if (api.method === "HEAD") {
      // Hapi generates HEAD responses from GET routes automatically and
      // does not accept HEAD as an explicit route method.
      continue;
    }

    const handler = api.handler;

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
          // Guaranteed defined: createHapiServer already rejected before
          // registering any routes if an auth-required API had no
          // "authenticate" option configured.
          const authResult = await (options.authenticate as NexoAuthenticator)(
            context
          );

          if (!authResult.authenticated) {
            return respond(401, { error: "Unauthorized" });
          }

          const missing = missingScopes(api, authResult.scopes);
          if (missing.length > 0) {
            return respond(403, { error: "Forbidden", missingScopes: missing });
          }
        }

        if (api.validate) {
          const outcome = await api.validate(context);

          if (!outcome.valid) {
            return respond(400, {
              error: "Validation failed",
              errors: outcome.errors ?? []
            });
          }
        }

        let result: unknown;
        try {
          result = await handler(context);
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
      try {
        await server.stop();
      } catch {
        // Best effort if already stopped
      }
    };
    app.events.on(NexoEvent.APPLICATION_STOPPING, onStopping);
  }

  return server;
}

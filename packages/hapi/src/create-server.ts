import Hapi from "@hapi/hapi";
import type { NexoApplication, NexoRequestContext } from "@nexo-alpha/core";

export interface CreateHapiServerOptions {
  readonly port?: number;
  readonly host?: string;
}

export function toHapiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export async function createHapiServer(
  app: NexoApplication,
  options: CreateHapiServerOptions = {}
): Promise<Hapi.Server> {
  const server = Hapi.server({
    port: options.port ?? 3000,
    host: options.host ?? "localhost"
  });

  for (const api of app.getApis()) {
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
        const context: NexoRequestContext = {
          params: request.params as Record<string, string>,
          query: request.query as Record<string, unknown>,
          payload: request.payload,
          headers: request.headers as Record<string, string>
        };

        const result = await handler(context);

        return result === undefined ? h.response().code(204) : result;
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
  return server;
}

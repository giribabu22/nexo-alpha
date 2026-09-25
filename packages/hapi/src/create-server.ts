import Hapi from "@hapi/hapi";
import {
  NexoEvent,
  NexoHttpError,
  createRateLimiter,
  isHttpResponse,
  isValidProjectId,
  runInProject,
  missingScopes,
  type NexoApi,
  type NexoApplication,
  type NexoAuthenticator,
  type NexoLogger,
  type NexoRequestContext,
  type DscInterceptorLike,
  DSC_INTERCEPTOR
} from "@nexo-alpha/core";
import { randomUUID } from "node:crypto";

/** Header carrying the per-request correlation ID (also visible to handlers via `context.headers`). */
export const REQUEST_ID_HEADER = "x-request-id";

export interface HapiProjectOptions {
  /**
   * The request's project, e.g. from an `x-project-id` header checked against
   * the user's memberships. Throw `NexoHttpError(403, …)` to deny access.
   */
  resolve(context: NexoRequestContext): string | undefined | Promise<string | undefined>;
  /** Answer 400 when no project resolves. Default: true */
  readonly required?: boolean;
  /** APIs that run outside any project (e.g. health checks, the project list). */
  readonly skip?: (api: NexoApi) => boolean;
}

export interface HapiRateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  /**
   * Groups requests into buckets. Default: the client IP. Return e.g. an API
   * key or user ID for per-identity quotas; return undefined to exempt a
   * request (such as health checks).
   */
  readonly key?: (request: { readonly path: string; readonly method: string; readonly remoteAddress: string; readonly headers: Readonly<Record<string, string>> }) => string | undefined;
  /** Clock override, ms since epoch (tests). */
  readonly now?: () => number;
}
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface CreateHapiServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly authenticate?: NexoAuthenticator;
  readonly bindLifecycle?: boolean;
  readonly cors?: boolean;
  /**
   * Whether to log incoming HTTP requests and responses to the console.
   * Defaults to true in non-test environments.
   */
  readonly logging?: boolean;
  /**
   * Structured logger for request logs (one entry per response, with
   * requestId, method, path, statusCode and durationMs). When set, it
   * replaces the colored console output; `logging: false` silences it.
   */
  readonly logger?: NexoLogger;
  /**
   * Per-client HTTP rate limit (fixed window, in-memory per process).
   * Requests over the limit get 429 with Retry-After; every response carries
   * RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset headers.
   */
  readonly rateLimit?: HapiRateLimitOptions;
  /**
   * Multi-tenancy: resolves the project of each request (after
   * authentication) and runs validation and the handler inside it, so
   * project-scoped stores (`scopeByProject`) see only that project's data.
   */
  readonly project?: HapiProjectOptions;
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

export async function createHapiServer(
  app: NexoApplication,
  options: CreateHapiServerOptions = {}
): Promise<Hapi.Server> {
  const server = Hapi.server({
    port: options.port ?? 3000,
    host: options.host ?? "localhost",
    ...(options.cors ? { routes: { cors: true } } : {})
  });

  // --- Request IDs: reuse a well-formed inbound x-request-id, else generate one ---
  server.ext("onRequest", (request, h) => {
    const inbound = request.headers[REQUEST_ID_HEADER];
    const requestId = typeof inbound === "string" && VALID_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    (request.app as { requestId?: string }).requestId = requestId;
    request.headers[REQUEST_ID_HEADER] = requestId;
    return h.continue;
  });
  // --- Rate limiting: runs after request IDs, before auth and handlers ---
  if (options.rateLimit !== undefined) {
    const rateLimit = options.rateLimit;
    const limiter = createRateLimiter({
      windowMs: rateLimit.windowMs,
      max: rateLimit.max,
      ...(rateLimit.now !== undefined ? { now: rateLimit.now } : {})
    });
    server.ext("onRequest", (request, h) => {
      const key = rateLimit.key !== undefined
        ? rateLimit.key({
          path: request.path,
          method: request.method.toUpperCase(),
          remoteAddress: request.info.remoteAddress,
          headers: request.headers as Record<string, string>
        })
        : request.info.remoteAddress;
      if (key === undefined) return h.continue;

      const result = limiter.hit(key);
      const resetSeconds = Math.ceil(result.resetMs / 1000);
      const headers: Record<string, string> = {
        "ratelimit-limit": String(result.limit),
        "ratelimit-remaining": String(result.remaining),
        "ratelimit-reset": String(resetSeconds)
      };
      (request.app as { rateLimitHeaders?: Record<string, string> }).rateLimitHeaders = headers;

      if (!result.allowed) {
        const response = h.response({ error: "Too Many Requests", code: "RATE_LIMITED" }).code(429);
        response.header("retry-after", String(Math.max(1, resetSeconds)));
        for (const [name, value] of Object.entries(headers)) response.header(name, value);
        const requestId = (request.app as { requestId?: string }).requestId;
        if (requestId !== undefined) response.header(REQUEST_ID_HEADER, requestId);
        return response.takeover();
      }
      return h.continue;
    });
  }

  server.ext("onPreResponse", (request, h) => {
    const requestId = (request.app as { requestId?: string }).requestId;
    const rateLimitHeaders = (request.app as { rateLimitHeaders?: Record<string, string> }).rateLimitHeaders ?? {};
    const response = request.response as any;
    const extraHeaders: Record<string, string> = {
      ...rateLimitHeaders,
      ...(requestId !== undefined ? { [REQUEST_ID_HEADER]: requestId } : {})
    };
    for (const [name, value] of Object.entries(extraHeaders)) {
      if (response?.isBoom) {
        response.output.headers[name] = value;
      } else {
        response?.header?.(name, value);
      }
    }
    return h.continue;
  });

  const statusOf = (request: Hapi.Request): number => {
    const resp = request.response as any;
    return resp?.isBoom ? (resp?.output?.statusCode ?? 500) : (resp?.statusCode ?? 200);
  };

  const logger = options.logger;
  if (logger !== undefined && options.logging !== false) {
    server.events.on("response", (request) => {
      const statusCode = statusOf(request);
      const fields = {
        requestId: (request.app as { requestId?: string }).requestId,
        method: request.method.toUpperCase(),
        path: request.path,
        statusCode,
        durationMs: Date.now() - request.info.received
      };
      if (statusCode >= 500) logger.error("http request", fields);
      else if (statusCode >= 400) logger.warn("http request", fields);
      else logger.info("http request", fields);
    });
  }

  const shouldLog = logger === undefined && (options.logging ?? (process.env.NODE_ENV !== "test"));
  if (shouldLog) {
    server.events.on("response", (request) => {
      const method = request.method.toUpperCase();
      const path = request.path;
      const statusCode = statusOf(request);
      const duration = Date.now() - request.info.received;

      const statusColor =
        statusCode >= 500
          ? "\x1b[31m"
          : statusCode >= 400
          ? "\x1b[33m"
          : statusCode >= 300
          ? "\x1b[36m"
          : "\x1b[32m";
      const reset = "\x1b[0m";
      const dim = "\x1b[2m";
      const bold = "\x1b[1m";

      console.log(
        `${dim}[nexo-http]${reset} ${bold}${method.padEnd(6)}${reset} ${path} ${statusColor}${statusCode}${reset} ${dim}(${duration}ms)${reset}`
      );
    });
  }

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
          const missing = missingScopes(authResult.scopes, api.auth.scopes ?? []);
          if (missing.length > 0) return respond(403, { error: "Forbidden", missingScopes: missing });
        }

        const execute = async () => {
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
            if (error instanceof NexoHttpError && error.statusCode >= 400 && error.statusCode < 500) {
              return respond(error.statusCode, { error: error.message, code: error.code });
            }
            app.events.emit(NexoEvent.API_ERROR, {
              api: api.name,
              method: api.method,
              path: api.path,
              durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message : String(error)
            });
            throw error;
          }

          if (isHttpResponse(result)) {
            const response = respond(result.statusCode, result.body);
            for (const [name, value] of Object.entries(result.headers)) response.header(name, value);
            return response;
          }
          return result === undefined ? respond(204) : respond(200, result);
        };

        const project = options.project;
        if (project === undefined || project.skip?.(api) === true) {
          return execute();
        }
        let projectId: string | undefined;
        try {
          projectId = await project.resolve(context);
          if (projectId !== undefined && !isValidProjectId(projectId)) {
            throw new NexoHttpError(400, "INVALID_PROJECT_ID", `Invalid project ID "${projectId}".`);
          }
        } catch (error) {
          if (error instanceof NexoHttpError && error.statusCode >= 400 && error.statusCode < 500) {
            return respond(error.statusCode, { error: error.message, code: error.code });
          }
          throw error;
        }
        if (projectId === undefined) {
          if (project.required === false) return execute();
          return respond(400, { error: "A project is required for this request.", code: "PROJECT_REQUIRED" });
        }
        return runInProject(projectId, execute);
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

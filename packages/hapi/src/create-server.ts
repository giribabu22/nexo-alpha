import Hapi from "@hapi/hapi";
import Inert from "@hapi/inert";
import {
  NexoConfigurationError,
  NexoEvent,
  createRateLimiter,
  createRequestPipeline,
  type NexoApplication,
  type NexoAuthenticator,
  type NexoLogger,
  type RequestProjectOptions,
  type DscInterceptorLike,
  DSC_INTERCEPTOR
} from "@nexo-alpha/core";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Header carrying the per-request correlation ID (also visible to handlers via `context.headers`). */
export const REQUEST_ID_HEADER = "x-request-id";

export interface SecurityHeadersOptions {
  /** Add `X-Content-Type-Options: nosniff`. Default: true */
  readonly noSniff?: boolean;
  /** Add `X-Frame-Options: DENY` | `SAMEORIGIN` | false. Default: "DENY" */
  readonly xframe?: "DENY" | "SAMEORIGIN" | false;
  /** Add `Referrer-Policy`. Default: "strict-origin-when-cross-origin" */
  readonly referrerPolicy?: string | false;
  /** Add `X-XSS-Protection: 0`. Default: true */
  readonly xssProtection?: boolean;
  /** Add `Strict-Transport-Security`. Default: false */
  readonly hsts?: string | false;
}

/** Multi-tenancy options; the same as core's `RequestProjectOptions`. */
export type HapiProjectOptions = RequestProjectOptions;

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
  /** Authenticates APIs with `auth.required`. Default: the application's (`app.setAuthenticator()`). */
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
  /**
   * Automatically attach security headers (nosniff, X-Frame-Options, Referrer-Policy, etc.).
   * Default: false (opt-in for backwards compatibility).
   */
  readonly securityHeaders?: boolean | SecurityHeadersOptions;
  /**
   * A built browser app to serve from this server (e.g. Vite's `dist`), so
   * the app and its API share one origin and one deployment. Files are served
   * at their paths; a page load (Accept: text/html) of any other URL gets
   * `index.html`, so client-side routes survive a reload. API routes always
   * take precedence. The directory must contain `index.html`.
   */
  readonly frontend?: string | URL | undefined;
}

/** The route that serves `frontend` files. */
const FRONTEND_ROUTE = "/{path*}";

async function serveFrontend(server: Hapi.Server, location: string | URL): Promise<void> {
  const directory = resolve(location instanceof URL ? fileURLToPath(location) : location);
  const index = join(directory, "index.html");
  try {
    await access(index);
  } catch {
    throw new NexoConfigurationError(`frontend: "${directory}" has no index.html. Build the frontend first (e.g. npm run build).`);
  }

  await server.register(Inert);
  // Inert confines requests to the directory and hides dotfiles.
  server.route({
    method: "GET",
    path: FRONTEND_ROUTE,
    handler: { directory: { path: directory, index: ["index.html"], redirectToSlash: false } }
  });
  // A page load of a client-side route (/todos/42) has no file: answer with the app.
  server.ext("onPreResponse", (request, h) => {
    const response = request.response as { isBoom?: boolean; output?: { statusCode: number } } | null;
    const pageLoad = String(request.headers.accept ?? "").includes("text/html");
    if (request.route.path !== FRONTEND_ROUTE || response?.isBoom !== true || response.output?.statusCode !== 404 || !pageLoad) {
      return h.continue;
    }
    return h.file(index, { confine: directory });
  });
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

  // Before the header extension below, so `index.html` answers get the same headers.
  if (options.frontend !== undefined) await serveFrontend(server, options.frontend);

  server.ext("onPreResponse", (request, h) => {
    const requestId = (request.app as { requestId?: string }).requestId;
    const rateLimitHeaders = (request.app as { rateLimitHeaders?: Record<string, string> }).rateLimitHeaders ?? {};
    const response = request.response as any;
    const securityHeaders: Record<string, string> = {};
    if (options.securityHeaders) {
      const sec = typeof options.securityHeaders === "object" ? options.securityHeaders : {};
      if (sec.noSniff !== false) securityHeaders["x-content-type-options"] = "nosniff";
      if (sec.xframe !== false) securityHeaders["x-frame-options"] = sec.xframe ?? "DENY";
      if (sec.referrerPolicy !== false) securityHeaders["referrer-policy"] = sec.referrerPolicy ?? "strict-origin-when-cross-origin";
      if (sec.xssProtection !== false) securityHeaders["x-xss-protection"] = "0";
      if (sec.hsts) securityHeaders["strict-transport-security"] = sec.hsts;
    }

    const extraHeaders: Record<string, string> = {
      ...rateLimitHeaders,
      ...securityHeaders,
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

  // Authentication, projects, validation, middleware and error mapping: the
  // same pipeline `app.dispatch()` uses. This adapter only translates.
  const pipeline = createRequestPipeline(app, {
    authenticate: options.authenticate,
    project: options.project,
    instrument: interceptor
      ? (api, handler) => interceptor.instrument(`hapi:${api.method}:${api.path}`, handler, { stage: "execute", trackPayloadSize: true })
      : undefined
  });

  const apis = app.getApis();

  for (const api of apis) {
    if (api.auth?.required && pipeline.authenticate === undefined) {
      throw new Error(
        `API "${api.name}" requires auth, but no authenticator is configured: pass "authenticate" to createHapiServer() or call app.setAuthenticator().`
      );
    }
  }

  for (const api of apis) {
    if (api.handler === undefined) continue;
    // Hapi generates HEAD responses from GET automatically
    if (api.method === "HEAD") continue;

    server.route({
      method: api.method,
      path: toHapiPath(api.path),
      ...(api.rawBody !== undefined
        ? { options: { payload: { parse: false, output: "data" as const, maxBytes: api.rawBody.maxBytes ?? 10 * 1024 * 1024 } } }
        : {}),
      handler: async (request, h) => {
        const answer = await pipeline.handle(api, {
          params: request.params as Record<string, string>,
          query: request.query as Record<string, unknown>,
          payload: request.payload,
          headers: request.headers as Record<string, string>
        });
        const response = answer.body === undefined
          ? h.response().code(answer.statusCode)
          : h.response(answer.body as Hapi.ResponseValue).code(answer.statusCode);
        for (const [name, value] of Object.entries(answer.headers)) response.header(name, value);
        return response;
      }
    });
  }

  return server;
}

/**
 * Explains why the server couldn't listen, naming the port and host and what
 * to change, with Node's error as `cause`. Other errors are returned unchanged.
 */
export function explainListenError(error: unknown, port: number, host: string): unknown {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const at = `port ${port} on ${host}`;
  const message =
    code === "EADDRINUSE"
      ? `Can't listen on ${at}: another process is already using it (EADDRINUSE). Stop that process, or choose another port (the port option; serve() also reads PORT).`
      : code === "EACCES"
        ? `Can't listen on ${at}: permission denied (EACCES). Ports below 1024 need extra rights on most systems; choose a port of 1024 or higher (the port option; serve() also reads PORT).`
        : code === "EADDRNOTAVAIL"
          ? `Can't listen on ${at}: "${host}" isn't an address of this machine (EADDRNOTAVAIL). Use "localhost", or "0.0.0.0" to listen on every network interface (the host option).`
          : undefined;
  return message === undefined ? error : new NexoConfigurationError(message, { cause: error });
}

export async function startHapiServer(
  app: NexoApplication,
  options: CreateHapiServerOptions = {}
): Promise<Hapi.Server> {
  const server = await createHapiServer(app, options);
  try {
    await server.start();
  } catch (error) {
    throw explainListenError(error, options.port ?? 3000, options.host ?? "localhost");
  }

  if (options.bindLifecycle !== false) {
    const onStopping = async () => {
      try { await server.stop(); } catch { /* best effort */ }
    };
    app.events.on(NexoEvent.APPLICATION_STOPPING, onStopping);
  }

  return server;
}

export async function stopHapiServer(
  server: Hapi.Server,
  options: { readonly timeoutMs?: number } = {}
): Promise<void> {
  await server.stop({ timeout: options.timeoutMs ?? 5000 });
}


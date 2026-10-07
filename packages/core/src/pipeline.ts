/**
 * The request pipeline: what happens between "a request for this API arrived"
 * and "this is the answer", independent of any HTTP server. `app.dispatch()`
 * and HTTP adapters (`@nexo-alpha/hapi`) both run requests through it, so an
 * API behaves the same however it is called, and an adapter only translates
 * its framework's request in and the answer out.
 *
 * ```ts
 * const pipeline = createRequestPipeline(app, { authenticate });
 * const { statusCode, headers, body } = await pipeline.handle(api, { params, query, payload, headers });
 * ```
 *
 * Steps, in order: authenticate and check scopes (401/403) → resolve the
 * project (400) → validate with `validate` or `schema` (400) → the app's
 * middleware around the handler → map the result (`httpResponse` → its
 * status and headers, `undefined` → 204, anything else → 200). Errors thrown
 * by middleware or the handler become answers when they are a 4xx
 * `NexoHttpError` or a `NexoValidationError` (400); anything else emits
 * `api.error` and is rethrown for the adapter to answer 500. Every answer
 * emits `api.called` with its status.
 */

import { isHttpResponse, type NexoApi, type NexoApiHandler, type NexoAuthenticator, type NexoRequestContext } from "./api.js";
import type { NexoApplication } from "./application.js";
import { NexoAuthenticationError, NexoHttpError, NexoValidationError } from "./errors.js";
import { NexoEvent } from "./events.js";
import { NexoMiddlewarePipeline } from "./middleware.js";
import { isValidProjectId, runInProject } from "./projects.js";
import { missingScopes } from "./scopes.js";
import { validateSchema } from "./validation.js";

/** Multi-tenancy: which project a request belongs to. */
export interface RequestProjectOptions {
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

export interface RequestPipelineOptions {
  /** Authenticates APIs with `auth.required`. Default: the application's (`app.setAuthenticator()`). */
  readonly authenticate?: NexoAuthenticator | undefined;
  /**
   * Resolves the project of each request (after authentication) and runs
   * validation, middleware and the handler inside it, so project-scoped
   * stores (`scopeByProject`) see only that project's data.
   */
  readonly project?: RequestProjectOptions | undefined;
  /** Wraps each API's handler once, e.g. for timing. */
  readonly instrument?: ((api: NexoApi, handler: NexoApiHandler) => NexoApiHandler) | undefined;
}

/** The answer to one request. */
export interface NexoPipelineResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Undefined for an empty answer (e.g. 204). */
  readonly body: unknown;
  /**
   * For a 4xx answer: the error it stands for (`NexoAuthenticationError` for
   * 401/403, `NexoValidationError` for validation, or the `NexoHttpError` that
   * was thrown). `app.dispatch()` throws it; HTTP adapters send `body`.
   */
  readonly error?: Error;
}

export interface NexoRequestPipeline {
  /** The authenticator requests are checked with: the option, else the application's. */
  readonly authenticate: NexoAuthenticator | undefined;
  handle(api: NexoApi, request: NexoRequestContext): Promise<NexoPipelineResponse>;
}

export function createRequestPipeline(app: NexoApplication, options: RequestPipelineOptions = {}): NexoRequestPipeline {
  const instrumented = new WeakMap<NexoApi, NexoApiHandler>();
  const handlerOf = (api: NexoApi): NexoApiHandler | undefined => {
    if (api.handler === undefined || options.instrument === undefined) return api.handler;
    let handler = instrumented.get(api);
    if (handler === undefined) {
      handler = options.instrument(api, api.handler);
      instrumented.set(api, handler);
    }
    return handler;
  };

  return {
    get authenticate() {
      return options.authenticate ?? app.getAuthenticator();
    },

    async handle(api, request) {
      const startedAt = Date.now();

      const answer = (
        statusCode: number,
        body: unknown,
        headers: Readonly<Record<string, string>> = {},
        error?: Error
      ): NexoPipelineResponse => {
        app.events.emit(NexoEvent.API_CALLED, {
          api: api.name,
          method: api.method,
          path: api.path,
          statusCode,
          durationMs: Date.now() - startedAt
        });
        return { statusCode, headers, body, ...(error !== undefined ? { error } : {}) };
      };

      const answerError = (error: NexoHttpError | NexoValidationError): NexoPipelineResponse =>
        error instanceof NexoHttpError
          ? answer(error.statusCode, { error: error.message, code: error.code }, {}, error)
          : answer(400, { error: "Validation failed", errors: error.errors.length > 0 ? error.errors : [error.message] }, {}, error);

      /** Validation, middleware, handler — inside the project, when there is one. */
      const execute = async (context: NexoRequestContext): Promise<NexoPipelineResponse> => {
        const outcome = api.validate
          ? await api.validate(context)
          : api.schema
            ? validateSchema(api.schema, context)
            : { valid: true };
        if (!outcome.valid) {
          const errors = outcome.errors ?? [];
          return answer(
            400,
            { error: "Validation failed", errors },
            {},
            new NexoValidationError(`Request validation failed for API "${api.name}".`, errors)
          );
        }

        const handler = handlerOf(api);
        let result: unknown;
        try {
          result = await new NexoMiddlewarePipeline<NexoRequestContext, unknown>()
            .use(...app.getMiddleware())
            .execute(context, (ctx) => (handler === undefined ? undefined : handler(ctx)));
        } catch (error) {
          if (isClientError(error)) return answerError(error);
          throw error;
        }

        if (isHttpResponse(result)) return answer(result.statusCode, result.body, result.headers);
        return result === undefined ? answer(204, undefined) : answer(200, result);
      };

      try {
        let context = request;

        if (api.auth?.required) {
          const authenticate = options.authenticate ?? app.getAuthenticator();
          if (authenticate === undefined) {
            throw new NexoAuthenticationError(
              `Authentication is required for API "${api.name}", but no authenticator is configured.`
            );
          }
          const authResult = await authenticate(context);
          if (!authResult.authenticated) {
            return answer(401, { error: "Unauthorized" }, {}, new NexoAuthenticationError(`Authentication failed for API "${api.name}".`));
          }
          const missing = missingScopes(authResult.scopes, api.auth.scopes ?? []);
          if (missing.length > 0) {
            return answer(
              403,
              { error: "Forbidden", missingScopes: missing },
              {},
              new NexoAuthenticationError(`Missing required scope(s): ${missing.join(", ")}`)
            );
          }
          context = { ...context, auth: authResult };
        }

        const project = options.project;
        if (project === undefined || project.skip?.(api) === true) return await execute(context);

        let projectId: string | undefined;
        try {
          projectId = await project.resolve(context);
          if (projectId !== undefined && !isValidProjectId(projectId)) {
            throw new NexoHttpError(400, "INVALID_PROJECT_ID", `Invalid project ID "${projectId}".`);
          }
        } catch (error) {
          if (error instanceof NexoHttpError && isClientError(error)) return answerError(error);
          throw error;
        }
        if (projectId === undefined) {
          if (project.required === false) return await execute(context);
          return answerError(new NexoHttpError(400, "PROJECT_REQUIRED", "A project is required for this request."));
        }
        return await runInProject(projectId, () => execute(context));
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
    }
  };
}

/** A 4xx `NexoHttpError`, or a `NexoValidationError` (answered 400). */
function isClientError(error: unknown): error is NexoHttpError | NexoValidationError {
  return (error instanceof NexoHttpError && error.statusCode >= 400 && error.statusCode < 500)
    || error instanceof NexoValidationError;
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  createApplication,
  createRequestContext,
  createRequestPipeline,
  currentProjectId,
  NexoHttpError,
  NexoValidationError
} from "../dist/index.js";

function appWith(apis) {
  const app = createApplication({ name: "pipeline" });
  app.module({ name: "m", apis });
  return app;
}

test("handle() maps handler results to status, headers and body", async () => {
  const app = appWith([]);
  const pipeline = createRequestPipeline(app);
  const api = (handler) => ({ name: "x", method: "GET", path: "/x", handler });

  assert.deepEqual(await pipeline.handle(api(() => ({ a: 1 })), createRequestContext()), { statusCode: 200, headers: {}, body: { a: 1 } });
  assert.deepEqual(await pipeline.handle(api(() => undefined), createRequestContext()), { statusCode: 204, headers: {}, body: undefined });
});

test("every answer emits api.called with its status; only unexpected errors emit api.error", async () => {
  const app = appWith([]);
  app.setAuthenticator(async () => ({ authenticated: false }));
  const called = [];
  const errors = [];
  app.events.on("api.called", (event) => called.push(event.statusCode));
  app.events.on("api.error", (event) => errors.push(event.error));
  const pipeline = createRequestPipeline(app);

  await pipeline.handle({ name: "p", method: "GET", path: "/p", auth: { required: true }, handler: () => ({}) }, createRequestContext());
  await pipeline.handle({ name: "n", method: "GET", path: "/n", handler: () => { throw new NexoHttpError(404, "NOT_FOUND", "gone"); } }, createRequestContext());
  await assert.rejects(pipeline.handle({ name: "b", method: "GET", path: "/b", handler: () => { throw new Error("boom"); } }, createRequestContext()), /boom/);

  assert.deepEqual(called, [401, 404]);
  assert.deepEqual(errors, ["boom"]);
});

test("a 4xx answer carries the error it stands for", async () => {
  const thrown = new NexoHttpError(409, "CONFLICT", "Changed meanwhile.");
  const app = appWith([]);
  const response = await createRequestPipeline(app).handle(
    { name: "c", method: "PUT", path: "/c", handler: () => { throw thrown; } },
    createRequestContext()
  );
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: "Changed meanwhile.", code: "CONFLICT" });
  assert.equal(response.error, thrown);
});

test("dispatch() validates against an API's schema, like HTTP does", async () => {
  const app = appWith([{
    name: "create",
    method: "POST",
    path: "/notes",
    schema: { body: { type: "object", required: ["title"], properties: { title: { type: "string" } } } },
    handler: (ctx) => ({ title: ctx.payload.title })
  }]);

  await assert.rejects(app.dispatch("create", createRequestContext({ payload: {} })), (error) => error instanceof NexoValidationError);
  assert.deepEqual(await app.dispatch("create", createRequestContext({ payload: { title: "Hi" } })), { title: "Hi" });
});

test("dispatch() rethrows a handler's NexoHttpError itself", async () => {
  const thrown = new NexoHttpError(403, "FORBIDDEN", "Not yours.");
  const app = appWith([{ name: "x", method: "GET", path: "/x", handler: () => { throw thrown; } }]);
  await assert.rejects(app.dispatch("x", createRequestContext()), (error) => error === thrown);
});

test("projects: validation, middleware and the handler run inside the resolved project", async () => {
  const app = appWith([]);
  const seen = [];
  app.useMiddleware(async (context, next) => { seen.push(`mw:${currentProjectId()}`); return next(); });
  const pipeline = createRequestPipeline(app, { project: { resolve: (ctx) => ctx.headers["x-project-id"] } });
  const api = { name: "p", method: "GET", path: "/p", handler: () => ({ project: currentProjectId() }) };

  const inside = await pipeline.handle(api, createRequestContext({ headers: { "x-project-id": "acme" } }));
  assert.deepEqual(inside.body, { project: "acme" });
  assert.deepEqual(seen, ["mw:acme"]);

  const none = await pipeline.handle(api, createRequestContext());
  assert.equal(none.statusCode, 400);
  assert.equal(none.body.code, "PROJECT_REQUIRED");

  const bad = await pipeline.handle(api, createRequestContext({ headers: { "x-project-id": "../etc" } }));
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.code, "INVALID_PROJECT_ID");
});

test("instrument wraps each API's handler once", async () => {
  const app = appWith([]);
  let wrapped = 0;
  const pipeline = createRequestPipeline(app, {
    instrument: (api, handler) => { wrapped += 1; return (ctx) => ({ ...handler(ctx), instrumented: api.name }); }
  });
  const api = { name: "i", method: "GET", path: "/i", handler: () => ({ ok: true }) };

  await pipeline.handle(api, createRequestContext());
  const response = await pipeline.handle(api, createRequestContext());

  assert.deepEqual(response.body, { ok: true, instrumented: "i" });
  assert.equal(wrapped, 1);
});

test("the pipeline's authenticator defaults to the application's and follows later changes", async () => {
  const app = appWith([]);
  const pipeline = createRequestPipeline(app);
  assert.equal(pipeline.authenticate, undefined);

  const authenticate = async () => ({ authenticated: true });
  app.setAuthenticator(authenticate);
  assert.equal(pipeline.authenticate, authenticate);
  assert.equal(app.getAuthenticator(), authenticate);
});

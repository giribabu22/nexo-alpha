/**
 * Debugging difficulty: the same mistakes made with Nexo's lower-level APIs
 * (before: createApplication, hand-written modules, startHapiServer) and with
 * serve()/resource()/model() (after). Each run reports when the mistake was
 * detected and what the developer was told.
 *
 * Criteria are fixed per scenario and are the same for both variants:
 * - cause: the message names what is wrong
 * - where: it names the place to change (option, field, scope, path, port)
 * - fix:   it says what to do
 * They were written before the scenarios were first run.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

import {
  createApplication,
  createAuth,
  createFileDocumentStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  field,
  jwtAuthenticator,
  model,
  resource,
  signToken
} from "@nexo-alpha/core";
import { serve, startHapiServer } from "@nexo-alpha/hapi";
import { migrateCheck, renderMigrateCheck } from "@nexo-alpha/cli";

const Task = model("tasks", { title: field.string({ minLength: 1 }) });
const SECRET = "debugging-benchmark-secret-0123456789abcdef";
const quiet = { logging: false, handleSignals: false };

/** Detection stages, best first. */
export const STAGES = ["startup", "request", "check", "none"];

const messageOf = (error) => [error?.message, error?.code].filter(Boolean).join(" ");

/** Runs `start`; a throw is a mistake caught at startup. Stops whatever did start. */
async function atStartup(start) {
  let started;
  try {
    started = await start();
  } catch (error) {
    return { stage: "startup", message: messageOf(error) };
  }
  await started?.stop?.();
  return undefined;
}

/** What a client is told for one request; an answer of `ok` means the mistake went unnoticed. */
async function answer(url, init, ok) {
  const response = await fetch(url, init);
  const body = await response.text();
  return ok(response.status) ? { stage: "none", message: `${response.status} ${body}` } : { stage: "request", message: `${response.status} ${body}` };
}

const startBefore = async (modules, port, options = {}) => {
  const app = createApplication({ name: "debugging" });
  for (const module of modules) app.module(module);
  await app.start();
  try {
    const server = await startHapiServer(app, { port, logging: false, ...options });
    return { url: server.info.uri, stop: async () => { await server.stop(); await app.stop(); } };
  } catch (error) {
    await app.stop();
    throw error;
  }
};

const token = (scopes) => `Bearer ${signToken({ sub: "u1", scopes }, SECRET, { expiresInSeconds: 60 })}`;

/** Hand-written create API with a schema and a scope, as before model()/resource(). */
const handWrittenTasks = (store, auth) => ({
  name: "tasks",
  apis: [
    {
      name: "createTask",
      method: "POST",
      path: "/api/tasks",
      ...(auth ? { auth: { required: true, scopes: ["tasks:write"] } } : {}),
      schema: { body: { type: "object", required: ["title"], properties: { title: { type: "string", minLength: 1 } } } },
      handler: async (context) => {
        const task = { id: crypto.randomUUID(), title: context.payload.title };
        await store.put("tasks", task.id, task);
        return task;
      }
    }
  ]
});

export const SCENARIOS = [
  {
    id: "missing-auth-secret",
    title: "Sign-in configured without a secret",
    kind: "configuration",
    criteria: { cause: /secret/i, where: /AUTH_SECRET|secret:/, fix: /at least 32 bytes|set AUTH_SECRET/i },
    before: (ctx) => atStartup(async () => {
      const store = createInMemoryDocumentStore();
      return startBefore([createAuth({ store, secret: process.env.AUTH_SECRET })], ctx.port);
    }),
    after: (ctx) => atStartup(() => serve({ ...quiet, port: ctx.port, store: createInMemoryDocumentStore(), auth: true }))
  },
  {
    id: "protected-api-no-authenticator",
    title: "A protected API, but no way to check sign-ins",
    kind: "configuration",
    // "where" was /tasks/ in the first run, which missed the hand-written API's name ("createTask");
    // corrected to "names the API", which credits the before variant. See DEBUGGING.md.
    criteria: { cause: /requires auth|authenticat/i, where: /API "[^"]+"/, fix: /authenticate|setAuthenticator|auth:/ },
    before: (ctx) => atStartup(() => startBefore([handWrittenTasks(createInMemoryDocumentStore(), true)], ctx.port)),
    after: (ctx) =>
      atStartup(() => serve({ ...quiet, port: ctx.port, store: createInMemoryDocumentStore(), resources: [(store) => resource(Task, { store, auth: true })] }))
  },
  {
    id: "database-location-unusable",
    title: "The database path can't be created (a file is in the way)",
    kind: "database",
    criteria: { cause: /ENOTDIR|EEXIST|not a directory|file already exists/i, where: /blocked/, fix: /store:|path|directory/i },
    setup: async (ctx) => writeFile(join(ctx.dir, "blocked"), "a file where a folder should be"),
    before: (ctx) => atStartup(async () => {
      const store = await createSqliteDocumentStore(join(ctx.dir, "blocked", "app.db"));
      return startBefore([resource(Task, { store })], ctx.port);
    }),
    after: (ctx) => atStartup(() => serve({ ...quiet, port: ctx.port, store: join(ctx.dir, "blocked", "app.db"), resources: [Task] }))
  },
  {
    id: "port-in-use",
    title: "The port is already taken",
    kind: "configuration",
    criteria: { cause: /EADDRINUSE|in use/i, where: (ctx) => new RegExp(String(ctx.port)), fix: /PORT|port/ },
    setup: async (ctx) => {
      ctx.blocker = createServer();
      await new Promise((resolve) => ctx.blocker.listen(ctx.port, "localhost", resolve));
    },
    teardown: async (ctx) => new Promise((resolve) => ctx.blocker.close(resolve)),
    before: (ctx) => atStartup(() => startBefore([handWrittenTasks(createInMemoryDocumentStore(), false)], ctx.port)),
    after: (ctx) => atStartup(() => serve({ ...quiet, port: ctx.port, store: createInMemoryDocumentStore(), resources: [Task] }))
  },
  {
    id: "missing-scope",
    title: "A signed-in user without the scope a write needs",
    kind: "authorization",
    criteria: { cause: /forbidden|scope/i, where: /tasks:write/, fix: /missing|requires|needs/i },
    before: async (ctx) => {
      const app = await startBefore([handWrittenTasks(createInMemoryDocumentStore(), true)], ctx.port, { authenticate: jwtAuthenticator({ secret: SECRET }) });
      try {
        return await answer(`${app.url}/api/tasks`, { method: "POST", headers: { authorization: token(["tasks:read"]), "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) }, (s) => s < 400);
      } finally {
        await app.stop();
      }
    },
    after: async (ctx) => {
      const app = await serve({
        ...quiet,
        port: ctx.port,
        store: createInMemoryDocumentStore(),
        authenticate: jwtAuthenticator({ secret: SECRET }),
        resources: [(store) => resource(Task, { store, auth: { read: ["tasks:read"], write: ["tasks:write"] } })]
      });
      try {
        return await answer(`${app.url}/api/tasks`, { method: "POST", headers: { authorization: token(["tasks:read"]), "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) }, (s) => s < 400);
      } finally {
        await app.stop();
      }
    }
  },
  {
    id: "field-typo",
    title: "A client sends a misspelled field (titel)",
    kind: "client mistake",
    criteria: { cause: /titel/, where: /body\.titel|"titel"/, fix: /not a field|unknown|title/i },
    before: async (ctx) => {
      const app = await startBefore([handWrittenTasks(createInMemoryDocumentStore(), false)], ctx.port);
      try {
        return await answer(`${app.url}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "x", title: "x" }) }, (s) => s < 400);
      } finally {
        await app.stop();
      }
    },
    after: async (ctx) => {
      const app = await serve({ ...quiet, port: ctx.port, store: createInMemoryDocumentStore(), resources: [Task] });
      try {
        return await answer(`${app.url}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "x", title: "x" }) }, (s) => s < 400);
      } finally {
        await app.stop();
      }
    }
  },
  {
    id: "model-changed-without-migration",
    title: "A field renamed in the model; stored records still use the old name",
    kind: "data drift",
    criteria: { cause: /name|title/, where: /tasks\//, fix: /migration/i },
    setup: async (ctx) => {
      // Records written when the model had `name`; the model now says `title`.
      await mkdir(ctx.dir, { recursive: true });
      const store = createFileDocumentStore(join(ctx.dir, "app.json"));
      await store.put("tasks", "t1", { id: "t1", name: "Old task", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
      await store.close();
    },
    // Before migrations existed: start the app and use it; does anything report the old records?
    before: async (ctx) => {
      const store = createFileDocumentStore(join(ctx.dir, "app.json"));
      const app = await startBefore([resource(Task, { store })], ctx.port);
      try {
        return await answer(`${app.url}/api/tasks`, {}, (s) => s < 400);
      } finally {
        await app.stop();
        await store.close();
      }
    },
    // With migrations: the check a developer runs (nexo migrate check).
    after: async (ctx) => {
      const app = createApplication({ name: "debugging" });
      app.module(resource(Task, { store: createInMemoryDocumentStore() }));
      const result = await migrateCheck({ app, store: "app.json", cwd: ctx.dir });
      return { stage: result.problems.length > 0 ? "check" : "none", message: renderMigrateCheck(result) };
    }
  }
];

/** Scores an outcome against a scenario's criteria. */
export function score(scenario, outcome, ctx) {
  const outcomeOrNone = outcome ?? { stage: "none", message: "(no error: it started and ran)" };
  const test = (criterion) => (typeof criterion === "function" ? criterion(ctx) : criterion).test(outcomeOrNone.message);
  const met = outcomeOrNone.stage === "none" ? { cause: false, where: false, fix: false } : {
    cause: test(scenario.criteria.cause),
    where: test(scenario.criteria.where),
    fix: test(scenario.criteria.fix)
  };
  return { ...outcomeOrNone, met, points: Object.values(met).filter(Boolean).length };
}

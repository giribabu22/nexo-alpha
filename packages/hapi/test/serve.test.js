/** serve(): models in, a running server out; each default can be replaced. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NexoConfigurationError,
  createApplication,
  createInMemoryBlobStore,
  createInMemoryDocumentStore,
  field,
  model,
  resource
} from "@nexo-alpha/core";
import { serve } from "../dist/index.js";

const Task = model("tasks", { title: field.string({ minLength: 1 }), done: field.boolean().default(false) });
const Note = model("notes", { text: field.string() });

const quiet = { port: 0, logging: false, handleSignals: false };

async function call(app, method, path, payload, token) {
  const response = await fetch(app.url + path, {
    method,
    headers: {
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

test("a model becomes a CRUD API on a running server", async () => {
  const app = await serve({ ...quiet, store: ":memory:", resources: [Task] });
  try {
    const created = await call(app, "POST", "/api/tasks", { title: "Write tests" });
    assert.equal(created.status, 201);
    assert.equal(created.body.done, false);
    assert.equal((await call(app, "POST", "/api/tasks", { title: "" })).status, 400);

    await app.resource(Task).create({ title: "From server code" });
    const listed = await call(app, "GET", "/api/tasks?sort=title");
    assert.deepEqual(listed.body.items.map((task) => task.title), ["From server code", "Write tests"]);
    assert.equal(app.app.state, "running");
  } finally {
    await app.stop();
  }
  assert.equal(app.app.state, "stopped");
  await app.stop(); // a second stop is a no-op
});

test("escape hatches: a resource with options, hand-written modules, a store and an app of your own", async () => {
  const store = createInMemoryDocumentStore();
  const own = createApplication({ name: "own" });
  const app = await serve({
    ...quiet,
    app: own,
    store,
    resources: [Task, (s) => resource(Note, { store: s, searchable: ["text"], expose: ["list", "create"] })],
    modules: [{ name: "status", apis: [{ name: "status", method: "GET", path: "/api/status", handler: async () => ({ ok: true }) }] }]
  });
  try {
    assert.equal(app.app, own);
    await call(app, "POST", "/api/notes", { text: "alpha" });
    await call(app, "POST", "/api/notes", { text: "beta" });
    assert.equal((await call(app, "GET", "/api/notes?search=alp")).body.total, 1);
    assert.equal((await call(app, "DELETE", "/api/notes/x")).status, 404);
    assert.deepEqual((await call(app, "GET", "/api/status")).body, { ok: true });
    assert.equal((await app.resource(Note).list()).total, 2);
    assert.equal((await store.list("notes")).length, 2);
    assert.throws(() => app.resource(model("others", { x: field.string() })), NexoConfigurationError);
  } finally {
    await app.stop();
  }
  // serve() did not open this store, so it leaves it open.
  assert.equal((await store.list("notes")).length, 2);
});

test("auth: accounts at /api/auth authenticate resources with auth", async () => {
  const app = await serve({
    ...quiet,
    store: ":memory:",
    auth: { secret: "serve-test-secret-0123456789abcdefghij" },
    resources: [(store) => resource(Task, { store, auth: true })]
  });
  try {
    assert.equal((await call(app, "GET", "/api/tasks")).status, 401);
    const { body } = await call(app, "POST", "/api/auth/register", { email: "ann@example.com", password: "correct horse" });
    assert.equal((await call(app, "GET", "/api/tasks", undefined, body.token)).status, 200);
    assert.ok(app.auth);
  } finally {
    await app.stop();
  }
});

test("auth without a secret is refused before anything starts", async () => {
  const saved = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  const own = createApplication({ name: "no-secret" });
  try {
    await assert.rejects(serve({ ...quiet, app: own, store: ":memory:", auth: true }), /AUTH_SECRET/);
    assert.equal(own.state, "created");
  } finally {
    if (saved !== undefined) process.env.AUTH_SECRET = saved;
  }
});

test("files: uploads at /api/files", async () => {
  const app = await serve({ ...quiet, store: ":memory:", files: { blobs: createInMemoryBlobStore() } });
  try {
    assert.ok(app.files);
    assert.ok(app.app.getApis().some((api) => api.path.startsWith("/api/files")));
  } finally {
    await app.stop();
  }
});

test("a .json store path keeps records across restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-serve-"));
  try {
    const first = await serve({ ...quiet, store: join(dir, "app.json"), resources: [Task] });
    await first.resource(Task).create({ title: "Survives" });
    await first.stop();

    const second = await serve({ ...quiet, store: join(dir, "app.json"), resources: [Task] });
    try {
      assert.equal((await call(second, "GET", "/api/tasks")).body.items[0].title, "Survives");
    } finally {
      await second.stop();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an app that brings its own resources: no database file is created", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-serve-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const own = createApplication({ name: "own-store" });
    own.module(resource(Task, { store: createInMemoryDocumentStore() }));
    const app = await serve({ ...quiet, app: own });
    try {
      assert.equal((await call(app, "POST", "/api/tasks", { title: "x" })).status, 201);
      assert.equal((await app.resource(Task).list()).total, 1);
    } finally {
      await app.stop();
    }
    assert.deepEqual(await readdir(dir), []);
  } finally {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("SIGINT stops the server and the application, then exits 0", () => {
  const script = `
    import { field, model } from "@nexo-alpha/core";
    import { serve } from "./dist/index.js";
    const app = await serve({ port: 0, logging: false, store: ":memory:", resources: [model("tasks", { title: field.string() })] });
    process.on("exit", (code) => console.log(JSON.stringify({ code, state: app.app.state })));
    process.emit("SIGINT");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { code: 0, state: "stopped" });
});

test("a failed start (port taken) stops the application again", async () => {
  const first = await serve({ ...quiet, store: ":memory:", resources: [Task] });
  const own = createApplication({ name: "second" });
  try {
    await assert.rejects(serve({ ...quiet, port: first.server.info.port, app: own, store: ":memory:", resources: [Task] }));
    assert.equal(own.state, "stopped");
  } finally {
    await first.stop();
  }
});

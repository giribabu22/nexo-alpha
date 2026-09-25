import test from "node:test";
import assert from "node:assert/strict";

import {
  createApplication,
  createInMemoryDocumentStore,
  createProjectApiModule,
  createProjectRegistry,
  createRequestContext,
  currentProjectId,
  isValidProjectId,
  runInProject,
  scopeByProject
} from "../dist/index.js";

test("runInProject: the project follows awaits and timers, and nests", async () => {
  assert.equal(currentProjectId(), undefined);
  await runInProject("acme", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(currentProjectId(), "acme");
    await runInProject("globex", async () => assert.equal(currentProjectId(), "globex"));
    assert.equal(currentProjectId(), "acme");
  });
  assert.equal(currentProjectId(), undefined);
  assert.throws(() => runInProject("Bad ID", () => 1), /Invalid project ID/);
  assert.equal(isValidProjectId("acme-2"), true);
  assert.equal(isValidProjectId("acme::x"), false);
});

test("scopeByProject: projects never see each other's documents", async () => {
  const raw = createInMemoryDocumentStore();
  const store = scopeByProject(raw);

  await runInProject("acme", () => store.put("runs", "r1", { owner: "acme" }));
  await runInProject("globex", () => store.put("runs", "r1", { owner: "globex" }));
  await store.put("runs", "r1", { owner: "unscoped" });

  assert.deepEqual(await runInProject("acme", () => store.get("runs", "r1")), { owner: "acme" });
  assert.deepEqual(await runInProject("globex", () => store.list("runs")), [{ owner: "globex" }]);
  assert.equal(await runInProject("initech", () => store.get("runs", "r1")), undefined);
  assert.deepEqual(await store.get("runs", "r1"), { owner: "unscoped" });

  const seen = await runInProject("acme", () => store.get("runs", "r1"));
  assert.equal(await runInProject("globex", () => store.replaceIf("runs", "r1", seen, { owner: "stolen" })), false);
  assert.equal(await runInProject("acme", () => store.delete("runs", "r1")), true);
  assert.deepEqual((await raw.list("globex::runs")).length, 1);
});

test("scopeByProject({ required: true }): operations outside a project fail loudly", async () => {
  const store = scopeByProject(createInMemoryDocumentStore(), { required: true });
  await assert.rejects(store.list("runs"), /No project in context/);
  assert.deepEqual(await runInProject("acme", () => store.list("runs")), []);
});

test("project registry: create, membership, roles and concurrent member updates", async () => {
  const registry = createProjectRegistry(createInMemoryDocumentStore());
  const acme = await registry.create({ id: "acme", name: " Acme Corp ", owner: "ann" });
  assert.equal(acme.name, "Acme Corp");
  assert.deepEqual(acme.members, { ann: ["owner"] });
  await registry.create({ id: "globex", name: "Globex", owner: "sam" });

  await assert.rejects(registry.create({ id: "acme", name: "Dup", owner: "x" }), /already exists/);
  await assert.rejects(registry.create({ id: "BAD", name: "x", owner: "x" }), /Invalid project ID/);

  await Promise.all(["u1", "u2", "u3", "u4"].map((user) => registry.setMember("acme", user, ["support"])));
  assert.deepEqual(Object.keys((await registry.get("acme")).members).sort(), ["ann", "u1", "u2", "u3", "u4"]);
  assert.deepEqual(await registry.rolesOf("acme", "u2"), ["support"]);
  assert.deepEqual(await registry.rolesOf("globex", "u2"), []);

  await registry.setMember("acme", "u1", []);
  assert.equal("u1" in (await registry.get("acme")).members, false);
  assert.deepEqual((await registry.list({ member: "sam" })).map((p) => p.id), ["globex"]);
  assert.equal(await registry.setMember("nope", "x", ["a"]), undefined);
});

test("project API: members-only visibility, owner-managed membership, last manager protected", async () => {
  const registry = createProjectRegistry(createInMemoryDocumentStore());
  const app = createApplication({ name: "projects" });
  app.module(createProjectApiModule({ registry, resolveUser: (ctx) => ctx.headers["x-user"] }));
  const as = (user, extra = {}) => createRequestContext({ headers: user ? { "x-user": user } : {}, ...extra });

  const created = await app.dispatch("createProject", as("ann", { payload: { id: "acme", name: "Acme" } }));
  assert.deepEqual(created.members, { ann: ["owner"] });
  await app.dispatch("createProject", as("sam", { payload: { id: "globex", name: "Globex" } }));

  assert.deepEqual((await app.dispatch("listProjects", as("ann"))).projects.map((p) => p.id), ["acme"]);
  await assert.rejects(app.dispatch("getProject", as("sam", { params: { id: "acme" } })), (error) => error.statusCode === 404);
  await assert.rejects(app.dispatch("listProjects", as(undefined)), (error) => error.statusCode === 401);

  await app.dispatch("setProjectMember", as("ann", { params: { id: "acme", user: "sam" }, payload: { roles: ["support"] } }));
  assert.equal((await app.dispatch("getProject", as("sam", { params: { id: "acme" } }))).id, "acme");
  await assert.rejects(
    app.dispatch("setProjectMember", as("sam", { params: { id: "acme", user: "sam" }, payload: { roles: ["owner"] } })),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    app.dispatch("setProjectMember", as("ann", { params: { id: "acme", user: "ann" }, payload: { roles: [] } })),
    (error) => error.statusCode === 409
  );
  await assert.rejects(app.dispatch("createProject", as("ann", { payload: { id: "Bad Id", name: "" } })), /validation failed/i);
});

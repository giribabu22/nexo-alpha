import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

import {
  createApplication,
  createInMemoryDocumentStore,
  createProjectApiModule,
  createProjectRegistry,
  currentProjectId
} from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";

import { createNexoClient, NexoApiError, NexoProjectSwitcher, NexoProvider, useNexoClient } from "../dist/index.js";

test("client.projects + projectId: create, list, members, and x-project-id on every request", async () => {
  const registry = createProjectRegistry(createInMemoryDocumentStore());
  const app = createApplication({ name: "projects-client" });
  app.module(createProjectApiModule({ registry, resolveUser: (context) => context.headers["x-user"] }));
  app.module({ name: "probe", apis: [{ name: "where", method: "GET", path: "/where", handler: () => ({ project: currentProjectId() ?? null }) }] });
  const server = await startHapiServer(app, {
    port: 0,
    logging: false,
    bindLifecycle: false,
    project: {
      resolve: (context) => context.headers["x-project-id"],
      required: false,
      skip: (api) => api.name !== "where"
    }
  });
  try {
    const ann = createNexoClient({ baseUrl: server.info.uri, headers: { "x-user": "ann" } });
    const created = await ann.projects.create({ id: "acme", name: "Acme" });
    assert.deepEqual(created.members, { ann: ["owner"] });
    assert.deepEqual((await ann.projects.list()).map((p) => p.id), ["acme"]);
    assert.deepEqual((await ann.projects.setMember("acme", "sam", ["support"])).members.sam, ["support"]);

    const sam = createNexoClient({ baseUrl: server.info.uri, headers: { "x-user": "sam" } });
    assert.equal((await sam.projects.get("acme")).name, "Acme");
    await assert.rejects(sam.projects.setMember("acme", "sam", ["owner"]), (error) => error instanceof NexoApiError && error.status === 403);

    assert.deepEqual(await ann.get("/where"), { project: null });
    const inAcme = ann.forProject("acme");
    assert.equal(inAcme.projectId, "acme");
    assert.deepEqual(await inAcme.get("/where"), { project: "acme" });
    assert.deepEqual(await inAcme.forProject(undefined).get("/where"), { project: null });
  } finally {
    await server.stop();
  }
});

test("NexoProvider passes every client option through, including projectId and API paths", () => {
  let seen;
  function Probe() {
    seen = useNexoClient();
    return null;
  }
  renderToString(React.createElement(NexoProvider, {
    baseUrl: "http://api.example",
    projectId: "acme",
    workflowsPath: "/v1/flows",
    memoryPath: "/v1/memory",
    projectsPath: "/v1/projects"
  }, React.createElement(Probe)));
  assert.equal(seen.projectId, "acme");

  const base = createNexoClient({ baseUrl: "http://api.example" });
  renderToString(React.createElement(NexoProvider, { client: base, projectId: "globex" }, React.createElement(Probe)));
  assert.equal(seen.projectId, "globex");
  assert.equal(base.projectId, undefined);
});

test("NexoProjectSwitcher: renders projects with the active one selected, and the create form when allowed", () => {
  const projects = [
    { id: "acme", name: "Acme", members: {}, createdAt: "", updatedAt: "" },
    { id: "globex", name: "Globex", members: {}, createdAt: "", updatedAt: "" }
  ];
  const html = renderToString(React.createElement(NexoProjectSwitcher, { projects, value: "globex", onChange: () => {} }));
  assert.match(html, /<option value="acme">Acme \(acme\)<\/option>/);
  assert.match(html, /<option value="globex" selected="">/);
  assert.ok(!html.includes("New project ID"));

  const connected = renderToString(
    React.createElement(NexoProvider, { baseUrl: "http://localhost:0" }, React.createElement(NexoProjectSwitcher, { onChange: () => {}, allowCreate: true }))
  );
  assert.ok(connected.includes("Select a project"));
  assert.ok(connected.includes("New project ID"));
});

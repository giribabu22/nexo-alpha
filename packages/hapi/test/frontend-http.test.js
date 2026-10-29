/** createHapiServer({ frontend }): a built browser app served next to the API. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { NexoConfigurationError, api, createApplication, createInMemoryDocumentStore, field, model, resource } from "@nexo-alpha/core";
import { createHapiServer, serve } from "../dist/index.js";

const Note = model("notes", { text: field.string() });
const PAGE = "<!doctype html><title>app</title><div id=root></div>";

async function withDist(run) {
  const root = await mkdtemp(join(tmpdir(), "nexo-frontend-"));
  const dist = join(root, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), PAGE);
  await writeFile(join(dist, "assets", "app.js"), "console.log('app');");
  await writeFile(join(dist, ".env"), "SECRET=1");
  await writeFile(join(root, "secret.txt"), "outside");
  try {
    await run(dist);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function server(dist) {
  const app = createApplication({ name: "frontend-app" });
  app.module(resource(Note, { store: createInMemoryDocumentStore() }));
  app.module({ name: "home", apis: [api.get("/api/hello", () => ({ hello: true }))] });
  return createHapiServer(app, { logging: false, frontend: dist });
}

const html = { accept: "text/html,application/xhtml+xml" };

test("files are served at their paths, the app at /", async () => {
  await withDist(async (dist) => {
    const s = await server(dist);
    const root = await s.inject({ url: "/", headers: html });
    assert.equal(root.statusCode, 200);
    assert.equal(root.payload, PAGE);
    assert.match(root.headers["content-type"], /text\/html/);

    const script = await s.inject("/assets/app.js");
    assert.equal(script.statusCode, 200);
    assert.match(script.headers["content-type"], /javascript/);
    assert.ok(script.headers.etag);
  });
});

test("a page load of a client-side route gets index.html; other misses stay 404", async () => {
  await withDist(async (dist) => {
    const s = await server(dist);
    const page = await s.inject({ url: "/notes/42", headers: html });
    assert.equal(page.statusCode, 200);
    assert.equal(page.payload, PAGE);
    assert.ok(page.headers["x-request-id"]);

    assert.equal((await s.inject({ url: "/assets/missing.js", headers: { accept: "*/*" } })).statusCode, 404);
    assert.equal((await s.inject({ method: "POST", url: "/notes/42", headers: html })).statusCode, 404);
  });
});

test("API routes take precedence over files", async () => {
  await withDist(async (dist) => {
    const s = await server(dist);
    assert.deepEqual(JSON.parse((await s.inject({ url: "/api/hello", headers: html })).payload), { hello: true });
    const created = await s.inject({ method: "POST", url: "/api/notes", payload: { text: "hi" } });
    assert.equal(created.statusCode, 201);
    assert.equal(JSON.parse((await s.inject("/api/notes")).payload).total, 1);
  });
});

test("nothing outside the directory, and no dotfiles", async () => {
  await withDist(async (dist) => {
    const s = await server(dist);
    for (const url of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/.env"]) {
      const response = await s.inject({ url, headers: { accept: "*/*" } });
      assert.notEqual(response.statusCode, 200, url);
      assert.doesNotMatch(response.payload, /outside|SECRET/, url);
    }
  });
});

test("a directory without index.html is refused", async () => {
  const empty = await mkdtemp(join(tmpdir(), "nexo-frontend-empty-"));
  try {
    await assert.rejects(server(empty), NexoConfigurationError);
    await assert.rejects(server(join(empty, "missing")), /Build the frontend first/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("serve({ frontend }) serves the app and its API from one port; a file URL works", async () => {
  await withDist(async (dist) => {
    const app = await serve({ port: 0, logging: false, handleSignals: false, store: ":memory:", resources: [Note], frontend: pathToFileURL(dist + "/") });
    try {
      assert.equal(await (await fetch(app.url + "/notes", { headers: html })).text(), PAGE);
      assert.equal((await fetch(app.url + "/api/notes")).status, 200);
    } finally {
      await app.stop();
    }
  });
});

/**
 * serve() end to end, over real HTTP: one app that uses every part at once,
 * each with a non-default setting (SQLite file, scoped auth, an ownership
 * rule, disk uploads, a hand-written route, security headers, rate limits,
 * the frontend), then restarted on the same files.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NexoHttpError, api, field, model, resource } from "@nexo-alpha/core";
import { serve } from "../dist/index.js";

const SECRET = "serve-e2e-test-secret-0123456789abcdefghij";
const PAGE = "<!doctype html><title>notes</title>";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const Note = model("notes", {
  text: field.string({ minLength: 1 }),
  owner: field.string().optional(),
  attachment: field.file({ accept: ["image/*"] }).optional()
});

function start(dir) {
  return serve({
    name: "notes-e2e",
    port: 0,
    logging: false,
    handleSignals: false,
    store: join(dir, "data", "app.db"),
    auth: { secret: SECRET, defaultScopes: ["notes:read", "notes:write"] },
    files: { directory: join(dir, "data", "files"), accept: ["image/*"] },
    resources: [
      (store) => resource(Note, {
        store,
        auth: { read: ["notes:read"], write: ["notes:write"], delete: ["notes:admin"] },
        beforeWrite: (note, { operation, existing, request }) => {
          const user = request?.auth?.identity?.sub;
          if (operation === "update" && existing?.owner !== user) throw new NexoHttpError(403, "FORBIDDEN", "Not your note.");
          return operation === "create" && user !== undefined ? { ...note, owner: user } : note;
        }
      })
    ],
    modules: [{ name: "ping", apis: [api.get("/api/ping", () => ({ ok: true }))] }],
    frontend: join(dir, "dist"),
    securityHeaders: true,
    rateLimit: { windowMs: 60_000, max: 1000 }
  });
}

function client(base) {
  return async (method, path, { body, token, raw, type, accept } = {}) => {
    const headers = {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(type ? { "content-type": type } : {}),
      ...(accept ? { accept } : {})
    };
    const response = await fetch(base + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const json = /json/.test(response.headers.get("content-type") ?? "") ? JSON.parse(bytes.toString()) : undefined;
    return { status: response.status, headers: response.headers, json, bytes };
  };
}

test("one serve() call: CRUD, validation, scopes, ownership, uploads, custom route, frontend, restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-serve-e2e-"));
  await mkdir(join(dir, "dist"));
  await writeFile(join(dir, "dist", "index.html"), PAGE);
  try {
    const app = await start(dir);
    const call = client(app.url);
    let annId;
    try {
      // Accounts
      const ann = (await call("POST", "/api/auth/register", { body: { email: "ann@example.com", password: "correct horse" } })).json;
      const bob = (await call("POST", "/api/auth/register", { body: { email: "bob@example.com", password: "battery staple" } })).json;
      annId = ann.user.id;

      // Authentication and validation
      assert.equal((await call("GET", "/api/notes")).status, 401);
      const invalid = await call("POST", "/api/notes", { token: ann.token, body: { text: "" } });
      assert.equal(invalid.status, 400);
      assert.deepEqual(invalid.json.errors, ['Field "body.text" must have length >= 1, got 0.']);

      // Create: the hook stamps the owner
      const created = await call("POST", "/api/notes", { token: ann.token, body: { text: "hello" } });
      assert.equal(created.status, 201);
      assert.equal(created.json.owner, ann.user.id);
      const id = created.json.id;

      // Upload, attach, download
      const uploaded = await call("POST", "/api/files?name=photo.png", { token: ann.token, raw: PNG, type: "image/png" });
      assert.equal(uploaded.status, 201);
      const attached = await call("PATCH", `/api/notes/${id}`, { token: ann.token, body: { attachment: uploaded.json.id } });
      assert.equal(attached.status, 200);
      const download = await call("GET", uploaded.json.url, { token: ann.token });
      assert.equal(download.status, 200);
      assert.deepEqual(download.bytes, PNG);
      assert.equal((await call("POST", "/api/files?name=x.txt", { token: ann.token, raw: "text", type: "text/plain" })).status, 415);

      // Update: the ownership rule and scopes
      assert.equal((await call("PATCH", `/api/notes/${id}`, { token: bob.token, body: { text: "mine now" } })).status, 403);
      assert.equal((await call("PATCH", `/api/notes/${id}`, { token: ann.token, body: { text: "edited" } })).json.text, "edited");
      const listed = await call("GET", "/api/notes?sort=-createdAt", { token: bob.token });
      assert.deepEqual(listed.json.items.map((note) => note.text), ["edited"]);

      // Delete needs notes:admin
      assert.equal((await call("DELETE", `/api/notes/${id}`, { token: ann.token })).status, 403);
      await app.auth.setScopes(ann.user.id, ["notes:read", "notes:write", "notes:admin"]);
      assert.equal((await call("DELETE", `/api/notes/${id}`, { token: ann.token })).status, 204);
      assert.equal((await call("GET", `/api/notes/${id}`, { token: ann.token })).status, 404);

      // A hand-written route, with the server settings applied
      const ping = await call("GET", "/api/ping");
      assert.deepEqual(ping.json, { ok: true });
      assert.equal(ping.headers.get("x-frame-options"), "DENY");
      assert.equal(ping.headers.get("ratelimit-limit"), "1000");

      // The frontend on the same port
      const page = await call("GET", "/notes/42", { accept: "text/html" });
      assert.equal(page.bytes.toString(), PAGE);
      assert.equal(page.headers.get("x-frame-options"), "DENY");

      // Server code uses the same resource
      await app.resource(Note).create({ text: "from server code", owner: ann.user.id });
    } finally {
      await app.stop();
    }
    await assert.rejects(fetch(app.url + "/api/ping"));

    // Restart on the same files: accounts and records survived
    const again = await start(dir);
    try {
      const call2 = client(again.url);
      const login = await call2("POST", "/api/auth/login", { body: { email: "ann@example.com", password: "correct horse" } });
      assert.equal(login.status, 200);
      assert.deepEqual(login.json.user.scopes, ["notes:read", "notes:write", "notes:admin"]);
      const notes = await call2("GET", "/api/notes", { token: login.json.token });
      assert.deepEqual(notes.json.items.map((note) => [note.text, note.owner]), [["from server code", annId]]);
    } finally {
      await again.stop();
    }
    assert.ok((await readdir(join(dir, "data"))).includes("app.db"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

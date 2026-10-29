/**
 * Every feature's "before" and "after" backends must pass the same HTTP
 * checks, so the line counts in RESULTS.md compare equal behavior. The
 * frontend pages are rendered once to make sure they run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";

import { createApplication, createInMemoryDocumentStore, jwtAuthenticator, signToken } from "@nexo-alpha/core";
import { createHapiServer } from "@nexo-alpha/hapi";

const SECRET = "code-to-intent-benchmark-secret-0123456789";
const VARIANTS = ["before", "after"];

async function serve(feature, file, variant) {
  const { modules } = await import(`../dist/${feature}/${variant}/${file}`);
  const app = createApplication({ name: `${feature}-${variant}` });
  for (const module of modules(createInMemoryDocumentStore())) app.module(module);
  const server = await createHapiServer(app, { logging: false, authenticate: jwtAuthenticator({ secret: SECRET }) });
  const call = async (method, url, payload, headers) => {
    const response = await server.inject({ method, url, ...(payload !== undefined ? { payload } : {}), ...(headers ? { headers } : {}) });
    return { status: response.statusCode, body: response.payload === "" ? undefined : JSON.parse(response.payload) };
  };
  return call;
}

const items = (body) => (Array.isArray(body) ? body : body.items);

async function serveAuth(variant) {
  const { setup } = await import(`../dist/authentication/${variant}/auth.api.js`);
  const { modules, authenticate } = setup(createInMemoryDocumentStore(), SECRET);
  const app = createApplication({ name: `authentication-${variant}` });
  for (const module of modules) app.module(module);
  const server = await createHapiServer(app, { logging: false, authenticate });
  return async (method, url, payload, token) => {
    const response = await server.inject({
      method,
      url,
      ...(payload !== undefined ? { payload } : {}),
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
    });
    return { status: response.statusCode, body: response.payload === "" ? undefined : JSON.parse(response.payload) };
  };
}

for (const variant of VARIANTS) {
  test(`[${variant}] GET API`, async () => {
    const call = await serve("get-api", "status.api.js", variant);
    assert.deepEqual(await call("GET", "/api/status"), { status: 200, body: { status: "ok" } });
  });

  test(`[${variant}] authenticated, validated POST`, async () => {
    const call = await serve("validated-post", "invitations.api.js", variant);
    const token = (scopes) => ({ authorization: `Bearer ${signToken({ sub: "u", scopes }, SECRET, { expiresInSeconds: 60 })}` });
    const writer = token(["invites:write"]);

    assert.equal((await call("POST", "/api/invitations", { email: "a@example.com" })).status, 401);
    assert.equal((await call("POST", "/api/invitations", { email: "a@example.com" }, token(["invites:read"]))).status, 403);
    assert.equal((await call("POST", "/api/invitations", { email: "not-an-email" }, writer)).status, 400);
    assert.equal((await call("POST", "/api/invitations", { email: "a@example.com", role: "owner" }, writer)).status, 400);

    assert.equal((await call("POST", "/api/invitations", { email: "sam.smith@sales.example.com" }, writer)).status, 201);
    const created = await call("POST", "/api/invitations", { email: "a@example.com" }, writer);
    assert.equal(created.status, 201);
    assert.equal(created.body.role, "member");
    assert.ok(created.body.id && created.body.createdAt && created.body.updatedAt);
  });

  test(`[${variant}] user CRUD`, async () => {
    const call = await serve("user-crud", "users.api.js", variant);

    assert.equal((await call("POST", "/api/users", { email: "ann@example.com" })).status, 400);
    assert.equal((await call("POST", "/api/users", { name: "Ann", email: "nope" })).status, 400);

    // An address with an "s": catches email patterns that lost their backslashes.
    assert.equal((await call("POST", "/api/users", { name: "Sam", email: "sam.smith@sales.example.com" })).status, 201);
    const created = await call("POST", "/api/users", { name: "Ann", email: "ann@example.com" });
    assert.equal(created.status, 201);
    const ann = created.body;
    assert.equal(ann.role, "member");

    assert.deepEqual(await call("GET", `/api/users/${ann.id}`), { status: 200, body: ann });
    assert.deepEqual(items((await call("GET", "/api/users")).body).find((user) => user.id === ann.id), ann);

    const updated = await call("PATCH", `/api/users/${ann.id}`, { role: "admin" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.role, "admin");
    assert.equal(updated.body.name, "Ann");
    assert.equal(updated.body.id, ann.id);
    assert.equal((await call("PATCH", `/api/users/${ann.id}`, { role: "owner" })).status, 400);

    assert.equal((await call("DELETE", `/api/users/${ann.id}`)).status, 204);
    assert.equal((await call("GET", `/api/users/${ann.id}`)).status, 404);
    assert.equal((await call("PATCH", `/api/users/${ann.id}`, { name: "X" })).status, 404);
    assert.equal((await call("DELETE", `/api/users/${ann.id}`)).status, 404);
  });

  test(`[${variant}] search, filter and pagination`, async () => {
    const call = await serve("product-search", "products.api.js", variant);
    const catalog = [["Hammer", 12, "tools"], ["Hand saw", 20, "tools"], ["Kite", 30, "toys"], ["Handbook", 9, "books"], ["Drill", 80, "tools"]];
    for (const [name, price, category] of catalog) {
      assert.equal((await call("POST", "/api/products", { name, price, category })).status, 201);
    }
    assert.equal((await call("POST", "/api/products", { name: "Bad", price: -1, category: "tools" })).status, 400);

    const search = (await call("GET", "/api/products?search=HAN")).body;
    assert.deepEqual(search.items.map((p) => p.name), ["Hand saw", "Handbook"]);
    assert.equal(search.total, 2);

    const tools = (await call("GET", "/api/products?category=tools&limit=2&offset=1")).body;
    assert.deepEqual({ total: tools.total, limit: tools.limit, offset: tools.offset }, { total: 3, limit: 2, offset: 1 });
    assert.deepEqual(tools.items.map((p) => p.name), ["Hand saw", "Drill"]);

    assert.equal((await call("GET", "/api/products?limit=abc")).status, 400);
  });

  test(`[${variant}] relationship: orders reference existing customers`, async () => {
    const call = await serve("relationship", "orders.api.js", variant);
    const ann = (await call("POST", "/api/customers", { name: "Ann" })).body;
    const bob = (await call("POST", "/api/customers", { name: "Bob" })).body;

    assert.equal((await call("POST", "/api/orders", { customerId: "ghost", total: 5 })).status, 400);
    assert.equal((await call("POST", "/api/orders", { customerId: ann.id, total: -5 })).status, 400);
    assert.equal((await call("POST", "/api/orders", { customerId: ann.id, total: 5 })).status, 201);
    assert.equal((await call("POST", "/api/orders", { customerId: bob.id, total: 7 })).status, 201);

    const annOrders = items((await call("GET", `/api/orders?customerId=${ann.id}`)).body);
    assert.deepEqual(annOrders.map((o) => o.total), [5]);
  });

  test(`[${variant}] authentication: register, login, me, logout`, async () => {
    const call = await serveAuth(variant);
    assert.equal((await call("POST", "/api/auth/register", { email: "x", password: "short" })).status, 400);

    const registered = await call("POST", "/api/auth/register", { email: "Ann@Example.com", password: "correct horse" });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.email, "ann@example.com");
    assert.equal(registered.body.user.passwordHash, undefined);
    assert.equal((await call("POST", "/api/auth/register", { email: "ann@example.com", password: "another one" })).status, 409);

    assert.equal((await call("POST", "/api/auth/login", { email: "ann@example.com", password: "wrong password" })).status, 401);
    assert.equal((await call("POST", "/api/auth/login", { email: "bob@example.com", password: "correct horse" })).status, 401);
    const { token } = (await call("POST", "/api/auth/login", { email: "ann@example.com", password: "correct horse" })).body;

    const me = await call("GET", "/api/auth/me", undefined, token);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "ann@example.com");
    assert.equal((await call("GET", "/api/auth/me")).status, 401);
    assert.equal((await call("POST", "/api/auth/logout", undefined, token)).status, 204);
    assert.equal((await call("GET", "/api/auth/me", undefined, token)).status, 401, "logout revokes the token");
    assert.equal((await call("GET", "/api/auth/me", undefined, registered.body.token)).status, 200, "other sessions stay");
  });

  test(`[${variant}] file upload and download`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), `nexo-files-${variant}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { modules } = await import(`../dist/file-upload/${variant}/files.api.js`);
    const app = createApplication({ name: `files-${variant}` });
    for (const module of modules(createInMemoryDocumentStore(), directory)) app.module(module);
    const server = await createHapiServer(app, { logging: false });

    // The one difference: before, handlers only got parsed JSON, so files travel base64-encoded.
    const upload = (bytes, type, name) =>
      variant === "before"
        ? server.inject({ method: "POST", url: "/api/files", payload: { name, type, data: Buffer.from(bytes).toString("base64") } })
        : server.inject({ method: "POST", url: `/api/files?name=${encodeURIComponent(name)}`, payload: Buffer.from(bytes), headers: { "content-type": type } });

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    const created = await upload(png, "image/png", "dir/photo.png");
    assert.equal(created.statusCode, 201);
    const file = JSON.parse(created.payload);
    assert.deepEqual([file.name, file.type, file.size, file.url], ["photo.png", "image/png", 6, `/api/files/${file.id}`]);
    assert.equal(created.headers.location, file.url);

    const download = await server.inject(file.url);
    assert.deepEqual(download.rawPayload, png);
    assert.equal(download.headers["content-type"], "image/png");
    assert.equal(download.headers["x-content-type-options"], "nosniff");
    assert.match(download.headers["content-disposition"], /^inline/);

    const svg = JSON.parse((await upload("<svg onload=alert(1)>", "image/svg+xml", "x.svg")).payload);
    assert.match((await server.inject(svg.url)).headers["content-disposition"], /^attachment/);

    assert.equal((await upload(Buffer.alloc(0), "image/png", "empty.png")).statusCode, 400);
    assert.equal((await upload(Buffer.alloc(600 * 1024), "image/png", "big.png")).statusCode, 201);
    assert.equal((await upload("<html>", "text/html", "x.html")).statusCode, 415);
    assert.equal((await server.inject("/api/files/no-such-file")).statusCode, 404);
  });

  test(`[${variant}] app startup: SQLite store, API on $PORT, records kept across a restart`, async () => {
    const { start } = await import(`../dist/app-startup/${variant}/server.js`);
    const dir = await mkdtemp(join(tmpdir(), "code-to-intent-startup-"));
    const cwd = process.cwd();
    process.chdir(dir);
    process.env.PORT = "0";
    try {
      const first = await start();
      const post = (body) => fetch(`${first.url}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal((await post({ title: "Ship it" })).status, 201);
      assert.equal((await post({ title: "" })).status, 400);
      await first.stop();
      await assert.rejects(fetch(`${first.url}/api/tasks`));

      const second = await start();
      const list = await (await fetch(`${second.url}/api/tasks`)).json();
      assert.deepEqual(list.items.map((task) => [task.title, task.done]), [["Ship it", false]]);
      await second.stop();
      assert.deepEqual(await readdir(join(dir, "data")).then((files) => files.includes("app.db")), true);
    } finally {
      delete process.env.PORT;
      process.chdir(cwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(`[${variant}] pages render`, async () => {
    const { UsersPage } = await import(`../dist/user-crud/${variant}/users.page.js`);
    const { ProductsPage } = await import(`../dist/product-search/${variant}/products.page.js`);
    assert.ok(renderToString(React.createElement(UsersPage)).includes("Create"));
    assert.ok(renderToString(React.createElement(ProductsPage)).includes("Search products"));
    const { LoginPage } = await import(`../dist/authentication/${variant}/login.page.js`);
    assert.ok(renderToString(React.createElement(LoginPage)).includes('type="password"'));
  });
}

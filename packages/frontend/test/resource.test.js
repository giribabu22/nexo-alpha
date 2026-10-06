/**
 * Full stack, end to end: one model drives the server resource (core),
 * the HTTP API (hapi), the typed client and the React components.
 * Frontend client → HTTP → resource() → document store, and back.
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

import { createApplication, createInMemoryDocumentStore, model, field, resource } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";

import {
  createNexoClient,
  createQuery,
  NexoApiError,
  NexoProvider,
  useNexoClient,
  NexoForm,
  NexoTable,
  NexoResourceTable,
  NexoStack,
  NexoGrid,
  NexoEmptyState,
  NexoErrorState,
  NexoApp,
  page,
  formatCell
} from "../dist/index.js";
import * as clientEntry from "../dist/client-entry.js";

// The model is the only definition of a product: server and client share it.
const Product = model("products", {
  name: field.string({ minLength: 1 }),
  price: field.number({ min: 0 }),
  category: field.enum(["tools", "toys"]).default("tools"),
  inStock: field.boolean().default(true),
  description: field.text().optional()
});

async function startServer() {
  const store = createInMemoryDocumentStore();
  const products = resource(Product, { store, searchable: ["name"] });
  const app = createApplication({ name: "shop" });
  app.module(products);
  const server = await startHapiServer(app, { port: 0, logging: false, bindLifecycle: false });
  return { server, products, client: createNexoClient({ baseUrl: server.info.uri }) };
}

test("client.resource(): typed CRUD over HTTP against resource()", async (t) => {
  const { server, products, client } = await startServer();
  t.after(() => server.stop());
  const api = client.resource(Product);

  const hammer = await api.create({ name: "Hammer", price: 12 });
  assert.equal(hammer.category, "tools");
  assert.deepEqual(await products.get(hammer.id), hammer, "the record reached the server store");

  await api.create({ name: "Kite", price: 30, category: "toys" });
  const toys = await api.list({ where: { category: "toys" } });
  assert.deepEqual(toys.items.map((p) => p.name), ["Kite"]);
  assert.equal((await api.list({ search: "ham", sort: "-price", limit: 5 })).total, 1);

  const updated = await api.update(hammer.id, { price: 15 });
  assert.equal(updated.price, 15);
  assert.deepEqual(await api.get(hammer.id), updated);

  await api.delete(hammer.id);
  await assert.rejects(() => api.get(hammer.id), (error) => error instanceof NexoApiError && error.status === 404);
});

test("client-side validation fails fast with the same error the server would send", async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.stop());
  const calls = [];
  const spying = createNexoClient({
    baseUrl: server.info.uri,
    fetch: (...args) => {
      calls.push(args[0]);
      return fetch(...args);
    }
  });

  const local = await spying.resource(Product).create({ price: -1 }).catch((error) => error);
  assert.equal(calls.length, 0, "no request was sent");
  assert.ok(local instanceof NexoApiError);
  assert.equal(local.status, 400);

  // Bypass the client to get the server's answer for the same input.
  const remote = await client.post("/api/products", { price: -1 }).catch((error) => error);
  assert.equal(remote.status, 400);
  assert.deepEqual(local.payload, remote.payload);
});

test("writes notify every list of that model; the resource client is shared per model", async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.stop());
  assert.equal(client.resource(Product), client.resource(Product));

  const query = createQuery(() => client.resource(Product).list());
  const unsubscribe = client.resource(Product).onChange(() => void query.refetch());
  await query.refetch();
  assert.equal(query.getState().data.total, 0);

  const seen = new Promise((resolve) => {
    const stop = query.subscribe(() => {
      if (!query.getState().loading) {
        stop();
        resolve(query.getState().data.total);
      }
    });
  });
  await client.resource(Product).create({ name: "Ball", price: 3 });
  assert.equal(await seen, 1);
  unsubscribe();
});

test("createQuery keeps only the latest response and keeps data while reloading", async () => {
  const resolvers = [];
  const query = createQuery(() => new Promise((resolve) => resolvers.push(resolve)));
  assert.deepEqual(query.getState(), { data: null, loading: true, error: null });

  const first = query.refetch();
  const second = query.refetch();
  resolvers[1]("new");
  await second;
  resolvers[0]("stale");
  await first;
  assert.equal(query.getState().data, "new");

  const failing = createQuery(() => Promise.reject(new Error("down")));
  await failing.refetch();
  assert.equal(failing.getState().error.message, "down");
  assert.equal(failing.getState().loading, false);

  assert.equal(createQuery(async () => 1, { enabled: false }).getState().loading, false);
});

test("NexoForm renders one input per field, by kind, with required markers", () => {
  const html = renderToString(React.createElement(NexoForm, { model: Product }));
  assert.match(html, /name="name"[^>]*type="text"|type="text"[^>]*name="name"/);
  assert.match(html, /type="number"/);
  assert.match(html, /<select[^>]*name="category"/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<textarea[^>]*name="description"/);
  assert.ok(html.includes("Name *"));
  assert.ok(html.includes("Description") && !html.includes("Description *"));
  assert.ok(html.includes(">Create<"));
});

test("NexoForm with an id shows a loader until the record arrives", () => {
  const html = renderToString(React.createElement(NexoForm, { model: Product, id: "p-1" }));
  assert.ok(html.includes("Loading"));
});

test("NexoTable derives columns from the model and formats cells", () => {
  const rows = [{ id: "1", name: "Hammer", price: 12, category: "tools", inStock: false, description: "long text" }];
  const html = renderToString(React.createElement(NexoTable, { model: Product, rows }));
  for (const header of ["Name", "Price", "Category", "In stock"]) assert.ok(html.includes(`>${header}<`), header);
  assert.ok(!html.includes("long text"), "text fields are left out by default");
  assert.ok(html.includes(">No<"));
  assert.equal(formatCell(undefined), "—");
  assert.equal(formatCell(["a", "b"]), "a, b");
});

test("NexoTable shows loading, error and empty states", () => {
  const render = (props) => renderToString(React.createElement(NexoTable, { rows: [], ...props }));
  assert.ok(render({ loading: true }).includes("Loading"));
  assert.ok(render({ error: new Error("Boom") }).includes("Boom"));
  assert.ok(render({}).includes("No records yet"));
  assert.ok(renderToString(React.createElement(NexoResourceTable, { model: Product, search: true })).includes("Search products"));
});

test("layout and feedback primitives render", () => {
  const stack = renderToString(React.createElement(NexoStack, { direction: "row", gap: 8 }, "a"));
  assert.match(stack, /flex-direction:row/);
  assert.match(stack, /gap:8px/);
  assert.match(renderToString(React.createElement(NexoGrid, { columns: 3 })), /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.ok(renderToString(React.createElement(NexoEmptyState, { title: "No users" })).includes("No users"));
  assert.ok(renderToString(React.createElement(NexoErrorState, { error: "Bad", onRetry: () => {} })).includes("Try again"));
});

test("NexoApp routes pages with params, layouts, protection and not-found", () => {
  const Layout = ({ children }) => React.createElement("main", { className: "shell" }, children);
  const UserPage = ({ params }) => React.createElement("h1", null, `User ${params.id}`);
  const pages = [
    page("/users/:id", UserPage),
    page("/login", () => React.createElement("h1", null, "Login"), { layout: null }),
    page("/admin", () => React.createElement("h1", null, "Admin"), { protect: true })
  ];
  const render = (path, props = {}) =>
    renderToString(React.createElement(NexoApp, { pages, layout: Layout, initialPath: path, isAuthenticated: () => false, ...props }));

  assert.equal(render("/users/42"), '<main class="shell"><h1>User 42</h1></main>');
  assert.equal(render("/login"), "<h1>Login</h1>");
  assert.equal(render("/admin"), "", "signed-out users see nothing while being redirected");
  assert.ok(render("/admin", { isAuthenticated: () => true }).includes("Admin"));
  assert.ok(render("/nowhere").includes("Page not found"));
  assert.equal(render("/admin", { isAuthenticated: undefined }), "", "without isAuthenticated, the (empty) session decides");
});

test("NexoProvider passes auth to the client it creates", async () => {
  let client;
  function Probe() {
    client = useNexoClient();
    return null;
  }
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push(init.headers);
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  renderToString(React.createElement(NexoProvider, { auth: { token: "t0k" }, fetch: fakeFetch }, React.createElement(Probe)));
  await client.resource(Product).list();
  assert.equal(sent[0].Authorization, "Bearer t0k");
});

test("the React-free client entry exposes the resource client", () => {
  assert.equal(typeof clientEntry.NexoResourceClient, "function");
  assert.equal(typeof clientEntry.createQuery, "function");
  assert.equal(typeof createNexoClient().resource, "function");
});

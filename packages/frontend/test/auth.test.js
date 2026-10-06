/**
 * Sign-in end to end: NexoClient (session, auth client) → HTTP →
 * createAuth() → document store, protecting a resource.
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

import { createApplication, createAuth, createInMemoryDocumentStore, field, model, resource } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";

import {
  createNexoClient,
  NexoApiError,
  NexoApp,
  NexoLoginForm,
  NexoProvider,
  NexoSession,
  page,
  safeRedirectPath,
  useAuth
} from "../dist/index.js";

const Note = model("notes", { text: field.string() });

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key)
  };
}

async function startServer() {
  const store = createInMemoryDocumentStore();
  const auth = createAuth({ store, secret: "frontend-auth-test-secret-0123456789abcd", defaultScopes: ["notes:*"] });
  const app = createApplication({ name: "notes" });
  app.module(auth);
  app.module(resource(Note, { store, auth: { read: ["notes:read"], write: ["notes:write"] } }));
  const server = await startHapiServer(app, { port: 0, logging: false, bindLifecycle: false, authenticate: auth.authenticate });
  return { server, auth };
}

test("register signs in; requests carry the token; logout revokes it", async (t) => {
  const { server } = await startServer();
  t.after(() => server.stop());
  const client = createNexoClient({ baseUrl: server.info.uri, session: new NexoSession({ storage: null }) });
  const notes = client.resource(Note);

  await assert.rejects(() => notes.list(), (error) => error instanceof NexoApiError && error.status === 401);

  const user = await client.auth.register({ email: "ann@example.com", password: "correct horse", name: "Ann" });
  assert.equal(user.email, "ann@example.com");
  assert.equal(client.session.signedIn, true);
  await notes.create({ text: "hello" });
  assert.equal((await notes.list()).total, 1);

  const token = client.session.token;
  await client.auth.logout();
  assert.equal(client.session.signedIn, false);
  // The old token no longer works on the server either.
  const stolen = createNexoClient({ baseUrl: server.info.uri, auth: { token } });
  await assert.rejects(() => stolen.resource(Note).list(), (error) => error.status === 401);

  await client.auth.login("ann@example.com", "correct horse");
  assert.equal((await notes.list()).total, 1);
});

test("a 401 for the session token clears the session; me() refreshes the user", async (t) => {
  const { server, auth } = await startServer();
  t.after(() => server.stop());
  const client = createNexoClient({ baseUrl: server.info.uri, session: new NexoSession({ storage: null }) });
  const user = await client.auth.register({ email: "ann@example.com", password: "correct horse" });

  await auth.setScopes(user.id, ["notes:read"]);
  assert.deepEqual((await client.auth.me()).scopes, ["notes:read"]);
  assert.deepEqual(client.session.user.scopes, ["notes:read"]);

  let changes = 0;
  client.session.subscribe(() => changes++);
  await auth.setPassword(user.id, "brand new password"); // ends every session on the server
  await assert.rejects(() => client.resource(Note).list(), (error) => error.status === 401);
  assert.equal(client.session.signedIn, false);
  assert.equal(changes, 1);
  assert.equal(await client.auth.me(), null);
});

test("wrong credentials surface as NexoApiError with the server's code", async (t) => {
  const { server } = await startServer();
  t.after(() => server.stop());
  const client = createNexoClient({ baseUrl: server.info.uri, session: new NexoSession({ storage: null }) });
  const error = await client.auth.login("nobody@example.com", "whatever1").catch((e) => e);
  assert.ok(error instanceof NexoApiError);
  assert.equal(error.status, 401);
  assert.equal(error.payload.code, "INVALID_CREDENTIALS");
  assert.equal(client.session.signedIn, false);
});

test("NexoSession persists to storage, drops expired sessions and survives broken storage", () => {
  const storage = memoryStorage();
  const user = { id: "u1", email: "a@example.com", scopes: [], createdAt: "t", updatedAt: "t" };
  const live = { user, token: "tok", expiresAt: new Date(Date.now() + 60_000).toISOString() };

  new NexoSession({ storage }).set(live);
  assert.deepEqual(new NexoSession({ storage }).get(), live, "a reload stays signed in");

  storage.setItem("nexo.session", JSON.stringify({ ...live, expiresAt: new Date(Date.now() - 1).toISOString() }));
  assert.equal(new NexoSession({ storage }).signedIn, false);

  storage.setItem("nexo.session", "{not json");
  assert.equal(new NexoSession({ storage }).get(), null);

  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() {} };
  const session = new NexoSession({ storage: throwing });
  session.set(live);
  assert.equal(session.token, "tok", "works in memory when storage fails");
});

test("explicit auth.token wins over the session token", async () => {
  const sent = [];
  const session = new NexoSession({ storage: null });
  session.set({ user: { id: "u", email: "e", scopes: [], createdAt: "t", updatedAt: "t" }, token: "session-token", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const fetch = async (_url, init) => {
    sent.push(init.headers.Authorization);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  await createNexoClient({ session, fetch }).get("/x");
  await createNexoClient({ session, fetch, auth: { token: "api-token" } }).get("/x");
  assert.deepEqual(sent, ["Bearer session-token", "Bearer api-token"]);
});

test("safeRedirectPath only allows paths on this site", () => {
  assert.equal(safeRedirectPath("/notes?x=1", "/"), "/notes?x=1");
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "notes", null, undefined]) {
    assert.equal(safeRedirectPath(bad, "/home"), "/home", String(bad));
  }
});

test("useAuth, NexoLoginForm and protected pages follow the session", () => {
  const session = new NexoSession({ storage: null });
  const client = createNexoClient({ session });
  function Who() {
    const { user, signedIn, hasScope } = useAuth();
    return React.createElement("p", null, signedIn ? `${user.email} ${hasScope("notes:write")} ${hasScope("admin")}` : "anonymous");
  }
  const render = () => renderToString(React.createElement(NexoProvider, { client }, React.createElement(Who)));
  assert.equal(render(), "<p>anonymous</p>");
  session.set({
    user: { id: "u", email: "ann@example.com", scopes: ["notes:*"], createdAt: "t", updatedAt: "t" },
    token: "t",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(render(), "<p>ann@example.com true false</p>");

  const pages = [page("/secret", () => React.createElement("h1", null, "Secret"), { protect: true })];
  assert.ok(renderToString(React.createElement(NexoApp, { pages, client, initialPath: "/secret" })).includes("Secret"));
  session.clear();
  assert.equal(renderToString(React.createElement(NexoApp, { pages, client, initialPath: "/secret" })), "");

  const form = renderToString(React.createElement(NexoLoginForm));
  assert.ok(form.includes('type="email"') && form.includes('type="password"'));
  assert.ok(form.includes("Create an account"));
  assert.ok(!renderToString(React.createElement(NexoLoginForm, { allowRegister: false })).includes("Create an account"));
  assert.ok(renderToString(React.createElement(NexoLoginForm, { mode: "register" })).includes('name="name"'));
});

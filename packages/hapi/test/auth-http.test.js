/** createAuth() over HTTP: the sign-in flow a frontend uses, protecting a resource. */
import test from "node:test";
import assert from "node:assert/strict";

import { createApplication, createAuth, createInMemoryDocumentStore, field, model, resource } from "@nexo-alpha/core";
import { createHapiServer } from "../dist/index.js";

const Note = model("notes", { text: field.string(), owner: field.string().optional() });

async function serve() {
  const store = createInMemoryDocumentStore();
  const auth = createAuth({ store, secret: "auth-http-test-secret-0123456789abcdefgh", defaultScopes: ["notes:read"] });
  const app = createApplication({ name: "notes" });
  app.module(auth);
  app.module(resource(Note, {
    store,
    auth: { read: ["notes:read"], write: ["notes:write"] },
    beforeWrite: (note, { request }) => ({ ...note, owner: request?.auth?.identity?.email })
  }));
  const server = await createHapiServer(app, { logging: false, authenticate: auth.authenticate });
  const call = async (method, url, payload, token) => {
    const response = await server.inject({
      method,
      url,
      ...(payload !== undefined ? { payload } : {}),
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
    });
    return { status: response.statusCode, body: response.payload === "" ? undefined : JSON.parse(response.payload) };
  };
  return { call, auth };
}

test("register → me → logout → me", async () => {
  const { call } = await serve();

  const registered = await call("POST", "/api/auth/register", { email: "ann@example.com", password: "correct horse", name: "Ann" });
  assert.equal(registered.status, 201);
  const { token, user } = registered.body;
  assert.equal(user.email, "ann@example.com");
  assert.equal(user.passwordHash, undefined);

  assert.deepEqual(await call("GET", "/api/auth/me", undefined, token), { status: 200, body: { user } });
  assert.equal((await call("POST", "/api/auth/logout", undefined, token)).status, 204);
  assert.equal((await call("GET", "/api/auth/me", undefined, token)).status, 401);
});

test("error answers: 400 invalid input, 409 duplicate email, 401 bad credentials", async () => {
  const { call } = await serve();
  const invalid = await call("POST", "/api/auth/register", { email: "x", password: "short" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.errors.length, 2);

  await call("POST", "/api/auth/register", { email: "ann@example.com", password: "correct horse" });
  assert.equal((await call("POST", "/api/auth/register", { email: "ANN@example.com", password: "another one" })).status, 409);

  const wrong = await call("POST", "/api/auth/login", { email: "ann@example.com", password: "nope nope" });
  assert.deepEqual(wrong, { status: 401, body: { error: "Invalid email or password.", code: "INVALID_CREDENTIALS" } });
  assert.equal((await call("POST", "/api/auth/login", { email: "ann@example.com" })).status, 400);
  assert.equal((await call("POST", "/api/auth/login", { email: "ann@example.com", password: "correct horse" })).status, 200);
});

test("registration cannot grant itself scopes; server code can", async () => {
  const { call, auth } = await serve();
  const { body } = await call("POST", "/api/auth/register", { email: "eve@example.com", password: "correct horse", scopes: ["notes:write"] });
  assert.deepEqual(body.user.scopes, ["notes:read"]);
  assert.equal((await call("POST", "/api/notes", { text: "hi" }, body.token)).status, 403);

  await auth.setScopes(body.user.id, ["notes:read", "notes:write"]);
  const created = await call("POST", "/api/notes", { text: "hi" }, body.token);
  assert.equal(created.status, 201);
  assert.equal(created.body.owner, "eve@example.com");
  assert.equal((await call("GET", "/api/notes", undefined, body.token)).body.total, 1);
  assert.equal((await call("GET", "/api/notes")).status, 401);
});

test("password reset and email verification over HTTP", async () => {
  const sent = [];
  const store = createInMemoryDocumentStore();
  const auth = createAuth({
    store,
    secret: "auth-http-test-secret-0123456789abcdefgh",
    appUrl: "https://app.example.com",
    sendEmail: (email) => void sent.push(email)
  });
  const app = createApplication({ name: "emails" });
  app.module(auth);
  const server = await createHapiServer(app, { logging: false, authenticate: auth.authenticate });
  const call = async (method, url, payload, token) => {
    const response = await server.inject({ method, url, ...(payload ? { payload } : {}), ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
    return { status: response.statusCode, body: response.payload === "" ? undefined : JSON.parse(response.payload) };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const tokenOf = (email) => new URL(email.link).searchParams.get("token");

  const { body: registered } = await call("POST", "/api/auth/register", { email: "ann@example.com", password: "correct horse" });
  await settle();
  assert.equal(sent.at(-1).kind, "verify-email");
  const verified = await call("POST", "/api/auth/verify-email/confirm", { token: tokenOf(sent.at(-1)) });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.emailVerified, true);

  // Same answer whether or not the account exists.
  assert.equal((await call("POST", "/api/auth/password-reset", { email: "nobody@example.com" })).status, 204);
  assert.equal((await call("POST", "/api/auth/password-reset", { email: "ann@example.com" })).status, 204);
  await settle();
  assert.equal(sent.filter((e) => e.kind === "password-reset").length, 1);

  const reset = await call("POST", "/api/auth/password-reset/confirm", { token: tokenOf(sent.at(-1)), password: "brand new password" });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.token);
  assert.equal((await call("GET", "/api/auth/me", undefined, registered.token)).status, 401, "old session ended");
  assert.equal((await call("GET", "/api/auth/me", undefined, reset.body.token)).status, 200);
  assert.equal((await call("POST", "/api/auth/password-reset/confirm", { token: "nope-nope-nope-nope-nope", password: "brand new password" })).status, 400);
  assert.equal((await call("POST", "/api/auth/verify-email")).status, 401, "requesting verification needs sign-in");
});

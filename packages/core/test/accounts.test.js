import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAuth,
  createInMemoryDocumentStore,
  createFileDocumentStore,
  createSqliteDocumentStore,
  createRequestContext,
  insertDocument,
  runInProject,
  scopeByProject,
  signToken,
  NexoHttpError,
  NexoValidationError,
  NexoConfigurationError
} from "../dist/index.js";

const SECRET = "accounts-test-secret-0123456789abcdefghij";
const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);

const bearer = (token) => createRequestContext({ headers: { authorization: `Bearer ${token}` } });

function setup(options = {}) {
  const store = createInMemoryDocumentStore();
  return { store, auth: createAuth({ store, secret: SECRET, minPasswordLength: 8, ...options }) };
}

// ---------------------------------------------------------------------------
// insert(): the atomic "only if absent" write accounts rely on
// ---------------------------------------------------------------------------

test("insert stores only when the id is free, in every built-in store", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-insert-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stores = {
    memory: createInMemoryDocumentStore(),
    file: createFileDocumentStore(join(dir, "data.json")),
    // node:sqlite needs Node >= 22.5.
    ...(HAS_SQLITE ? { sqlite: await createSqliteDocumentStore(":memory:") } : {})
  };
  for (const [name, store] of Object.entries(stores)) {
    assert.equal(await store.insert("c", "a", { v: 1 }), true, name);
    assert.equal(await store.insert("c", "a", { v: 2 }), false, name);
    assert.deepEqual(await store.get("c", "a"), { v: 1 }, name);
    const racers = await Promise.all([1, 2, 3, 4].map((v) => store.insert("c", "race", { v })));
    assert.equal(racers.filter(Boolean).length, 1, `${name}: exactly one concurrent insert wins`);
    await store.close();
  }
});

test("insertDocument falls back to get-then-put for stores without insert, and scopeByProject forwards insert", async () => {
  const base = createInMemoryDocumentStore();
  const { insert: _omit, ...legacy } = base;
  assert.equal(await insertDocument(legacy, "c", "x", 1), true);
  assert.equal(await insertDocument(legacy, "c", "x", 2), false);

  const scoped = scopeByProject(base);
  assert.equal(typeof scoped.insert, "function");
  assert.equal(await runInProject("p1", () => insertDocument(scoped, "c", "y", 1)), true);
  assert.equal(await runInProject("p2", () => insertDocument(scoped, "c", "y", 1)), true, "ids are per project");
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

test("register creates a signed-in account; the password is stored only as a scrypt hash", async () => {
  const { auth, store } = setup({ defaultScopes: ["notes:read"] });
  const session = await auth.register({ email: "  Ann@Example.com ", password: "correct horse", name: "Ann" });

  assert.equal(session.user.email, "ann@example.com");
  assert.deepEqual(session.user.scopes, ["notes:read"]);
  assert.equal("passwordHash" in session.user, false);
  assert.ok(Date.parse(session.expiresAt) > Date.now());

  const [stored] = await store.list("auth-users");
  assert.match(stored.passwordHash, /^scrypt\$16384\$/);
  assert.ok(!JSON.stringify(stored).includes("correct horse"));

  const result = await auth.authenticate(bearer(session.token));
  assert.equal(result.authenticated, true);
  assert.deepEqual(result.scopes, ["notes:read"]);
  assert.deepEqual(result.identity, { sub: session.user.id, email: "ann@example.com", name: "Ann", emailVerified: false, sessionId: result.identity.sessionId });
});

test("register rejects bad input and duplicate emails (case-insensitive), even when racing", async () => {
  const { auth } = setup();
  await assert.rejects(() => auth.register({ email: "nope", password: "short" }), (error) => {
    assert.ok(error instanceof NexoValidationError);
    assert.equal(error.errors.length, 2);
    return true;
  });
  const attempts = await Promise.allSettled(
    ["dup@example.com", "DUP@example.com", "dup@example.com "].map((email) => auth.register({ email, password: "long enough" }))
  );
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  assert.ok(attempts.filter((a) => a.status === "rejected").every((a) => a.reason.statusCode === 409));
});

test("login checks the password; wrong password and unknown email give the same 401", async () => {
  const { auth } = setup();
  await auth.register({ email: "ann@example.com", password: "correct horse" });

  const session = await auth.login("ANN@example.com", "correct horse");
  assert.equal((await auth.authenticate(bearer(session.token))).authenticated, true);

  for (const [email, password] of [["ann@example.com", "wrong horse"], ["bob@example.com", "correct horse"]]) {
    await assert.rejects(() => auth.login(email, password), (error) => {
      assert.ok(error instanceof NexoHttpError);
      assert.deepEqual([error.statusCode, error.code, error.message], [401, "INVALID_CREDENTIALS", "Invalid email or password."]);
      return true;
    });
  }
});

test("failed sign-ins are limited per email; success resets the count", async () => {
  const { auth } = setup({ maxFailedLogins: 3 });
  await auth.register({ email: "ann@example.com", password: "correct horse" });
  for (let i = 0; i < 2; i++) await assert.rejects(() => auth.login("ann@example.com", "wrong"), (e) => e.statusCode === 401);
  await auth.login("ann@example.com", "correct horse");
  for (let i = 0; i < 3; i++) await assert.rejects(() => auth.login("ann@example.com", "wrong"), (e) => e.statusCode === 401);
  await assert.rejects(() => auth.login("ann@example.com", "correct horse"), (e) => e.statusCode === 429);
  await assert.rejects(() => auth.login("other@example.com", "x"), (e) => e.statusCode === 401, "other emails are unaffected");
});

test("logout revokes that session only; setPassword revokes all", async () => {
  const { auth } = setup();
  const first = await auth.register({ email: "ann@example.com", password: "correct horse" });
  const second = await auth.login("ann@example.com", "correct horse");

  const firstIdentity = (await auth.authenticate(bearer(first.token))).identity;
  await auth.logout(firstIdentity.sessionId);
  assert.equal((await auth.authenticate(bearer(first.token))).authenticated, false);
  assert.equal((await auth.authenticate(bearer(second.token))).authenticated, true);

  await auth.setPassword(first.user.id, "new password!");
  assert.equal((await auth.authenticate(bearer(second.token))).authenticated, false);
  await assert.rejects(() => auth.login("ann@example.com", "correct horse"), (e) => e.statusCode === 401);
  await auth.login("ann@example.com", "new password!");
});

test("scopes are read on every request; resolveScopes can map roles", async () => {
  const { auth } = setup();
  const session = await auth.register({ email: "ann@example.com", password: "correct horse" });
  assert.deepEqual((await auth.authenticate(bearer(session.token))).scopes, []);
  await auth.setScopes(session.user.id, ["admin:*"]);
  assert.deepEqual((await auth.authenticate(bearer(session.token))).scopes, ["admin:*"]);

  const roles = setup({ resolveScopes: (user) => (user.email.endsWith("@corp.com") ? ["staff"] : []) });
  const staff = await roles.auth.register({ email: "x@corp.com", password: "correct horse" });
  assert.deepEqual((await roles.auth.authenticate(bearer(staff.token))).scopes, ["staff"]);
});

test("authenticate rejects missing, forged, foreign and expired tokens", async () => {
  const { auth, store } = setup({ sessionSeconds: 60 });
  const session = await auth.register({ email: "ann@example.com", password: "correct horse" });
  const sid = (await store.list("auth-sessions"))[0].id;

  const rejected = [
    createRequestContext(),
    bearer("not-a-jwt"),
    bearer(signToken({ sub: session.user.id, sid }, "another-secret-0123456789abcdefghijklmn", { expiresInSeconds: 60 })),
    bearer(signToken({ sub: "someone-else", sid }, SECRET, { expiresInSeconds: 60 })),
    bearer(signToken({ sub: session.user.id }, SECRET, { expiresInSeconds: 60 }))
  ];
  for (const context of rejected) assert.equal((await auth.authenticate(context)).authenticated, false);

  // A session past its expiry is removed when presented.
  const [stored] = await store.list("auth-sessions");
  await store.put("auth-sessions", stored.id, { ...stored, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await auth.authenticate(bearer(session.token))).authenticated, false);
  assert.equal(await store.get("auth-sessions", stored.id), undefined);
});

test("createAuth exposes register/login/logout/me APIs and refuses short secrets", () => {
  assert.throws(() => createAuth({ store: createInMemoryDocumentStore(), secret: "short" }), NexoConfigurationError);
  const { auth } = setup();
  assert.deepEqual(auth.apis.map((a) => `${a.method} ${a.path}`), [
    "POST /api/auth/register",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "GET /api/auth/me"
  ]);
  assert.equal(setup({ allowRegistration: false }).auth.apis.some((a) => a.name === "auth.register"), false);
});

// ---------------------------------------------------------------------------
// Password reset and email verification
// ---------------------------------------------------------------------------

function emailSetup(extra = {}) {
  const sent = [];
  const store = createInMemoryDocumentStore();
  const auth = createAuth({
    store,
    secret: SECRET,
    appUrl: "https://app.example.com/",
    sendEmail: (email) => void sent.push(email),
    onEmailError: (error) => { throw error; },
    ...extra
  });
  const tokenOf = (email) => new URL(email.link).searchParams.get("token");
  return { store, auth, sent, tokenOf };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("password reset: emailed single-use link, sessions ended, signed in with the new password", async () => {
  const { auth, sent, tokenOf, store } = emailSetup({ verifyEmailOnRegister: false });
  const before = await auth.register({ email: "ann@example.com", password: "correct horse" });

  await auth.requestPasswordReset("ANN@example.com");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "password-reset");
  assert.equal(sent[0].to, "ann@example.com");
  assert.match(sent[0].link, /^https:\/\/app\.example\.com\/reset-password\?token=/);
  const token = tokenOf(sent[0]);
  assert.ok(!JSON.stringify(await store.list("auth-tokens")).includes(token), "only a hash is stored");

  await assert.rejects(() => auth.resetPassword(token, "short"), NexoValidationError);
  const session = await auth.resetPassword(token, "brand new password");
  assert.equal(session.user.emailVerified, true, "the emailed link proves the address");
  assert.equal((await auth.authenticate(bearer(before.token))).authenticated, false, "old sessions end");
  assert.equal((await auth.authenticate(bearer(session.token))).authenticated, true);
  await auth.login("ann@example.com", "brand new password");
  await assert.rejects(() => auth.resetPassword(token, "another password"), (e) => e.code === "INVALID_TOKEN", "single use");
});

test("password reset does not reveal accounts, expires, and is rate limited", async () => {
  const { auth, sent, tokenOf, store } = emailSetup({ verifyEmailOnRegister: false });
  await auth.requestPasswordReset("nobody@example.com");
  assert.equal(sent.length, 0);

  await auth.register({ email: "ann@example.com", password: "correct horse" });
  await auth.requestPasswordReset("ann@example.com");
  const token = tokenOf(sent[0]);
  const [stored] = await store.list("auth-tokens");
  await store.put("auth-tokens", stored.id, { ...stored, expiresAt: new Date(Date.now() - 1).toISOString() });
  await assert.rejects(() => auth.resetPassword(token, "brand new password"), (e) => e.code === "INVALID_TOKEN");
  await assert.rejects(() => auth.resetPassword("made-up-token-1234567890", "brand new password"), (e) => e.statusCode === 400);

  for (let i = 0; i < 10; i++) await auth.requestPasswordReset("ann@example.com");
  assert.equal(sent.length, 5, "5 emails per address per hour");
});

test("email verification: sent on sign-up, confirmed by link, visible to the app", async () => {
  const { auth, sent, tokenOf } = emailSetup();
  const session = await auth.register({ email: "ann@example.com", password: "correct horse" });
  assert.equal(session.user.emailVerified, false);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "verify-email");
  assert.match(sent[0].link, /^https:\/\/app\.example\.com\/verify-email\?token=/);

  const verified = await auth.verifyEmail(tokenOf(sent[0]));
  assert.equal(verified.emailVerified, true);
  assert.equal((await auth.authenticate(bearer(session.token))).identity.emailVerified, true);
  await auth.requestEmailVerification(session.user.id);
  assert.equal(sent.length, 1, "no email once verified");
  await assert.rejects(() => auth.verifyEmail(tokenOf(sent[0])), (e) => e.code === "INVALID_TOKEN");
});

test("tokens are bound to their purpose", async () => {
  const { auth, sent, tokenOf } = emailSetup();
  await auth.register({ email: "ann@example.com", password: "correct horse" });
  await settle();
  await assert.rejects(() => auth.resetPassword(tokenOf(sent[0]), "brand new password"), (e) => e.code === "INVALID_TOKEN");
});

test("without sendEmail there are no reset or verification routes; sendEmail needs appUrl", () => {
  const plain = createAuth({ store: createInMemoryDocumentStore(), secret: SECRET });
  assert.equal(plain.apis.some((a) => a.path.includes("password-reset") || a.path.includes("verify-email")), false);
  assert.rejects(() => plain.requestPasswordReset("a@example.com"), NexoConfigurationError);
  assert.throws(() => createAuth({ store: createInMemoryDocumentStore(), secret: SECRET, sendEmail: () => {} }), /needs appUrl/);
  const { auth } = emailSetup();
  assert.deepEqual(auth.apis.map((a) => `${a.method} ${a.path}`).filter((r) => /reset|verify/.test(r)), [
    "POST /api/auth/password-reset",
    "POST /api/auth/password-reset/confirm",
    "POST /api/auth/verify-email",
    "POST /api/auth/verify-email/confirm"
  ]);
});

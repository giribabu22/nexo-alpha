import test from "node:test";
import assert from "node:assert/strict";

import {
  anyAuthenticator,
  apiKeyAuthenticator,
  createApplication,
  jwtAuthenticator,
  missingScopes,
  scopeMatches,
  scopesFromClaims,
  signToken,
  verifyToken
} from "../dist/index.js";

const SECRET = "a-test-secret-that-is-at-least-32-bytes-long";

function request(headers = {}) {
  return { params: {}, query: {}, payload: undefined, headers };
}

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

test("scopeMatches / missingScopes: exact, '*' and 'prefix:*' patterns", () => {
  assert.equal(scopeMatches("orders:read", "orders:read"), true);
  assert.equal(scopeMatches("*", "orders:read"), true);
  assert.equal(scopeMatches("orders:*", "orders:items:delete"), true);
  assert.equal(scopeMatches("orders:*", "orders"), false);
  assert.equal(scopeMatches("orders:*", "ordersx:read"), false);

  assert.deepEqual(missingScopes(["orders:*"], ["orders:read", "billing:read"]), ["billing:read"]);
  assert.deepEqual(missingScopes(undefined, ["a"]), ["a"]);
});

test("dispatch: wildcard scopes satisfy required scopes", async () => {
  const app = createApplication({ name: "scopes" });
  app.module({
    name: "m",
    apis: [{ name: "refund", method: "POST", path: "/refund", auth: { required: true, scopes: ["orders:refund"] }, handler: () => "ok" }]
  });
  app.setAuthenticator(() => ({ authenticated: true, scopes: ["orders:*"] }));
  assert.equal(await app.dispatch("refund", request()), "ok");
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

test("apiKeyAuthenticator: Bearer key maps to identity and scopes; unknown or missing keys fail", async () => {
  const authenticate = apiKeyAuthenticator({
    keys: [
      { key: "key-one", identity: { service: "billing" }, scopes: ["billing:*"] },
      { key: "key-two" }
    ]
  });

  assert.deepEqual(await authenticate(request({ authorization: "Bearer key-one" })), {
    authenticated: true,
    identity: { service: "billing" },
    scopes: ["billing:*"]
  });
  assert.deepEqual(await authenticate(request({ Authorization: "bearer key-two" })), { authenticated: true });
  assert.equal((await authenticate(request({ authorization: "Bearer nope" }))).authenticated, false);
  assert.equal((await authenticate(request({ authorization: "Basic key-one" }))).authenticated, false);
  assert.equal((await authenticate(request())).authenticated, false);
});

test("apiKeyAuthenticator: custom header, and configuration errors", async () => {
  const authenticate = apiKeyAuthenticator({ keys: [{ key: "k" }], header: "X-Api-Key" });
  assert.equal((await authenticate(request({ "x-api-key": "k" }))).authenticated, true);
  assert.equal((await authenticate(request({ authorization: "Bearer k" }))).authenticated, false);

  assert.throws(() => apiKeyAuthenticator({ keys: [] }), /at least one key/);
  assert.throws(() => apiKeyAuthenticator({ keys: [{ key: "" }] }), /non-empty/);
});

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

test("signToken / verifyToken: round trip with iat and exp", () => {
  const now = Date.UTC(2026, 0, 1);
  const token = signToken({ sub: "u1", scopes: ["a"] }, SECRET, { expiresInSeconds: 60, now });

  const result = verifyToken(token, SECRET, { now: now + 30_000 });
  assert.equal(result.valid, true);
  assert.equal(result.claims.sub, "u1");
  assert.equal(result.claims.exp - result.claims.iat, 60);
});

test("verifyToken: rejects expired, not-yet-valid, missing exp, bad signature and malformed tokens", () => {
  const now = Date.UTC(2026, 0, 1);
  const token = signToken({ sub: "u1" }, SECRET, { expiresInSeconds: 60, now });

  assert.deepEqual(verifyToken(token, SECRET, { now: now + 61_000 }), { valid: false, reason: "expired" });
  assert.equal(verifyToken(token, SECRET, { now: now + 61_000, clockToleranceSeconds: 5 }).valid, true);

  const future = signToken({ nbf: now / 1000 + 100 }, SECRET, { expiresInSeconds: 600, now });
  assert.deepEqual(verifyToken(future, SECRET, { now }), { valid: false, reason: "not yet valid" });

  const noExp = signToken({ sub: "u1" }, SECRET, { now });
  assert.deepEqual(verifyToken(noExp, SECRET, { now }), { valid: false, reason: "missing exp" });
  assert.equal(verifyToken(noExp, SECRET, { now, requireExpiry: false }).valid, true);

  assert.deepEqual(verifyToken(token, SECRET.replace("a", "b"), { now }), { valid: false, reason: "bad signature" });

  const [header, , signature] = token.split(".");
  const tampered = `${header}.${b64({ sub: "admin", exp: now / 1000 + 60 })}.${signature}`;
  assert.deepEqual(verifyToken(tampered, SECRET, { now }), { valid: false, reason: "bad signature" });

  assert.deepEqual(verifyToken("a.b", SECRET), { valid: false, reason: "malformed" });
});

test("verifyToken: rejects alg 'none' and other algorithms", () => {
  const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "admin", exp: 9_999_999_999 })}.`;
  assert.deepEqual(verifyToken(none, SECRET), { valid: false, reason: "unsupported algorithm" });

  const rs = `${b64({ alg: "RS256" })}.${b64({ exp: 9_999_999_999 })}.sig`;
  assert.deepEqual(verifyToken(rs, SECRET), { valid: false, reason: "unsupported algorithm" });
});

test("verifyToken: issuer and audience checks", () => {
  const token = signToken({ iss: "nexo", aud: ["api", "web"] }, SECRET, { expiresInSeconds: 60 });

  assert.equal(verifyToken(token, SECRET, { issuer: "nexo", audience: "web" }).valid, true);
  assert.deepEqual(verifyToken(token, SECRET, { issuer: "other" }), { valid: false, reason: "wrong issuer" });
  assert.deepEqual(verifyToken(token, SECRET, { audience: "mobile" }), { valid: false, reason: "wrong audience" });
});

test("JWT secrets shorter than 32 bytes are refused", () => {
  assert.throws(() => signToken({}, "short"), /at least 32 bytes/);
  assert.throws(() => verifyToken("a.b.c", "short"), /at least 32 bytes/);
  assert.throws(() => jwtAuthenticator({ secret: "short" }), /at least 32 bytes/);
});

test("scopesFromClaims: merges the 'scopes' array and space-separated 'scope' string", () => {
  assert.deepEqual(scopesFromClaims({ scopes: ["a", "b"], scope: "b  c" }), ["a", "b", "c"]);
  assert.deepEqual(scopesFromClaims({}), []);
});

test("jwtAuthenticator: default mapping, custom resolve, and rejection of bad tokens", async () => {
  const token = signToken({ sub: "u1", scope: "orders:read" }, SECRET, { expiresInSeconds: 60 });

  const plain = jwtAuthenticator({ secret: SECRET });
  const result = await plain(request({ authorization: `Bearer ${token}` }));
  assert.equal(result.authenticated, true);
  assert.equal(result.identity.sub, "u1");
  assert.deepEqual(result.scopes, ["orders:read"]);

  const withRoles = jwtAuthenticator({
    secret: SECRET,
    resolve: (claims) => ({ identity: claims.sub, scopes: claims.sub === "u1" ? ["orders:*"] : [] })
  });
  assert.deepEqual(await withRoles(request({ authorization: `Bearer ${token}` })), {
    identity: "u1",
    scopes: ["orders:*"],
    authenticated: true
  });

  assert.equal((await plain(request({ authorization: "Bearer garbage" }))).authenticated, false);
  assert.equal((await plain(request())).authenticated, false);
  assert.equal((await jwtAuthenticator({ secret: SECRET, audience: "x" })(request({ authorization: `Bearer ${token}` }))).authenticated, false);
});

test("anyAuthenticator: first authenticated result wins", async () => {
  const authenticate = anyAuthenticator(
    jwtAuthenticator({ secret: SECRET }),
    apiKeyAuthenticator({ keys: [{ key: "service-key", identity: "svc" }] })
  );

  assert.equal((await authenticate(request({ authorization: "Bearer service-key" }))).identity, "svc");
  const token = signToken({ sub: "u1" }, SECRET, { expiresInSeconds: 60 });
  assert.equal((await authenticate(request({ authorization: `Bearer ${token}` }))).identity.sub, "u1");
  assert.equal((await authenticate(request({ authorization: "Bearer nope" }))).authenticated, false);
});

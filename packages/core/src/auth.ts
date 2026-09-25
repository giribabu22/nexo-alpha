/**
 * Ready-made {@link NexoAuthenticator}s and scope matching.
 *
 * Authenticators work on the framework-neutral {@link NexoRequestContext}, so
 * the same one can be passed to `app.setAuthenticator()` and to HTTP
 * adapters such as `@nexo-alpha/hapi`'s `createHapiServer({ authenticate })`.
 *
 * - {@link apiKeyAuthenticator}: static API keys (constant-time comparison).
 * - {@link jwtAuthenticator}: HS256-signed JWTs, with {@link signToken} / {@link verifyToken}.
 * - {@link anyAuthenticator}: tries several authenticators in order.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NexoAuthenticator, NexoAuthResult, NexoRequestContext } from "./api.js";
import { NexoConfigurationError } from "./errors.js";

// ---------------------------------------------------------------------------
// Scope matching
// ---------------------------------------------------------------------------

/**
 * Whether a granted scope covers a required one: identical, `"*"`, or a
 * `"prefix:*"` pattern whose prefix (including the colon) starts the
 * required scope — `"orders:*"` covers `"orders:refund"` but not `"orders"`.
 * `@nexo-alpha/decision`'s RBAC uses the same rule for permissions.
 */
export function scopeMatches(granted: string, required: string): boolean {
  if (granted === "*" || granted === required) return true;
  if (granted.endsWith(":*")) {
    return required.startsWith(granted.slice(0, -1));
  }
  return false;
}

/** The subset of `required` not covered by any of `granted`. */
export function missingScopes(granted: readonly string[] | undefined, required: readonly string[]): string[] {
  const grantedList = granted ?? [];
  return required.filter((scope) => !grantedList.some((g) => scopeMatches(g, scope)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header(context: NexoRequestContext, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(context.headers)) {
    if (key.toLowerCase() === lower) return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function bearerToken(context: NexoRequestContext): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header(context, "authorization") ?? "");
  return match?.[1];
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

const UNAUTHENTICATED: NexoAuthResult = { authenticated: false };

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export interface ApiKeyEntry {
  readonly key: string;
  /** Returned as `NexoAuthResult.identity` on a match. */
  readonly identity?: unknown;
  readonly scopes?: readonly string[];
}

export interface ApiKeyAuthenticatorOptions {
  readonly keys: readonly ApiKeyEntry[];
  /**
   * Header carrying the raw key, e.g. `"x-api-key"`. Default: the
   * `Authorization: Bearer <key>` header.
   */
  readonly header?: string;
}

/**
 * Authenticates requests carrying one of a fixed set of API keys. Keys are
 * compared by SHA-256 digest in constant time, and every key is checked on
 * every request so timing does not reveal which (if any) matched.
 */
export function apiKeyAuthenticator(options: ApiKeyAuthenticatorOptions): NexoAuthenticator {
  if (options.keys.length === 0) {
    throw new NexoConfigurationError("apiKeyAuthenticator() needs at least one key.");
  }
  const entries = options.keys.map((entry) => {
    if (entry.key.length === 0) {
      throw new NexoConfigurationError("apiKeyAuthenticator() keys must be non-empty.");
    }
    return { digest: sha256(entry.key), entry };
  });

  return (context) => {
    const presented = options.header !== undefined ? header(context, options.header) : bearerToken(context);
    if (presented === undefined || presented.length === 0) return UNAUTHENTICATED;

    const digest = sha256(presented);
    let matched: ApiKeyEntry | undefined;
    for (const candidate of entries) {
      if (timingSafeEqual(candidate.digest, digest) && matched === undefined) matched = candidate.entry;
    }
    if (matched === undefined) return UNAUTHENTICATED;

    return {
      authenticated: true,
      ...(matched.identity !== undefined ? { identity: matched.identity } : {}),
      ...(matched.scopes !== undefined ? { scopes: matched.scopes } : {})
    };
  };
}

// ---------------------------------------------------------------------------
// JWT (HS256)
// ---------------------------------------------------------------------------

/** JWT claims. Registered claims are typed; anything else is allowed. */
export interface TokenClaims {
  readonly sub?: string;
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  /** Expiry, seconds since epoch. */
  readonly exp?: number;
  /** Not-before, seconds since epoch. */
  readonly nbf?: number;
  /** Issued-at, seconds since epoch. */
  readonly iat?: number;
  /** Scopes as an array (Nexo convention). */
  readonly scopes?: readonly string[];
  /** Scopes as a space-separated string (OAuth 2 convention). */
  readonly scope?: string;
  readonly [claim: string]: unknown;
}

export interface SignTokenOptions {
  /** Sets `exp` this many seconds after `iat`. */
  readonly expiresInSeconds?: number;
  /** Clock override, milliseconds since epoch. */
  readonly now?: number;
}

export interface VerifyTokenOptions {
  /** Required `iss` value. */
  readonly issuer?: string;
  /** Required `aud` value (the token's `aud` must equal or contain it). */
  readonly audience?: string;
  /** Leeway for `exp`/`nbf` checks. Default: 0 */
  readonly clockToleranceSeconds?: number;
  /** Reject tokens without `exp`. Default: true */
  readonly requireExpiry?: boolean;
  /** Clock override, milliseconds since epoch. */
  readonly now?: number;
}

export type VerifyTokenResult =
  | { readonly valid: true; readonly claims: TokenClaims }
  | { readonly valid: false; readonly reason: string };

const MIN_SECRET_BYTES = 32;

function assertSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new NexoConfigurationError(`JWT secret must be at least ${MIN_SECRET_BYTES} bytes.`);
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function parseJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Creates an HS256-signed JWT. Adds `iat`, and `exp` when `expiresInSeconds` is set. */
export function signToken(claims: TokenClaims, secret: string, options: SignTokenOptions = {}): string {
  assertSecret(secret);
  const iat = Math.floor((options.now ?? Date.now()) / 1000);
  const payload = {
    ...claims,
    iat,
    ...(options.expiresInSeconds !== undefined ? { exp: iat + options.expiresInSeconds } : {})
  };
  const unsigned = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  return `${unsigned}.${hmac(unsigned, secret).toString("base64url")}`;
}

/**
 * Verifies an HS256 JWT: structure, `alg` (only HS256 is accepted — never
 * `none`), signature (constant time), `exp`, `nbf`, and optional `iss`/`aud`.
 */
export function verifyToken(token: string, secret: string, options: VerifyTokenOptions = {}): VerifyTokenResult {
  assertSecret(secret);

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const tokenHeader = parseJsonSegment(headerPart);
  if (!isRecord(tokenHeader) || tokenHeader.alg !== "HS256") {
    return { valid: false, reason: "unsupported algorithm" };
  }

  const expected = hmac(`${headerPart}.${payloadPart}`, secret);
  const actual = Buffer.from(signaturePart, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { valid: false, reason: "bad signature" };
  }

  const claims = parseJsonSegment(payloadPart);
  if (!isRecord(claims)) return { valid: false, reason: "malformed" };

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const tolerance = options.clockToleranceSeconds ?? 0;

  if (claims.exp === undefined) {
    if (options.requireExpiry !== false) return { valid: false, reason: "missing exp" };
  } else if (typeof claims.exp !== "number" || now > claims.exp + tolerance) {
    return { valid: false, reason: "expired" };
  }
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || now + tolerance < claims.nbf)) {
    return { valid: false, reason: "not yet valid" };
  }
  if (options.issuer !== undefined && claims.iss !== options.issuer) {
    return { valid: false, reason: "wrong issuer" };
  }
  if (options.audience !== undefined) {
    const aud = claims.aud;
    const matches = Array.isArray(aud) ? aud.includes(options.audience) : aud === options.audience;
    if (!matches) return { valid: false, reason: "wrong audience" };
  }

  return { valid: true, claims: claims as TokenClaims };
}

/** Reads scopes from `scopes` (array) and `scope` (space-separated string). */
export function scopesFromClaims(claims: TokenClaims): string[] {
  const scopes = new Set<string>();
  if (Array.isArray(claims.scopes)) {
    for (const scope of claims.scopes) if (typeof scope === "string") scopes.add(scope);
  }
  if (typeof claims.scope === "string") {
    for (const scope of claims.scope.split(/\s+/)) if (scope !== "") scopes.add(scope);
  }
  return [...scopes];
}

export interface JwtAuthenticatorOptions extends Omit<VerifyTokenOptions, "now"> {
  readonly secret: string;
  /**
   * Maps verified claims to the auth result. Use this to look up roles and
   * grant their permissions as scopes. Default: `identity` = claims, `scopes`
   * = {@link scopesFromClaims}.
   */
  readonly resolve?: (claims: TokenClaims) => Omit<NexoAuthResult, "authenticated"> | Promise<Omit<NexoAuthResult, "authenticated">>;
}

/** Authenticates `Authorization: Bearer <jwt>` requests signed with HS256. */
export function jwtAuthenticator(options: JwtAuthenticatorOptions): NexoAuthenticator {
  assertSecret(options.secret);
  const { secret, resolve, ...verifyOptions } = options;

  return async (context) => {
    const token = bearerToken(context);
    if (token === undefined) return UNAUTHENTICATED;

    const result = verifyToken(token, secret, verifyOptions);
    if (!result.valid) return UNAUTHENTICATED;

    const resolved = resolve !== undefined
      ? await resolve(result.claims)
      : { identity: result.claims, scopes: scopesFromClaims(result.claims) };
    return { ...resolved, authenticated: true };
  };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Returns the first authenticated result from `authenticators`, tried in order. */
export function anyAuthenticator(...authenticators: readonly NexoAuthenticator[]): NexoAuthenticator {
  return async (context) => {
    for (const authenticate of authenticators) {
      const result = await authenticate(context);
      if (result.authenticated) return result;
    }
    return UNAUTHENTICATED;
  };
}

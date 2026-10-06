/**
 * Accounts and sign-in: email + password users, sessions, and the HTTP API
 * a frontend needs, from one call.
 *
 * ```ts
 * export const auth = createAuth({ store, secret: process.env.AUTH_SECRET!, defaultScopes: ["notes:read"] });
 * app.module(auth);                                              // /api/auth/register, login, logout, me
 * await startHapiServer(app, { authenticate: auth.authenticate }); // protects auth-required APIs
 * ```
 *
 * - Passwords are hashed with scrypt (random salt per password) and compared
 *   in constant time; unknown emails take as long as wrong passwords.
 * - One account per email, enforced atomically by the store.
 * - Each sign-in creates a server-side session; the token (a JWT) names it,
 *   so `logout` really revokes the token, and `setPassword` signs out everywhere.
 * - Scopes are read from the account on every request, so `setScopes` takes
 *   effect immediately.
 * - Failed sign-ins are limited per email (default 10 per 15 minutes).
 */

import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { NexoApi, NexoAuthenticator, NexoRequestContext } from "./api.js";
import { httpResponse } from "./api.js";
import { signToken, verifyToken } from "./auth.js";
import { NexoConfigurationError, NexoHttpError, NexoValidationError } from "./errors.js";
import type { NexoModule } from "./module.js";
import { createRateLimiter } from "./rate-limit.js";
import { insertDocument, type NexoDocumentStore } from "./storage.js";

/** An account as the API and server code see it: never includes the password hash. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What `context.auth.identity` holds on requests authenticated by `createAuth`. */
export interface AuthIdentity {
  /** The user id. */
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
  readonly sessionId: string;
}

/** Answer of register and login: the user and a bearer token for `Authorization: Bearer <token>`. */
export interface AuthSession {
  readonly user: AuthUser;
  readonly token: string;
  /** When the token stops working, ISO 8601. */
  readonly expiresAt: string;
}

export interface CreateAuthOptions {
  readonly store: NexoDocumentStore;
  /** Signs session tokens. At least 32 bytes; keep it out of source control. */
  readonly secret: string;
  /** API path prefix. Default: "/api/auth" */
  readonly path?: string;
  /** How long a sign-in lasts. Default: 7 days */
  readonly sessionSeconds?: number;
  /** Scopes new accounts get. Default: none */
  readonly defaultScopes?: readonly string[];
  /** Serve POST <path>/register. Turn off when accounts are created by server code. Default: true */
  readonly allowRegistration?: boolean;
  /** Default: 8 */
  readonly minPasswordLength?: number;
  /** Failed sign-ins allowed per email per 15 minutes. Default: 10 */
  readonly maxFailedLogins?: number;
  /** Scopes a request gets, e.g. from roles. Default: the account's `scopes`. */
  readonly resolveScopes?: (user: AuthUser) => readonly string[] | Promise<readonly string[]>;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly name?: string | undefined;
  /** Default: `defaultScopes`. Only server code can set this; the HTTP API ignores it. */
  readonly scopes?: readonly string[] | undefined;
}

export interface NexoAuth extends NexoModule {
  readonly apis: readonly NexoApi[];
  readonly path: string;
  /** Pass to `createHapiServer({ authenticate })`. Combine with others using `anyAuthenticator`. */
  readonly authenticate: NexoAuthenticator;
  /** Creates an account and signs it in. Throws 409 if the email is taken, 400 if input is invalid. */
  register(input: RegisterInput): Promise<AuthSession>;
  /** Throws 401 for a wrong email or password, 429 after too many failures. */
  login(email: string, password: string): Promise<AuthSession>;
  /** Ends one session. */
  logout(sessionId: string): Promise<void>;
  getUser(id: string): Promise<AuthUser | undefined>;
  findUserByEmail(email: string): Promise<AuthUser | undefined>;
  setScopes(userId: string, scopes: readonly string[]): Promise<AuthUser>;
  /** Changes the password and ends every session of the user. */
  setPassword(userId: string, password: string): Promise<void>;
}

interface StoredUser extends AuthUser {
  readonly passwordHash: string;
}

interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

const USERS = "auth-users";
const EMAILS = "auth-emails";
const SESSIONS = "auth-sessions";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD_LENGTH = 256;
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 } as const;

function scryptHash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptHash(password, salt);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , saltPart, keyPart] = stored.split("$");
  if (scheme !== "scrypt" || saltPart === undefined || keyPart === undefined) return false;
  const expected = Buffer.from(keyPart, "base64url");
  const actual = await scryptHash(password, Buffer.from(saltPart, "base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

function publicUser({ passwordHash: _hash, ...user }: StoredUser): AuthUser {
  return user;
}

const INVALID_CREDENTIALS = () => new NexoHttpError(401, "INVALID_CREDENTIALS", "Invalid email or password.");

export function createAuth(options: CreateAuthOptions): NexoAuth {
  if (Buffer.byteLength(options.secret, "utf8") < 32) {
    throw new NexoConfigurationError("createAuth(): secret must be at least 32 bytes.");
  }
  const { store, secret } = options;
  const path = (options.path ?? "/api/auth").replace(/\/+$/, "");
  const sessionSeconds = options.sessionSeconds ?? 7 * 24 * 60 * 60;
  const minPasswordLength = options.minPasswordLength ?? 8;
  const failedLogins = createRateLimiter({ windowMs: 15 * 60 * 1000, max: options.maxFailedLogins ?? 10 });
  // Compared against when the email is unknown, so both cases take the same time.
  const dummyHash = hashPassword(randomUUID());

  function checkPassword(password: unknown, field = "password"): string[] {
    if (typeof password !== "string") return [`Field "body.${field}" is required.`];
    if (password.length < minPasswordLength) return [`Field "body.${field}" must have length >= ${minPasswordLength}.`];
    if (password.length > MAX_PASSWORD_LENGTH) return [`Field "body.${field}" must have length <= ${MAX_PASSWORD_LENGTH}.`];
    return [];
  }

  async function startSession(user: StoredUser): Promise<AuthSession> {
    const now = Date.now();
    const session: StoredSession = {
      id: randomUUID(),
      userId: user.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + sessionSeconds * 1000).toISOString()
    };
    await store.put(SESSIONS, session.id, session);
    const token = signToken({ sub: user.id, sid: session.id }, secret, { expiresInSeconds: sessionSeconds, now });
    return { user: publicUser(user), token, expiresAt: session.expiresAt };
  }

  async function findStored(email: string): Promise<StoredUser | undefined> {
    const entry = await store.get<{ userId: string }>(EMAILS, normalizeEmail(email));
    return entry === undefined ? undefined : store.get<StoredUser>(USERS, entry.userId);
  }

  async function register(input: RegisterInput): Promise<AuthSession> {
    const email = typeof input.email === "string" ? normalizeEmail(input.email) : "";
    const errors = [
      ...(EMAIL_PATTERN.test(email) && email.length <= 254 ? [] : [`Field "body.email" must be an email address.`]),
      ...checkPassword(input.password),
      ...(input.name === undefined || (typeof input.name === "string" && input.name.length <= 200)
        ? []
        : [`Field "body.name" must be a string of at most 200 characters.`])
    ];
    if (errors.length > 0) throw new NexoValidationError(`Invalid registration: ${errors.join("; ")}`, errors);

    const id = randomUUID();
    if (!(await insertDocument(store, EMAILS, email, { userId: id }))) {
      throw new NexoHttpError(409, "EMAIL_TAKEN", "An account with this email already exists.");
    }
    const now = new Date().toISOString();
    const user: StoredUser = {
      id,
      email,
      ...(input.name !== undefined && input.name !== "" ? { name: input.name } : {}),
      scopes: [...(input.scopes ?? options.defaultScopes ?? [])],
      passwordHash: await hashPassword(input.password),
      createdAt: now,
      updatedAt: now
    };
    await store.put(USERS, id, user);
    return startSession(user);
  }

  async function login(email: unknown, password: unknown): Promise<AuthSession> {
    if (typeof email !== "string" || typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH) {
      throw INVALID_CREDENTIALS();
    }
    const key = normalizeEmail(email);
    const attempts = failedLogins.peek(key);
    if (!attempts.allowed) {
      throw new NexoHttpError(429, "TOO_MANY_ATTEMPTS", `Too many failed sign-ins; try again in ${Math.ceil(attempts.resetMs / 60000)} minutes.`);
    }
    const user = await findStored(key);
    const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
    if (user === undefined || !valid) {
      failedLogins.hit(key);
      throw INVALID_CREDENTIALS();
    }
    failedLogins.reset(key);
    return startSession(user);
  }

  async function logout(sessionId: string): Promise<void> {
    await store.delete(SESSIONS, sessionId);
  }

  async function getUser(id: string): Promise<AuthUser | undefined> {
    const user = await store.get<StoredUser>(USERS, id);
    return user === undefined ? undefined : publicUser(user);
  }

  async function updateUser(userId: string, change: (user: StoredUser) => StoredUser): Promise<StoredUser> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await store.get<StoredUser>(USERS, userId);
      if (current === undefined) throw new NexoHttpError(404, "NOT_FOUND", `User "${userId}" not found.`);
      const next = { ...change(current), updatedAt: new Date().toISOString() };
      if (await store.replaceIf(USERS, userId, current, next)) return next;
    }
    throw new NexoHttpError(409, "CONFLICT", `User "${userId}" kept changing; try again.`);
  }

  const authenticate: NexoAuthenticator = async (context) => {
    const header = context.headers.authorization ?? context.headers.Authorization;
    const token = /^Bearer\s+(\S+)\s*$/i.exec(typeof header === "string" ? header : "")?.[1];
    if (token === undefined) return { authenticated: false };
    const verified = verifyToken(token, secret);
    if (!verified.valid || typeof verified.claims.sid !== "string" || typeof verified.claims.sub !== "string") {
      return { authenticated: false };
    }
    const session = await store.get<StoredSession>(SESSIONS, verified.claims.sid);
    if (session === undefined || session.userId !== verified.claims.sub) return { authenticated: false };
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await store.delete(SESSIONS, session.id);
      return { authenticated: false };
    }
    const stored = await store.get<StoredUser>(USERS, session.userId);
    if (stored === undefined) return { authenticated: false };
    const user = publicUser(stored);
    const identity: AuthIdentity = {
      sub: user.id,
      email: user.email,
      ...(user.name !== undefined ? { name: user.name } : {}),
      sessionId: session.id
    };
    const scopes = options.resolveScopes ? await options.resolveScopes(user) : user.scopes;
    return { authenticated: true, identity, scopes: [...scopes] };
  };

  const identityOf = (context: NexoRequestContext): AuthIdentity => context.auth?.identity as AuthIdentity;
  const credentials = {
    type: "object" as const,
    required: ["email", "password"],
    properties: { email: { type: "string" as const }, password: { type: "string" as const } }
  };

  const apis: NexoApi[] = [
    {
      name: "auth.login",
      method: "POST",
      path: `${path}/login`,
      description: "Sign in with email and password. Answers { user, token, expiresAt }.",
      schema: { body: credentials },
      handler: (context) => {
        const body = context.payload as { email: string; password: string };
        return login(body.email, body.password);
      }
    },
    {
      name: "auth.logout",
      method: "POST",
      path: `${path}/logout`,
      description: "End the current session; its token stops working.",
      auth: { required: true },
      handler: async (context) => {
        await logout(identityOf(context).sessionId);
        return undefined;
      }
    },
    {
      name: "auth.me",
      method: "GET",
      path: `${path}/me`,
      description: "The signed-in user.",
      auth: { required: true },
      handler: async (context) => {
        const user = await getUser(identityOf(context).sub);
        if (user === undefined) throw new NexoHttpError(404, "NOT_FOUND", "User not found.");
        return { user };
      }
    }
  ];

  if (options.allowRegistration !== false) {
    apis.unshift({
      name: "auth.register",
      method: "POST",
      path: `${path}/register`,
      description: "Create an account and sign in. Answers 201 { user, token, expiresAt }; 409 if the email is taken.",
      schema: { body: { ...credentials, properties: { ...credentials.properties, name: { type: "string" } } } },
      handler: async (context) => {
        const body = context.payload as { email: string; password: string; name?: string };
        // Scopes are never taken from the request.
        return httpResponse(201, await register({ email: body.email, password: body.password, name: body.name }));
      }
    });
  }

  return {
    name: "auth",
    description: "Accounts, sign-in and sessions.",
    purpose: `Email and password sign-in at ${path}.`,
    apis,
    path,
    authenticate,
    register,
    login,
    logout,
    getUser,
    findUserByEmail: async (email) => {
      const user = await findStored(email);
      return user === undefined ? undefined : publicUser(user);
    },
    setScopes: async (userId, scopes) => publicUser(await updateUser(userId, (user) => ({ ...user, scopes: [...scopes] }))),
    setPassword: async (userId, password) => {
      const errors = checkPassword(password);
      if (errors.length > 0) throw new NexoValidationError(`Invalid password: ${errors.join("; ")}`, errors);
      const passwordHash = await hashPassword(password);
      await updateUser(userId, (user) => ({ ...user, passwordHash }));
      const sessions = await store.list<StoredSession>(SESSIONS);
      await Promise.all(sessions.filter((s) => s.userId === userId).map((s) => store.delete(SESSIONS, s.id)));
    }
  };
}

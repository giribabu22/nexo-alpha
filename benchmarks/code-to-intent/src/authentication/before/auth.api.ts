import {
  NexoHttpError,
  httpResponse,
  signToken,
  verifyToken,
  type NexoAuthenticator,
  type NexoDocumentStore,
  type NexoFieldSchema,
  type NexoModule,
  type NexoRequestContext
} from "@nexo-alpha/core";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

interface Account {
  id: string;
  email: string;
  name?: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

interface Session {
  id: string;
  userId: string;
  expiresAt: string;
}

const SESSION_SECONDS = 7 * 24 * 60 * 60;

const credentials: NexoFieldSchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
    password: { type: "string", minLength: 8 },
    name: { type: "string" }
  }
};

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  return timingSafeEqual(scryptSync(password, Buffer.from(salt!, "hex"), 64), Buffer.from(key!, "hex"));
}

function publicUser({ passwordHash: _hash, ...user }: Account): Omit<Account, "passwordHash"> {
  return user;
}

export function setup(store: NexoDocumentStore, secret: string): { modules: NexoModule[]; authenticate: NexoAuthenticator } {
  async function startSession(account: Account): Promise<{ user: Omit<Account, "passwordHash">; token: string }> {
    const session: Session = {
      id: randomUUID(),
      userId: account.id,
      expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()
    };
    await store.put("sessions", session.id, session);
    const token = signToken({ sub: account.id, sid: session.id }, secret, { expiresInSeconds: SESSION_SECONDS });
    return { user: publicUser(account), token };
  }

  const authenticate: NexoAuthenticator = async (context) => {
    const token = /^Bearer\s+(\S+)$/i.exec(context.headers.authorization ?? "")?.[1];
    const verified = token === undefined ? undefined : verifyToken(token, secret);
    if (verified === undefined || !verified.valid) return { authenticated: false };
    const session = await store.get<Session>("sessions", String(verified.claims.sid));
    if (session === undefined || session.userId !== verified.claims.sub || Date.parse(session.expiresAt) < Date.now()) {
      return { authenticated: false };
    }
    return { authenticated: true, identity: { sub: session.userId, sessionId: session.id } };
  };

  // Handlers don't receive the authenticated caller, so look it up again.
  const caller = async (context: NexoRequestContext) =>
    (await authenticate(context)).identity as { sub: string; sessionId: string };

  const modules: NexoModule[] = [
    {
      name: "auth",
      apis: [
        {
          name: "register",
          method: "POST",
          path: "/api/auth/register",
          schema: { body: credentials },
          handler: async (context) => {
            const input = context.payload as { email: string; password: string; name?: string };
            const email = input.email.trim().toLowerCase();
            if ((await store.get("emails", email)) !== undefined) {
              throw new NexoHttpError(409, "EMAIL_TAKEN", "An account with this email already exists.");
            }
            const now = new Date().toISOString();
            const account: Account = {
              id: randomUUID(),
              email,
              ...(input.name !== undefined ? { name: input.name } : {}),
              passwordHash: hashPassword(input.password),
              createdAt: now,
              updatedAt: now
            };
            await store.put("emails", email, { userId: account.id });
            await store.put("accounts", account.id, account);
            return httpResponse(201, await startSession(account));
          }
        },
        {
          name: "login",
          method: "POST",
          path: "/api/auth/login",
          schema: { body: { type: "object", required: ["email", "password"], properties: { email: { type: "string" }, password: { type: "string" } } } },
          handler: async (context) => {
            const input = context.payload as { email: string; password: string };
            const entry = await store.get<{ userId: string }>("emails", input.email.trim().toLowerCase());
            const account = entry === undefined ? undefined : await store.get<Account>("accounts", entry.userId);
            if (account === undefined || !passwordMatches(input.password, account.passwordHash)) {
              throw new NexoHttpError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
            }
            return startSession(account);
          }
        },
        {
          name: "logout",
          method: "POST",
          path: "/api/auth/logout",
          auth: { required: true },
          handler: async (context) => {
            await store.delete("sessions", (await caller(context)).sessionId);
            return undefined;
          }
        },
        {
          name: "me",
          method: "GET",
          path: "/api/auth/me",
          auth: { required: true },
          handler: async (context) => {
            const account = await store.get<Account>("accounts", (await caller(context)).sub);
            if (account === undefined) throw new NexoHttpError(404, "NOT_FOUND", "User not found.");
            return { user: publicUser(account) };
          }
        }
      ]
    }
  ];

  return { modules, authenticate };
}

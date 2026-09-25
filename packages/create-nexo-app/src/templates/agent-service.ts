import { Template, TemplateFile } from "./types.js";

const NEXO_VERSION = "^0.6.0";

/**
 * An agent workflow service on the production runtime: JWT auth, role-based
 * tool permissions, workflows executed by a persistent job queue, agent
 * memory, structured logs, rate limiting, metrics (JSON + Prometheus), a
 * health check and a Dockerfile.
 */
export const agentServiceTemplate: Template = {
  name: "agent-service",
  description: "Agent workflow service: JWT auth, RBAC, queued workflows, memory, metrics and Docker",
  getFiles(projectName: string): TemplateFile[] {
    return [
      {
        path: ".gitignore",
        content: `node_modules
dist
data
.env
*.log
.nexo
`
      },
      {
        path: ".dockerignore",
        content: `node_modules
dist
data
.git
.env
*.log
`
      },
      {
        path: ".env.example",
        content: `PORT=3000
HOST=localhost
# At least 32 bytes. Required when NODE_ENV=production.
JWT_SECRET=
DATA_DIR=data
`
      },
      {
        path: "Dockerfile",
        content: `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \\
    HOST=0.0.0.0 \\
    PORT=3000 \\
    DATA_DIR=/app/data
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \\
  CMD wget -qO- "http://127.0.0.1:\${PORT}/health" > /dev/null || exit 1
CMD ["node", "dist/index.js"]
`
      },
      {
        path: "README.md",
        content: `# ${projectName}

An agent workflow service built on [Nexo](https://www.npmjs.com/package/@nexo-alpha/core).

- **Workflows over HTTP**, executed in a persistent background queue (SQLite on Node >= 22.5, a JSON file otherwise).
- **JWT authentication** and **role-based tool permissions**: a tool only runs if the caller's roles grant its permissions.
- **Agent memory**, structured JSON logs with request IDs, rate limiting, and metrics (JSON and Prometheus).

## Run it

\`\`\`bash
npm install
npm run dev        # prints a development token for each demo user
\`\`\`

\`\`\`bash
curl -X POST http://localhost:3000/workflows/support/runs \\
  -H "authorization: Bearer $TOKEN_ALICE" -H "content-type: application/json" \\
  -d '{"goal":"Printer on floor 3 is jammed"}'
# 202 Accepted + Location: /workflows/support/runs/<id>, poll it for the result
\`\`\`

| Route | Purpose |
|---|---|
| \`GET /workflows\`, \`GET /workflows/support\` | Discover workflows and their tools |
| \`POST /workflows/support/runs\` | Start a run (answers 202; runs in the background) |
| \`GET /workflows/support/runs/:id\` | Run status and step history |
| \`GET /metrics\`, \`GET /metrics/prometheus\` | Metrics (admins) |
| \`GET /health\` | Liveness probe |

## Where to go next

- **Tools** live in \`src/app.ts\`. Each declares the \`permissions\` it needs. Generate more with \`npx nexo generate tool <name>\`.
- **Planning.** \`planner\` in \`src/app.ts\` maps a goal to steps. Replace it with an LLM-backed IntentParser.
- **Users and roles.** \`USER_ROLES\` is a demo map; load roles from your user store instead.
- **Checks and tests.** \`npm test\` runs the tests. \`npx nexo doctor\` checks your setup.

## Deploy

\`\`\`bash
docker build -t ${projectName} .
docker run -p 3000:3000 -e JWT_SECRET=<32+ byte secret> -v ${projectName}-data:/app/data ${projectName}
\`\`\`
`
      },
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: projectName,
            version: "0.1.0",
            private: true,
            type: "module",
            engines: { node: ">=20" },
            scripts: {
              dev: "tsc && node dist/index.js",
              build: "tsc",
              start: "node dist/index.js",
              typecheck: "tsc --noEmit",
              test: "tsc && node --test",
              doctor: "nexo doctor",
              inspect: "nexo inspect"
            },
            dependencies: {
              "@nexo-alpha/agent": NEXO_VERSION,
              "@nexo-alpha/core": NEXO_VERSION,
              "@nexo-alpha/decision": NEXO_VERSION,
              "@nexo-alpha/hapi": NEXO_VERSION,
              "@nexo-alpha/scheduler": NEXO_VERSION,
              "@nexo-alpha/tools": NEXO_VERSION
            },
            devDependencies: {
              "@nexo-alpha/cli": NEXO_VERSION,
              "@types/node": "^20.11.0",
              typescript: "^5.4.0"
            }
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              lib: ["ES2022"],
              strict: true,
              skipLibCheck: true,
              forceConsistentCasingInFileNames: true,
              outDir: "./dist",
              rootDir: "./src",
              declaration: true
            },
            include: ["src/**/*"]
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "nexo.config.json",
        content: JSON.stringify({ app: "./dist/inspect.js" }, null, 2) + "\n"
      },
      {
        path: "src/app.ts",
        content: `import {
  createApplication,
  createLogger,
  jwtAuthenticator,
  verifyToken,
  type NexoAuthenticator,
  type NexoDocumentStore,
  type NexoLogger,
  type NexoRequestContext
} from "@nexo-alpha/core";
import { createAccessControl, createDecisionEngine } from "@nexo-alpha/decision";
import {
  createAgent,
  createDocumentAgentMemory,
  createDocumentWorkflowStore,
  createWorkflow,
  createWorkflowApiModule,
  toolPermissionRule,
  type IntentParser
} from "@nexo-alpha/agent";
import { createJobQueue, type NexoJobQueue } from "@nexo-alpha/scheduler";
import { createMetricsApiModule, createMetricsCollector } from "@nexo-alpha/tools";

/** Roles and the permissions they grant (used as HTTP scopes and tool permissions). */
export const access = createAccessControl([
  { name: "member", permissions: ["tickets:create", "workflows:run"] },
  { name: "admin", permissions: ["*"] }
]);

/** Demo users. Load roles from your user store in a real service. */
export const USER_ROLES: Readonly<Record<string, readonly string[]>> = {
  alice: ["member"],
  admin: ["admin"]
};

const rolesOf = (user: string | undefined): readonly string[] => (user === undefined ? [] : USER_ROLES[user] ?? []);

/**
 * Turns a goal into steps: open a ticket, then finish.
 * Replace with an LLM-backed IntentParser to plan from natural language.
 */
const planner: IntentParser = {
  async parse(goal, options) {
    const step = (options?.workflowState as { step?: number } | undefined)?.step ?? 1;
    return step === 1
      ? { action: "create_ticket", payload: { title: goal } }
      : { action: "complete", payload: { result: "Ticket created." } };
  }
};

export interface ServiceOptions {
  readonly store: NexoDocumentStore;
  /** At least 32 bytes. */
  readonly jwtSecret: string;
  readonly logger?: NexoLogger;
  readonly pollIntervalMs?: number;
}

export interface Service {
  readonly app: ReturnType<typeof createApplication>;
  readonly queue: NexoJobQueue;
  readonly authenticate: NexoAuthenticator;
}

export function createService(options: ServiceOptions): Service {
  const logger = options.logger ?? createLogger({ fields: { service: "${projectName}" } });
  const app = createApplication({ name: "${projectName}" });
  const metrics = createMetricsCollector(app);
  const queue = createJobQueue({
    store: options.store,
    pollIntervalMs: options.pollIntervalMs ?? 250,
    onEvent: (event) => {
      metrics.queueListener(event);
      if (event.type === "job.failed") logger.error("job failed", { jobId: event.job.id, error: event.job.error });
    }
  });

  // --- Agent -----------------------------------------------------------------
  const engine = createDecisionEngine({ name: "${projectName}" });
  const agent = createAgent({ name: "support-agent", decisionEngine: engine });

  agent.tools.register({
    action: "create_ticket",
    description: "Opens a support ticket",
    permissions: ["tickets:create"],
    timeoutMs: 5_000,
    async execute({ intent }) {
      const title = String(intent.payload?.title ?? "").trim();
      if (title === "") return { success: false, error: "A ticket needs a title.", durationMs: 0 };
      const ticket = { id: "t-" + Date.now().toString(36), title, openedBy: intent.actor, openedAt: new Date().toISOString() };
      await options.store.put("tickets", ticket.id, ticket);
      return { success: true, data: ticket, durationMs: 0 };
    }
  });

  // A tool runs only when the actor's roles grant the permissions it declares.
  engine.addRule(toolPermissionRule({ access, tools: agent.tools, resolveRoles: ({ intent }) => rolesOf(intent.actor) }));

  const support = createWorkflow({
    name: "support",
    agent,
    maxSteps: 5,
    parser: planner,
    store: createDocumentWorkflowStore(options.store),
    memory: createDocumentAgentMemory(options.store),
    onEvent: metrics.workflowListener
  });

  // --- HTTP ------------------------------------------------------------------
  const authenticate = jwtAuthenticator({
    secret: options.jwtSecret,
    issuer: "${projectName}",
    resolve: (claims) => ({ identity: claims.sub, scopes: [...access.permissionsFor(rolesOf(claims.sub))] })
  });

  /** The authenticated user, from the verified token (never from the request body). */
  const resolveActor = (context: NexoRequestContext): string | undefined => {
    const token = /^Bearer\\s+(\\S+)$/i.exec(context.headers.authorization ?? "")?.[1];
    if (token === undefined) return undefined;
    const verified = verifyToken(token, options.jwtSecret, { issuer: "${projectName}" });
    return verified.valid ? verified.claims.sub : undefined;
  };

  app.module(createWorkflowApiModule({
    workflows: [support],
    queue,
    resolveActor,
    auth: { required: true, scopes: ["workflows:run"] }
  }));
  app.module(createMetricsApiModule(metrics, { auth: { required: true, scopes: ["metrics:read"] } }));

  const startedAt = Date.now();
  app.module({
    name: "system",
    apis: [{
      name: "health",
      method: "GET",
      path: "/health",
      handler: () => ({ status: "ok", uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) })
    }]
  });

  return { app, queue, authenticate };
}
`
      },
      {
        path: "src/inspect.ts",
        content: `/**
 * An in-memory instance for introspection only (\`nexo inspect\`, \`nexo graph\`);
 * nexo.config.json points here. The running service is started by index.ts.
 */
import { createInMemoryDocumentStore } from "@nexo-alpha/core";
import { createService } from "./app.js";

export const { app } = createService({
  store: createInMemoryDocumentStore(),
  jwtSecret: "introspection-only-secret-never-used-to-serve"
});
`
      },
      {
        path: "src/index.ts",
        content: `import {
  createFileDocumentStore,
  createLogger,
  createSqliteDocumentStore,
  signToken,
  type NexoDocumentStore
} from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { createService, USER_ROLES } from "./app.js";

const logger = createLogger({ fields: { service: "${projectName}" } });

if (process.env.NODE_ENV === "production" && process.env.JWT_SECRET === undefined) {
  logger.error("JWT_SECRET must be set in production (at least 32 bytes).");
  process.exit(1);
}
const jwtSecret = process.env.JWT_SECRET ?? "development-only-secret-change-me-please!";
const dataDir = process.env.DATA_DIR ?? "data";

// SQLite on Node >= 22.5 (several processes can share it); a JSON file otherwise.
let store: NexoDocumentStore;
try {
  store = await createSqliteDocumentStore(dataDir + "/${projectName}.sqlite");
} catch {
  logger.warn("node:sqlite unavailable; using a JSON file store");
  store = createFileDocumentStore(dataDir + "/${projectName}.json");
}

const service = createService({ store, jwtSecret, logger });
await service.app.start();
await service.queue.start();

const server = await startHapiServer(service.app, {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "localhost",
  logger,
  authenticate: service.authenticate,
  rateLimit: { windowMs: 60_000, max: 300, key: (request) => (request.path === "/health" ? undefined : request.remoteAddress) }
});
logger.info("listening", { url: server.info.uri });

if (process.env.JWT_SECRET === undefined) {
  for (const user of Object.keys(USER_ROLES)) {
    const token = signToken({ sub: user, iss: "${projectName}" }, jwtSecret, { expiresInSeconds: 8 * 3600 });
    console.log("export TOKEN_" + user.toUpperCase() + "=" + token);
  }
}

const shutdown = async (): Promise<void> => {
  await server.stop({ timeout: 5000 });
  await service.queue.stop();
  await service.app.stop();
  await store.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
`
      },
      {
        path: "test/service.test.js",
        content: `import test from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDocumentStore, signToken } from "@nexo-alpha/core";
import { createHapiServer } from "@nexo-alpha/hapi";
import { createService } from "../dist/app.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";

async function setup() {
  const service = createService({ store: createInMemoryDocumentStore(), jwtSecret: SECRET, pollIntervalMs: 10 });
  const server = await createHapiServer(service.app, { authenticate: service.authenticate, logging: false });
  await service.queue.start();
  const call = async (user, method, url, payload) => {
    const headers = user === undefined ? {} : { authorization: "Bearer " + signToken({ sub: user, iss: "${projectName}" }, SECRET, { expiresInSeconds: 60 }) };
    const response = await server.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
    return { status: response.statusCode, body: response.payload ? JSON.parse(response.payload) : undefined };
  };
  return { service, call };
}

test("a member opens a ticket through a queued workflow run", async () => {
  const { service, call } = await setup();
  try {
    const started = await call("alice", "POST", "/workflows/support/runs", { goal: "Printer is jammed" });
    assert.equal(started.status, 202);
    await service.queue.whenIdle();

    const run = await call("alice", "GET", "/workflows/support/runs/" + started.body.id);
    assert.equal(run.body.status, "COMPLETED");
    assert.equal(run.body.context.create_ticket.title, "Printer is jammed");
    assert.equal(run.body.context.create_ticket.openedBy, "alice");
  } finally {
    await service.queue.stop();
  }
});

test("requests without a valid token are rejected; metrics need admin", async () => {
  const { service, call } = await setup();
  try {
    assert.equal((await call(undefined, "GET", "/workflows")).status, 401);
    assert.equal((await call("mallory", "GET", "/workflows")).status, 403);
    assert.equal((await call("alice", "GET", "/metrics")).status, 403);
    assert.equal((await call("admin", "GET", "/metrics")).status, 200);
    assert.equal((await call(undefined, "GET", "/health")).status, 200);
  } finally {
    await service.queue.stop();
  }
});
`
      }
    ];
  }
};

import { createFileDocumentStore, createLogger, createSqliteDocumentStore, signToken, type NexoDocumentStore } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { createSupportDesk, DEMO_PROJECTS, PLATFORM_ADMINS, seedDemoProjects } from "./app.js";

const logger = createLogger({ fields: { service: "support-desk" } });
if (process.env.NODE_ENV === "production" && process.env.JWT_SECRET === undefined) {
  logger.error("JWT_SECRET must be set in production (at least 32 bytes).");
  process.exit(1);
}
const jwtSecret = process.env.JWT_SECRET ?? "dev-only-secret-change-me-in-production!!";
const port = Number(process.env.PORT ?? 4000);
// Containers must listen on all interfaces; local development stays on localhost.
const host = process.env.HOST ?? "localhost";
const dataDir = process.env.DATA_DIR ?? "data";

// SQLite on Node >= 22.5; a JSON file otherwise.
let store: NexoDocumentStore;
try {
  store = await createSqliteDocumentStore(`${dataDir}/support-desk.sqlite`);
} catch {
  logger.warn("node:sqlite unavailable; using a JSON file store");
  store = createFileDocumentStore(`${dataDir}/support-desk.json`);
}

const desk = createSupportDesk({ store, jwtSecret, logger });
if (process.env.SEED_DEMO !== "false") await seedDemoProjects(desk.projects);
await desk.app.start();
await desk.queue.start();
const server = await startHapiServer(desk.app, {
  port,
  host,
  logger,
  authenticate: desk.authenticate,
  project: desk.project,
  rateLimit: {
    windowMs: 60_000,
    max: 300,
    key: (request) => (request.path === "/health" ? undefined : request.remoteAddress)
  }
});

logger.info("support desk listening", { url: server.info.uri });
if (process.env.JWT_SECRET === undefined) {
  const users = [...new Set([...DEMO_PROJECTS.flatMap((project) => Object.keys(project.members)), ...PLATFORM_ADMINS])];
  for (const user of users) {
    const token = signToken({ sub: user, iss: "support-desk" }, jwtSecret, { expiresInSeconds: 8 * 3600 });
    console.log(`\n${user}:\n  export TOKEN_${user.toUpperCase()}=${token}`);
  }
  console.log(`\nProjects: ${DEMO_PROJECTS.map((p) => `${p.id} (${Object.entries(p.members).map(([u, r]) => `${u}: ${r.join(",")}`).join("; ")})`).join(" | ")}`);
  console.log(`\nTry:\n  curl -X POST ${server.info.uri}/workflows/refunds/runs -H "authorization: Bearer $TOKEN_SAM" -H "x-project-id: acme" -H "content-type: application/json" -d '{"goal":"Refund order o-1"}'\n`);
}

const shutdown = async (): Promise<void> => {
  await server.stop();
  await desk.queue.stop();
  await store.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

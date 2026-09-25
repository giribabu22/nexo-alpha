/**
 * Interactive playground for the support desk: explore auth, RBAC, human
 * approval, the background queue, memory and metrics from a terminal.
 *
 *   pnpm --filter @nexo/example-support-desk playground
 *
 * Commands go through the real HTTP API (in-process, via server.inject),
 * so what you see is exactly what a client would see.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createInMemoryDocumentStore, createLogger, signToken } from "@nexo-alpha/core";
import { createHapiServer } from "@nexo-alpha/hapi";
import { createSupportDesk, DEMO_PROJECTS, ORDERS, PLATFORM_ADMINS, seedDemoProjects } from "./app.js";

const USERS = [...new Set([...DEMO_PROJECTS.flatMap((project) => Object.keys(project.members)), ...PLATFORM_ADMINS])];

/** "viewer in acme, manager in globex" style summary of a user's memberships. */
function describeUser(user: string): string {
  const memberships = DEMO_PROJECTS
    .filter((project) => project.members[user] !== undefined)
    .map((project) => `${project.members[user]!.join(",")} in ${project.id}`);
  if (PLATFORM_ADMINS.includes(user)) memberships.push("platform admin");
  return memberships.join("; ");
}

const SECRET = "playground-secret-that-is-at-least-32-bytes";

const HELP = `Commands:
  as <user>            act as one of: ${USERS.map((u) => `${u} (${describeUser(u)})`).join(", ")}
  project <id>         switch project (${DEMO_PROJECTS.map((p) => p.id).join(", ")})
  projects             projects the current user belongs to
  refund <order-id>    start a refund run (orders: ${Object.entries(ORDERS).map(([id, o]) => `${id} $${o.amount}`).join(", ")})
  runs                 list refund runs
  show <run-id>        show a run's steps and decisions
  approve <run-id>     resume a paused run as the current user
  memory [text]        search agent memory
  metrics              workflow and queue metrics (this project; platform totals for admins)
  help                 this help
  exit                 quit`;

interface Run {
  readonly id: string;
  readonly status: string;
  readonly goal: string;
  readonly error?: string;
  readonly history: readonly { intent: { action: string; actor?: string }; status: string; decision: { result: string; reason?: string } }[];
  readonly pendingDecision?: { question?: string; reason?: string };
}

export interface Playground {
  /** Runs one command line and returns the text to print. */
  execute(line: string): Promise<string>;
  readonly user: string;
  close(): Promise<void>;
}

export async function createPlayground(): Promise<Playground> {
  const desk = createSupportDesk({
    store: createInMemoryDocumentStore(),
    jwtSecret: SECRET,
    logger: createLogger({ level: "error" }),
    pollIntervalMs: 20
  });
  const server = await createHapiServer(desk.app, { authenticate: desk.authenticate, project: desk.project, logging: false });
  await seedDemoProjects(desk.projects);
  await desk.queue.start();
  let user = "sam";
  let projectId = "acme";

  async function call(method: string, url: string, payload?: unknown): Promise<{ status: number; body: any }> {
    const token = signToken({ sub: user, iss: "support-desk" }, SECRET, { expiresInSeconds: 300 });
    const response = await server.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, "x-project-id": projectId },
      ...(payload !== undefined ? { payload: payload as object } : {})
    });
    return { status: response.statusCode, body: response.payload ? JSON.parse(response.payload) : undefined };
  }

  const describe = (run: Run): string => {
    const lines = [`${run.id}  ${run.status}  "${run.goal}"`];
    run.history.forEach((step, index) => {
      lines.push(`  ${index + 1}. ${step.intent.action} by ${step.intent.actor ?? "?"} → ${step.decision.result} / ${step.status}${step.decision.reason ? ` (${step.decision.reason})` : ""}`);
    });
    if (run.pendingDecision) lines.push(`  ⏸ ${run.pendingDecision.question ?? run.pendingDecision.reason ?? "waiting"}  →  approve ${run.id}`);
    if (run.error) lines.push(`  ✖ ${run.error}`);
    return lines.join("\n");
  };

  const settled = async (id: string): Promise<string> => {
    await desk.queue.whenIdle();
    const { status, body } = await call("GET", `/workflows/refunds/runs/${id}`);
    return status === 200 ? describe(body as Run) : `HTTP ${status}: ${body?.error ?? ""}`;
  };

  return {
    get user() {
      return user;
    },

    async execute(line) {
      const [command = "", ...args] = line.trim().split(/\s+/);
      const arg = args.join(" ");
      switch (command.toLowerCase()) {
        case "":
          return "";
        case "help":
          return HELP;
        case "as":
          if (!USERS.includes(arg)) return `Unknown user "${arg}". Users: ${USERS.join(", ")}`;
          user = arg;
          return `Now acting as ${user} (${describeUser(user)}).`;
        case "project":
          if (!DEMO_PROJECTS.some((project) => project.id === arg)) return `Unknown project "${arg}". Projects: ${DEMO_PROJECTS.map((p) => p.id).join(", ")}`;
          projectId = arg;
          return `Now in project ${projectId}.`;
        case "projects": {
          const { status, body } = await call("GET", "/projects");
          if (status < 200 || status > 299) return `HTTP ${status}: ${body?.error ?? ""}`;
          const projects = body.projects as { id: string; name: string; members: Record<string, string[]> }[];
          return projects.length === 0 ? "No projects." : projects.map((p) => `${p.id}  "${p.name}"  (${p.members[user]!.join(",")})`).join("\n");
        }
        case "refund": {
          const { status, body } = await call("POST", "/workflows/refunds/runs", { goal: `Refund order ${arg}` });
          if (status < 200 || status > 299) return `HTTP ${status}: ${body?.error ?? ""}${body?.missingScopes ? ` (missing ${body.missingScopes.join(", ")})` : ""}`;
          return `queued ${body.id}\n${await settled(body.id)}`;
        }
        case "runs": {
          const { status, body } = await call("GET", "/workflows/refunds/runs");
          if (status < 200 || status > 299) return `HTTP ${status}: ${body?.error ?? ""}`;
          const runs = body.runs as Run[];
          return runs.length === 0 ? "No runs yet." : runs.map((run) => `${run.id}  ${run.status}  "${run.goal}"`).join("\n");
        }
        case "show":
          return settled(arg);
        case "approve": {
          const { status, body } = await call("POST", `/workflows/refunds/runs/${arg}/resume`, { response: { approvedBy: user } });
          if (status < 200 || status > 299) return `HTTP ${status}: ${body?.error ?? ""}`;
          return settled(arg);
        }
        case "memory": {
          const { status, body } = await call("GET", `/memory${arg ? `?text=${encodeURIComponent(arg)}` : ""}`);
          if (status < 200 || status > 299) return `HTTP ${status}: ${body?.error ?? ""}`;
          const entries = body.entries as { key: string; value: unknown }[];
          return entries.length === 0 ? "Memory is empty." : entries.map((e) => `${e.key} = ${JSON.stringify(e.value)}`).join("\n");
        }
        case "metrics": {
          const { status, body } = await call("GET", PLATFORM_ADMINS.includes(user) ? "/metrics" : "/project/metrics");
          if (status < 200 || status > 299) return `HTTP ${status}: ${body?.error ?? ""}`;
          const refunds = body.workflows.refunds;
          const queue = body.queues["nexo.workflow.execute"];
          return [
            refunds ? `refunds: started ${refunds.started}, completed ${refunds.completed}, failed ${refunds.failed}, paused ${refunds.paused}` : "refunds: no runs yet",
            queue ? `queue: enqueued ${queue.enqueued}, completed ${queue.completed}, failed ${queue.failed}` : "queue: idle"
          ].join("\n");
        }
        default:
          return `Unknown command "${command}". Type "help".`;
      }
    },

    async close() {
      await desk.queue.stop();
    }
  };
}

// Run interactively when executed directly.
if (process.argv[1]?.endsWith("playground.js") === true) {
  const playground = await createPlayground();
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`Nexo support-desk playground. Type "help" for commands.\n`);
  rl.setPrompt(`${playground.user}> `);
  rl.prompt();
  // Iterating ends cleanly at EOF (Ctrl+D or piped input), unlike rl.question().
  for await (const line of rl) {
    if (line.trim() === "exit" || line.trim() === "quit") break;
    try {
      const output = await playground.execute(line);
      if (output !== "") console.log(output);
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    rl.setPrompt(`${playground.user}> `);
    rl.prompt();
  }
  rl.close();
  await playground.close();
}

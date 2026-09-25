/**
 * Support desk: a multi-tenant refund workflow served over HTTP with the full
 * Nexo runtime.
 *
 * - Projects (tenants): every request names its project (`x-project-id`);
 *   runs, memory and webhook subscriptions are isolated per project.
 * - JWT auth; a user's roles are per project and grant permissions, used both
 *   as HTTP scopes and as tool permissions (RBAC through the Decision Engine).
 * - Refunds over $100 pause for a manager's approval (ASK_USER → resume).
 * - Runs execute in a persistent background queue; the API answers at once.
 * - Refunds are remembered in agent memory; workflow events go to webhooks
 *   and metrics.
 */

import {
  NexoHttpError,
  createApplication,
  createLogger,
  createProjectApiModule,
  createProjectRegistry,
  currentProjectId,
  jwtAuthenticator,
  scopeByProject,
  verifyToken,
  type NexoAuthenticator,
  type NexoDocumentStore,
  type NexoLogger,
  type NexoRequestContext,
  type ProjectRegistry
} from "@nexo-alpha/core";
import type { HapiProjectOptions } from "@nexo-alpha/hapi";
import { confirmationRule, createAccessControl, createDecisionEngine } from "@nexo-alpha/decision";
import {
  createAgent,
  createDocumentAgentMemory,
  createDocumentWorkflowStore,
  createMemoryApiModule,
  createWorkflow,
  createWorkflowApiModule,
  toolPermissionRule,
  type AgentMemory,
  type IntentParser,
  type WorkflowEvent
} from "@nexo-alpha/agent";
import { createJobQueue, type NexoJobQueue } from "@nexo-alpha/scheduler";
import { createMetricsApiModule, createMetricsCollector, type NexoMetricsCollector } from "@nexo-alpha/tools";
import { createWebhookDispatcher, type WebhookDispatcher } from "@nexo-alpha/webhooks";

// ---------------------------------------------------------------------------
// Users, roles and permissions
// ---------------------------------------------------------------------------

/** Roles within a project. "owner" is what a project's creator gets. */
export const access = createAccessControl([
  { name: "viewer", permissions: ["orders:read", "workflows:run", "memory:read", "metrics:read"] },
  { name: "support", permissions: ["orders:refund"], inherits: ["viewer"] },
  { name: "manager", permissions: ["orders:*", "memory:*"], inherits: ["support"] },
  { name: "owner", permissions: [], inherits: ["manager"] }
]);

/** Users with platform-wide (cross-project) access: here, only to metrics. */
export const PLATFORM_ADMINS: readonly string[] = ["ops"];

/** Demo tenants and their members. In a real app, users create projects through the API. */
export const DEMO_PROJECTS: readonly { id: string; name: string; members: Readonly<Record<string, readonly string[]>> }[] = [
  { id: "acme", name: "Acme Corp", members: { ann: ["viewer"], sam: ["support"], max: ["manager"] } },
  { id: "globex", name: "Globex", members: { max: ["manager"], gus: ["support"] } }
];

/** Creates the demo projects if they don't exist yet. */
export async function seedDemoProjects(registry: ProjectRegistry): Promise<void> {
  for (const project of DEMO_PROJECTS) {
    if ((await registry.get(project.id)) !== undefined) continue;
    const [owner, ...others] = Object.entries(project.members);
    await registry.create({ id: project.id, name: project.name, owner: owner![0] });
    await registry.setMember(project.id, owner![0], owner![1]);
    for (const [user, roles] of others) await registry.setMember(project.id, user, roles);
  }
}

// ---------------------------------------------------------------------------
// Demo order data
// ---------------------------------------------------------------------------

export const ORDERS: Readonly<Record<string, { readonly amount: number; readonly customer: string }>> = {
  "o-1": { amount: 40, customer: "c-100" },
  "o-2": { amount: 250, customer: "c-200" }
};

/**
 * Plans "Refund order <id>": look the order up, refund it, then finish.
 * An LLM-backed parser would plug in here the same way.
 */
const refundPlanner: IntentParser = {
  async parse(goal, options) {
    const state = options?.workflowState as { step: number } | undefined;
    const orderId = /\bo-\d+\b/.exec(goal)?.[0];
    if (orderId === undefined) return { action: "complete", payload: { result: "No order ID in the goal." } };
    switch (state?.step ?? 1) {
      case 1: return { action: "lookup_order", target: orderId };
      case 2: return { action: "refund_order", target: orderId, payload: { amount: ORDERS[orderId]?.amount ?? 0 } };
      default: return { action: "complete", payload: { result: `Order ${orderId} refunded.` } };
    }
  }
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface SupportDeskOptions {
  /** Unscoped store; the desk scopes tenant data by project itself. */
  readonly store: NexoDocumentStore;
  /** At least 32 bytes. */
  readonly jwtSecret: string;
  readonly logger?: NexoLogger;
  /** Job queue poll interval. Default: 250 */
  readonly pollIntervalMs?: number;
}

export interface SupportDesk {
  readonly app: ReturnType<typeof createApplication>;
  readonly queue: NexoJobQueue;
  readonly metrics: NexoMetricsCollector;
  readonly webhooks: WebhookDispatcher;
  readonly memory: AgentMemory;
  readonly projects: ProjectRegistry;
  /** Pass to createHapiServer({ authenticate }). */
  readonly authenticate: NexoAuthenticator;
  /** Pass to createHapiServer({ project }). */
  readonly project: HapiProjectOptions;
}

export function createSupportDesk(options: SupportDeskOptions): SupportDesk {
  const logger = options.logger ?? createLogger({ fields: { service: "support-desk" } });
  const app = createApplication({ name: "support-desk" });
  const metrics = createMetricsCollector(app);
  const queue = createJobQueue({
    store: options.store,
    pollIntervalMs: options.pollIntervalMs ?? 250,
    onEvent: (event) => {
      metrics.queueListener(event);
      if (event.type === "job.failed") logger.error("job failed", { jobId: event.job.id, type: event.job.type, error: event.job.error });
    }
  });
  // Tenant data lives in project-scoped collections; code that forgets to enter
  // a project fails instead of reading or writing across tenants.
  const tenantStore = scopeByProject(options.store, { required: true });
  const projects = createProjectRegistry(options.store);
  const rolesOf = async (user: string | undefined): Promise<readonly string[]> => {
    const projectId = currentProjectId();
    return user === undefined || projectId === undefined ? [] : projects.rolesOf(projectId, user);
  };

  const webhooks = createWebhookDispatcher({ store: tenantStore, queue });
  const memory = createDocumentAgentMemory(tenantStore);

  // --- Agent: tools declare the permissions they need -----------------------
  const engine = createDecisionEngine({ name: "support-desk" });
  const agent = createAgent({ name: "refund-agent", decisionEngine: engine });

  agent.tools.register({
    action: "lookup_order",
    description: "Loads an order",
    permissions: ["orders:read"],
    execute: async ({ intent }) => {
      const order = ORDERS[intent.target ?? ""];
      return order !== undefined
        ? { success: true, data: { orderId: intent.target, ...order }, durationMs: 1 }
        : { success: false, error: `Order ${intent.target} not found.`, durationMs: 1 };
    }
  });

  agent.tools.register({
    action: "refund_order",
    description: "Refunds an order to the original payment method",
    permissions: ["orders:refund"],
    execute: async ({ intent, extras }) => {
      const workflowMemory = extras?.memory as AgentMemory | undefined;
      await workflowMemory?.remember(`refund:${intent.target}`, { amount: intent.payload?.amount, by: intent.actor }, { tags: ["refund"] });
      return { success: true, data: { refunded: true, orderId: intent.target }, durationMs: 1 };
    }
  });

  // --- Decision rules: RBAC first, then approval for large refunds ----------
  engine.addRule(toolPermissionRule({ access, tools: agent.tools, resolveRoles: ({ intent }) => rolesOf(intent.actor) }));
  engine.addRule(confirmationRule({
    name: "large-refund-approval",
    actions: ["refund_order"],
    // A manager resuming the run is the approval.
    requires: async ({ intent }) => {
      if (Number(intent.payload?.amount ?? 0) <= 100) return false;
      const roles = await rolesOf(intent.actor);
      return !roles.includes("manager") && !roles.includes("owner");
    },
    question: "Refunds over $100 need a manager's approval."
  }));

  const onEvent = async (event: WorkflowEvent): Promise<void> => {
    metrics.workflowListener(event);
    await webhooks.forward(event);
  };

  const refunds = createWorkflow({
    name: "refunds",
    agent,
    maxSteps: 5,
    allowedActions: ["lookup_order", "refund_order"],
    parser: refundPlanner,
    store: createDocumentWorkflowStore(tenantStore),
    memory,
    onEvent
  });

  // --- HTTP ----------------------------------------------------------------
  const verifyJwt = jwtAuthenticator({ secret: options.jwtSecret, issuer: "support-desk" });

  /**
   * Scopes depend on the project the request targets: the user's roles in
   * that project (x-project-id) grant its permissions. Every signed-in user
   * may list and create projects; platform admins may read metrics.
   */
  const authenticate: NexoAuthenticator = async (context) => {
    const verified = await verifyJwt(context);
    if (!verified.authenticated) return verified;
    const user = (verified.identity as { sub?: string } | undefined)?.sub;
    const projectId = context.headers["x-project-id"];
    const roles = user !== undefined && projectId !== undefined ? await projects.rolesOf(projectId, user) : [];
    return {
      authenticated: true,
      identity: user,
      scopes: [
        "projects:use",
        ...(user !== undefined && PLATFORM_ADMINS.includes(user) ? ["platform:metrics"] : []),
        ...access.permissionsFor(roles)
      ]
    };
  };

  /** The already-authenticated user, re-read from the verified token. */
  const resolveActor = (context: NexoRequestContext): string | undefined => {
    const token = /^Bearer\s+(\S+)$/i.exec(context.headers.authorization ?? "")?.[1];
    if (token === undefined) return undefined;
    const verified = verifyToken(token, options.jwtSecret, { issuer: "support-desk" });
    return verified.valid ? verified.claims.sub : undefined;
  };

  app.module(createWorkflowApiModule({
    workflows: [refunds],
    queue,
    resolveActor,
    auth: { required: true, scopes: ["workflows:run"] }
  }));
  app.module(createMemoryApiModule({
    memory,
    auth: { required: true, scopes: ["memory:read"] },
    writeAuth: { required: true, scopes: ["memory:write"] }
  }));
  // Operators see totals across projects; members see their own project's metrics.
  app.module(createMetricsApiModule(metrics, { auth: { required: true, scopes: ["platform:metrics"] } }));
  app.module(createMetricsApiModule(metrics, {
    name: "project-metrics",
    path: "/project/metrics",
    scope: "project",
    auth: { required: true, scopes: ["metrics:read"] }
  }));
  app.module(createProjectApiModule({ registry: projects, resolveUser: resolveActor, auth: { required: true, scopes: ["projects:use"] } }));

  // Tenant-scoped routes run inside the requested project, for members only.
  const GLOBAL_APIS = new Set(["health", "getMetrics", "getPrometheusMetrics", "listProjects", "createProject", "getProject", "setProjectMember"]);
  const project: HapiProjectOptions = {
    skip: (api) => GLOBAL_APIS.has(api.name),
    resolve: async (context) => {
      const projectId = context.headers["x-project-id"];
      if (projectId === undefined) return undefined;
      const user = resolveActor(context);
      if (user === undefined || (await projects.rolesOf(projectId, user)).length === 0) {
        // 404 rather than 403, so project IDs can't be probed.
        throw new NexoHttpError(404, "PROJECT_NOT_FOUND", `Project "${projectId}" not found.`);
      }
      return projectId;
    }
  };

  // Unauthenticated liveness probe for load balancers and container health checks.
  const startedAt = Date.now();
  app.module({
    name: "system",
    apis: [{
      name: "health",
      method: "GET",
      path: "/health",
      description: "Liveness probe.",
      handler: () => ({ status: "ok", uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) })
    }]
  });

  return { app, queue, metrics, webhooks, memory, projects, authenticate, project };
}

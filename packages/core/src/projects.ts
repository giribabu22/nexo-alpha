/**
 * Projects: tenant isolation.
 *
 * A project scopes data. Code runs "inside" a project with
 * {@link runInProject}; the ID then follows every await (AsyncLocalStorage),
 * so it never has to be threaded through call signatures. A store wrapped
 * with {@link scopeByProject} keeps each project's documents in separate
 * collections, which isolates everything built on the document store —
 * workflow runs, agent memory, audit trails, webhook subscriptions.
 *
 * ```ts
 * const store = scopeByProject(await createSqliteDocumentStore("data/nexo.sqlite"), { required: true });
 * await runInProject("acme", () => workflow.run("Refund order 9")); // saved under acme only
 * ```
 *
 * HTTP adapters enter the project per request (`createHapiServer({ project })`),
 * and the job queue records the project of each job and runs it inside it.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { NexoApi, NexoApiAuth, NexoRequestContext } from "./api.js";
import { NexoHttpError } from "./errors.js";
import type { NexoModule } from "./module.js";
import type { NexoDocumentStore } from "./storage.js";

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const context = new AsyncLocalStorage<string>();

/** Whether `id` is a valid project ID: lowercase letters, digits and dashes, 1–63 chars. */
export function isValidProjectId(id: string): boolean {
  return PROJECT_ID.test(id);
}

function assertProjectId(id: string): void {
  if (!isValidProjectId(id)) {
    throw new NexoHttpError(400, "INVALID_PROJECT_ID", `Invalid project ID "${id}": use lowercase letters, digits and dashes (max 63).`);
  }
}

/** Runs `fn` inside project `projectId`; nested calls see the innermost project. */
export function runInProject<T>(projectId: string, fn: () => T): T {
  assertProjectId(projectId);
  return context.run(projectId, fn);
}

/** The project the current code runs in, if any. */
export function currentProjectId(): string | undefined {
  return context.getStore();
}

export interface ScopeByProjectOptions {
  /**
   * Reject operations made outside any project instead of using the
   * unscoped collections. Recommended for multi-tenant apps so that code
   * that forgot to enter a project fails loudly. Default: false
   */
  readonly required?: boolean;
}

/**
 * Wraps a store so each project's documents live in their own collections
 * (`<projectId>::<collection>`). Outside a project, operations use the
 * plain collections — or throw, with `required: true`.
 */
export function scopeByProject(store: NexoDocumentStore, options: ScopeByProjectOptions = {}): NexoDocumentStore {
  function scoped(collection: string): string {
    const projectId = currentProjectId();
    if (projectId === undefined) {
      if (options.required === true) {
        throw new Error(`No project in context for collection "${collection}". Wrap the call in runInProject().`);
      }
      return collection;
    }
    return `${projectId}::${collection}`;
  }

  return {
    // async so a missing project rejects the returned promise instead of throwing synchronously.
    get: async (collection, id) => store.get(scoped(collection), id),
    put: async (collection, id, document) => store.put(scoped(collection), id, document),
    delete: async (collection, id) => store.delete(scoped(collection), id),
    list: async (collection) => store.list(scoped(collection)),
    replaceIf: async (collection, id, expected, next) => store.replaceIf(scoped(collection), id, expected, next),
    close: () => store.close()
  };
}

// ---------------------------------------------------------------------------
// Project registry
// ---------------------------------------------------------------------------

export interface Project {
  readonly id: string;
  readonly name: string;
  /** userId → roles within this project. */
  readonly members: Readonly<Record<string, readonly string[]>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectRegistry {
  /** Creates a project; `owner` becomes its first member with `ownerRoles`. Throws if the ID is taken. */
  create(input: { readonly id: string; readonly name: string; readonly owner: string }): Promise<Project>;
  get(id: string): Promise<Project | undefined>;
  /** All projects, or only those `userId` is a member of. */
  list(filter?: { readonly member?: string }): Promise<Project[]>;
  /** Roles of `userId` in project `projectId` (empty when not a member or no such project). */
  rolesOf(projectId: string, userId: string): Promise<readonly string[]>;
  /** Sets a member's roles; an empty list removes the member. Returns the updated project. */
  setMember(projectId: string, userId: string, roles: readonly string[]): Promise<Project | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface ProjectRegistryOptions {
  /** Collection holding projects. Default: "nexo_projects" */
  readonly collection?: string;
  /** Roles given to a project's creator. Default: ["owner"] */
  readonly ownerRoles?: readonly string[];
}

/**
 * Stores projects and their members. Pass an unscoped store: the registry
 * itself is global.
 */
export function createProjectRegistry(store: NexoDocumentStore, options: ProjectRegistryOptions = {}): ProjectRegistry {
  const collection = options.collection ?? "nexo_projects";
  const ownerRoles = options.ownerRoles ?? ["owner"];

  async function update(projectId: string, change: (project: Project) => Project): Promise<Project | undefined> {
    // Compare-and-swap loop so concurrent membership changes are not lost.
    for (let attempt = 0; attempt < 10; attempt++) {
      const current = await store.get<Project>(collection, projectId);
      if (current === undefined) return undefined;
      const next = change(current);
      if (await store.replaceIf(collection, projectId, current, next)) return next;
    }
    throw new Error(`Project "${projectId}" is changing too often; try again.`);
  }

  return {
    async create({ id, name, owner }) {
      assertProjectId(id);
      if (name.trim() === "") throw new NexoHttpError(400, "INVALID_PROJECT_NAME", "Project name must not be empty.");
      if ((await store.get(collection, id)) !== undefined) {
        throw new NexoHttpError(409, "PROJECT_EXISTS", `Project "${id}" already exists.`);
      }
      const now = new Date().toISOString();
      const project: Project = { id, name: name.trim(), members: { [owner]: [...ownerRoles] }, createdAt: now, updatedAt: now };
      await store.put(collection, id, project);
      return project;
    },

    get: (id) => store.get<Project>(collection, id),

    async list(filter = {}) {
      const projects = await store.list<Project>(collection);
      return filter.member === undefined ? projects : projects.filter((project) => filter.member! in project.members);
    },

    async rolesOf(projectId, userId) {
      return (await store.get<Project>(collection, projectId))?.members[userId] ?? [];
    },

    setMember(projectId, userId, roles) {
      return update(projectId, (project) => {
        const members = { ...project.members };
        if (roles.length === 0) delete members[userId];
        else members[userId] = [...roles];
        return { ...project, members, updatedAt: new Date().toISOString() };
      });
    },

    delete: (id) => store.delete(collection, id)
  };
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

export interface ProjectApiOptions {
  readonly registry: ProjectRegistry;
  /** The authenticated user making the request (e.g. from a verified token). */
  resolveUser(context: NexoRequestContext): string | undefined | Promise<string | undefined>;
  /** Roles allowed to manage a project's members. Default: ["owner"] */
  readonly managerRoles?: readonly string[];
  readonly auth?: NexoApiAuth;
  /** Route prefix. Default: "/projects" */
  readonly basePath?: string;
}

/**
 * ```
 * GET    /projects                          → projects the user is a member of
 * POST   /projects { id, name }             → create (the user becomes owner)
 * GET    /projects/:id                      → one project (members only)
 * PUT    /projects/:id/members/:user { roles } → set a member's roles (managers only; [] removes)
 * ```
 */
export function createProjectApiModule(options: ProjectApiOptions): NexoModule {
  const { registry } = options;
  const basePath = (options.basePath ?? "/projects").replace(/\/+$/, "");
  const managerRoles = options.managerRoles ?? ["owner"];
  const auth = options.auth !== undefined ? { auth: options.auth } : {};

  async function user(context: NexoRequestContext): Promise<string> {
    const userId = await options.resolveUser(context);
    if (userId === undefined) throw new NexoHttpError(401, "UNAUTHENTICATED", "No authenticated user.");
    return userId;
  }

  async function projectFor(context: NexoRequestContext, userId: string): Promise<Project> {
    const project = await registry.get(context.params.id ?? "");
    // Non-members get 404, not 403, so project IDs can't be probed.
    if (project === undefined || !(userId in project.members)) {
      throw new NexoHttpError(404, "PROJECT_NOT_FOUND", `Project "${context.params.id}" not found.`);
    }
    return project;
  }

  const body = (context: NexoRequestContext): Record<string, unknown> =>
    typeof context.payload === "object" && context.payload !== null ? (context.payload as Record<string, unknown>) : {};

  const apis: NexoApi[] = [
    {
      name: "listProjects",
      method: "GET",
      path: basePath,
      ...auth,
      handler: async (context) => ({ projects: await registry.list({ member: await user(context) }) })
    },
    {
      name: "createProject",
      method: "POST",
      path: basePath,
      ...auth,
      validate: (context) => {
        const { id, name } = body(context);
        const errors: string[] = [];
        if (typeof id !== "string" || !isValidProjectId(id)) errors.push('"id" must be lowercase letters, digits and dashes (max 63).');
        if (typeof name !== "string" || name.trim() === "") errors.push('"name" is required.');
        return errors.length > 0 ? { valid: false, errors } : { valid: true };
      },
      handler: async (context) => {
        const { id, name } = body(context) as { id: string; name: string };
        return registry.create({ id, name, owner: await user(context) });
      }
    },
    {
      name: "getProject",
      method: "GET",
      path: `${basePath}/:id`,
      ...auth,
      handler: async (context) => projectFor(context, await user(context))
    },
    {
      name: "setProjectMember",
      method: "PUT",
      path: `${basePath}/:id/members/:user`,
      ...auth,
      validate: (context) => {
        const { roles } = body(context);
        return Array.isArray(roles) && roles.every((role) => typeof role === "string")
          ? { valid: true }
          : { valid: false, errors: ['"roles" must be an array of strings ([] removes the member).'] };
      },
      handler: async (context) => {
        const userId = await user(context);
        const project = await projectFor(context, userId);
        if (!(project.members[userId] ?? []).some((role) => managerRoles.includes(role))) {
          throw new NexoHttpError(403, "FORBIDDEN", "Only project managers can change members.");
        }
        const roles = body(context).roles as string[];
        const target = context.params.user ?? "";
        const managersLeft = Object.entries(project.members).filter(
          ([member, memberRoles]) => (member === target ? roles : memberRoles).some((role) => managerRoles.includes(role))
        );
        if (managersLeft.length === 0) {
          throw new NexoHttpError(409, "LAST_MANAGER", "A project must keep at least one manager.");
        }
        return registry.setMember(project.id, target, roles);
      }
    }
  ];

  return { name: "projects", description: "Projects (tenants) and their members.", apis };
}

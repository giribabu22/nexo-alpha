/**
 * Role-based access control for the Decision Engine.
 *
 * Roles map to permission strings; roles may inherit other roles. A granted
 * permission matches a required one when it is identical, when it is `"*"`,
 * or when it ends in `":*"` and the required permission starts with the part
 * before the `*` (so `"orders:*"` grants `"orders:refund"` and
 * `"orders:items:delete"`).
 *
 * ```ts
 * const access = createAccessControl([
 *   { name: "viewer", permissions: ["orders:read"] },
 *   { name: "support", permissions: ["orders:refund"], inherits: ["viewer"] },
 *   { name: "admin", permissions: ["*"] }
 * ]);
 *
 * engine.addRule(rbacRule({
 *   access,
 *   resolveRoles: ({ extras }) => (extras?.roles as string[]) ?? [],
 *   permissions: { refund_order: "orders:refund", view_order: "orders:read" }
 * }));
 * ```
 */

import { scopeMatches } from "@nexo-alpha/core";
import type { DecisionContext, DecisionOutcome, DecisionRule } from "./types.js";

export interface RoleDefinition {
  readonly name: string;
  readonly permissions: readonly string[];
  /** Roles whose permissions this role also receives. */
  readonly inherits?: readonly string[] | undefined;
  readonly description?: string | undefined;
}

export interface AccessControl {
  /** Names of all defined roles. */
  readonly roles: readonly string[];
  /** Every permission granted to any of `roles`, including inherited ones. Unknown roles grant nothing. */
  permissionsFor(roles: readonly string[]): ReadonlySet<string>;
  /** Whether `roles` grant `permission`. */
  can(roles: readonly string[], permission: string): boolean;
  /** The subset of `required` that `roles` do not grant. */
  missing(roles: readonly string[], required: readonly string[]): string[];
}

/**
 * Whether a single granted permission pattern covers a required permission.
 * Same rule as `@nexo-alpha/core`'s `scopeMatches`, so a role's permissions
 * can be used directly as HTTP auth scopes.
 */
export const permissionMatches: (granted: string, required: string) => boolean = scopeMatches;

/**
 * Builds an {@link AccessControl} from role definitions.
 * Throws on duplicate roles, unknown inherited roles, or inheritance cycles.
 */
export function createAccessControl(definitions: readonly RoleDefinition[]): AccessControl {
  const byName = new Map<string, RoleDefinition>();
  for (const role of definitions) {
    if (byName.has(role.name)) {
      throw new Error(`[AccessControl] Duplicate role "${role.name}".`);
    }
    byName.set(role.name, role);
  }

  // Resolve each role's full permission set once, detecting bad inheritance.
  const resolved = new Map<string, ReadonlySet<string>>();

  function resolve(name: string, path: readonly string[]): ReadonlySet<string> {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;

    if (path.includes(name)) {
      throw new Error(`[AccessControl] Role inheritance cycle: ${[...path, name].join(" -> ")}.`);
    }
    const role = byName.get(name);
    if (role === undefined) {
      throw new Error(`[AccessControl] Role "${path[path.length - 1]}" inherits unknown role "${name}".`);
    }

    const permissions = new Set(role.permissions);
    for (const parent of role.inherits ?? []) {
      for (const permission of resolve(parent, [...path, name])) permissions.add(permission);
    }
    resolved.set(name, permissions);
    return permissions;
  }

  for (const name of byName.keys()) resolve(name, []);

  const access: AccessControl = {
    roles: [...byName.keys()],

    permissionsFor(roles) {
      const permissions = new Set<string>();
      for (const role of roles) {
        for (const permission of resolved.get(role) ?? []) permissions.add(permission);
      }
      return permissions;
    },

    can(roles, permission) {
      for (const granted of access.permissionsFor(roles)) {
        if (permissionMatches(granted, permission)) return true;
      }
      return false;
    },

    missing(roles, required) {
      const granted = [...access.permissionsFor(roles)];
      return required.filter((permission) => !granted.some((g) => permissionMatches(g, permission)));
    }
  };

  return access;
}

export interface RbacRuleOptions {
  readonly access: AccessControl;
  /**
   * Returns the roles of the actor behind the intent. Resolve these from a
   * trusted source (session, auth identity, database) — not from the intent
   * payload, which may be user-supplied.
   */
  resolveRoles(ctx: DecisionContext): readonly string[] | Promise<readonly string[]>;
  /**
   * Permissions required per action: a map of action → permission(s), or a
   * function returning them. `undefined`/empty means the action is not
   * governed by this rule (see `denyUnmapped`).
   */
  readonly permissions:
    | Readonly<Record<string, string | readonly string[]>>
    | ((ctx: DecisionContext) => readonly string[] | undefined);
  /** Reject actions that have no required permissions. Default: false */
  readonly denyUnmapped?: boolean | undefined;
  readonly name?: string | undefined;
  /** Overrides the default rejection reason. */
  readonly message?: string | undefined;
}

/**
 * A `permission` {@link DecisionRule} that REJECTs (`code: "PERMISSION_DENIED"`)
 * when the actor's roles do not grant every permission the action requires.
 */
export function rbacRule(options: RbacRuleOptions): DecisionRule {
  const ruleName = options.name ?? "rbac";

  function requiredFor(ctx: DecisionContext): readonly string[] {
    const { permissions } = options;
    const required = typeof permissions === "function"
      ? permissions(ctx)
      : Object.prototype.hasOwnProperty.call(permissions, ctx.intent.action)
        ? permissions[ctx.intent.action]
        : undefined;
    if (required === undefined) return [];
    return typeof required === "string" ? [required] : required;
  }

  return {
    name: ruleName,
    kind: "permission",
    description: "Role-based access control",

    async evaluate(ctx): Promise<DecisionOutcome | undefined> {
      const required = requiredFor(ctx);

      if (required.length === 0) {
        if (options.denyUnmapped !== true) return undefined;
        return {
          result: "REJECT",
          reason: options.message ?? `Action "${ctx.intent.action}" has no permission mapping.`,
          code: "PERMISSION_DENIED",
          rule: ruleName
        };
      }

      const roles = await options.resolveRoles(ctx);
      const missing = options.access.missing(roles, required);
      if (missing.length === 0) return undefined;

      return {
        result: "REJECT",
        reason:
          options.message ??
          `${ctx.intent.actor !== undefined ? `Actor "${ctx.intent.actor}"` : "Actor"} lacks permission(s): ${missing.join(", ")}.`,
        code: "PERMISSION_DENIED",
        rule: ruleName
      };
    }
  };
}

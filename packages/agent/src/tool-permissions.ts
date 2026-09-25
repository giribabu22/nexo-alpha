/**
 * Enforces the `permissions` declared on {@link NexoTool}s through the
 * Decision Engine, so a tool can never ACT for an actor whose roles don't
 * grant what it declares.
 *
 * ```ts
 * const agent = createAgent({ decisionEngine: engine });
 * agent.tools.register({ action: "refund_order", permissions: ["orders:refund"], execute });
 *
 * engine.addRule(toolPermissionRule({
 *   access,
 *   tools: agent.tools,
 *   resolveRoles: ({ extras }) => (extras?.roles as string[]) ?? []
 * }));
 * ```
 */

import { rbacRule, type AccessControl, type DecisionContext, type DecisionRule } from "@nexo-alpha/decision";
import type { ToolRegistry } from "./tool-registry.js";

export interface ToolPermissionRuleOptions {
  readonly access: AccessControl;
  /** The registry whose tools' `permissions` are enforced. Looked up at evaluation time. */
  readonly tools: ToolRegistry;
  /** Returns the actor's roles from a trusted source — see `RbacRuleOptions.resolveRoles`. */
  resolveRoles(ctx: DecisionContext): readonly string[] | Promise<readonly string[]>;
  /** Reject tools that declare no permissions. Default: false */
  readonly denyUndeclared?: boolean | undefined;
  readonly name?: string | undefined;
  readonly message?: string | undefined;
}

/**
 * A Decision Engine rule that REJECTs (`code: "PERMISSION_DENIED"`) when the
 * actor's roles don't grant every permission the called tool declares.
 */
export function toolPermissionRule(options: ToolPermissionRuleOptions): DecisionRule {
  return rbacRule({
    access: options.access,
    resolveRoles: options.resolveRoles,
    permissions: (ctx) => options.tools.get(ctx.intent.action)?.permissions,
    denyUnmapped: options.denyUndeclared,
    name: options.name ?? "tool-permissions",
    message: options.message
  });
}

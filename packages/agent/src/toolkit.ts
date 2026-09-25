/**
 * Toolkits: reusable bundles of tools (and their verifiers) that give an
 * agent a capability — e.g. `@nexo-alpha/integrations`' GitHub and Slack
 * toolkits. Tools keep their declared `permissions`, so RBAC
 * (`toolPermissionRule`) and the Decision Engine gate them like any other tool.
 *
 * ```ts
 * installToolkit(agent, createGitHubToolkit({ token, repository: "acme/app" }));
 * ```
 */

import type { NexoAgent } from "./agent.js";
import type { NexoTool } from "./tool-registry.js";
import type { ResultVerifier } from "./verifier.js";

export interface AgentToolkit {
  readonly name: string;
  readonly description?: string | undefined;
  readonly tools: readonly NexoTool[];
  readonly verifiers?: readonly ResultVerifier[] | undefined;
}

/**
 * Registers every tool and verifier of `toolkit` on `agent`. All-or-nothing:
 * if any action is already registered (or repeated within the toolkit),
 * nothing is installed and an error names the conflicts.
 * Returns the installed action names.
 */
export function installToolkit(agent: NexoAgent, toolkit: AgentToolkit): string[] {
  const actions = toolkit.tools.map((tool) => tool.action);
  const duplicates = actions.filter((action, index) => actions.indexOf(action) !== index);
  const conflicts = actions.filter((action) => agent.tools.has(action));
  if (duplicates.length > 0 || conflicts.length > 0) {
    throw new Error(
      `Cannot install toolkit "${toolkit.name}": ${[
        duplicates.length > 0 ? `repeated actions ${[...new Set(duplicates)].join(", ")}` : "",
        conflicts.length > 0 ? `already registered ${conflicts.join(", ")}` : ""
      ].filter((part) => part !== "").join("; ")}.`
    );
  }

  agent.tools.register(...toolkit.tools);
  for (const verifier of toolkit.verifiers ?? []) agent.verifiers.register(verifier);
  return actions;
}

/**
 * `nexo generate <kind> <name>` — scaffolds framework building blocks as
 * TypeScript source files that follow the framework's conventions.
 *
 * - tool:     src/tools/<name>.ts      an agent tool (the ACT layer)
 * - workflow: src/workflows/<name>.ts  an agent + workflow wiring
 * - module:   src/modules/<name>/index.ts  a NexoModule with one API
 *
 * Generation is pure ({@link generateFiles}); writing is separate
 * ({@link writeGeneratedFiles}) and refuses to overwrite without `force`.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type GeneratorKind = "tool" | "workflow" | "module";

export const GENERATOR_KINDS: readonly GeneratorKind[] = ["tool", "workflow", "module"];

export interface GeneratedFile {
  /** Path relative to the project root. */
  readonly path: string;
  readonly content: string;
}

/** Splits "RefundOrder", "refund-order", "refund_order" or "refund order" into lowercase words. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

const kebab = (parts: readonly string[]): string => parts.join("-");
const snake = (parts: readonly string[]): string => parts.join("_");
const camel = (parts: readonly string[]): string =>
  parts.map((word, index) => (index === 0 ? word : word[0]!.toUpperCase() + word.slice(1))).join("");
const pascal = (parts: readonly string[]): string => parts.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");

export function generateFiles(kind: GeneratorKind, name: string): GeneratedFile[] {
  const parts = words(name);
  if (parts.length === 0 || !/^[a-z]/.test(parts[0]!)) {
    throw new Error(`Invalid name "${name}": use letters and digits, starting with a letter (e.g. "refund-order").`);
  }
  const file = kebab(parts);

  switch (kind) {
    case "tool": {
      const action = snake(parts);
      const constName = `${camel(parts)}Tool`;
      return [
        {
          path: `src/tools/${file}.ts`,
          content: `import type { NexoTool } from "@nexo-alpha/agent";

/**
 * Handles the "${action}" action. Tools only run after the Decision Engine
 * approves the intent; return { success: false, error } instead of throwing
 * for expected failures so the verifier can decide whether to retry.
 */
export const ${constName}: NexoTool = {
  action: "${action}",
  description: "TODO: describe what ${action} does",
  // Permissions the actor needs; enforced when the engine has a toolPermissionRule.
  permissions: ["${parts[0]}:${action}"],
  async execute({ intent, extras }) {
    // TODO: implement. intent.target / intent.payload carry the request;
    // extras holds runtime services (and extras.memory inside workflows).
    void extras;
    return { success: true, data: { action: intent.action, target: intent.target }, durationMs: 0 };
  }
};
`
        },
        {
          path: `test/tools/${file}.test.js`,
          content: `import test from "node:test";
import assert from "node:assert/strict";
import { ${constName} } from "../../dist/tools/${file}.js";

test("${action}: succeeds for a basic intent", async () => {
  const result = await ${constName}.execute({ intent: { action: "${action}", target: "example" } });
  assert.equal(result.success, true);
});
`
        }
      ];
    }

    case "workflow": {
      const fn = `create${pascal(parts)}Workflow`;
      return [
        {
          path: `src/workflows/${file}.ts`,
          content: `import { createDecisionEngine } from "@nexo-alpha/decision";
import { createAgent, createWorkflow, createStepIntentParser, type NexoWorkflow } from "@nexo-alpha/agent";

/**
 * The "${file}" workflow. Every step goes through the Decision Engine
 * (UNDERSTAND → KNOW → DECIDE → ACT → VERIFY); add rules to the engine to
 * control what the agent may do, and register tools for each action.
 */
export function ${fn}(): NexoWorkflow {
  const decisionEngine = createDecisionEngine({ name: "${file}" });
  // e.g. decisionEngine.addRule(toolPermissionRule({ access, tools: agent.tools, resolveRoles }));

  const agent = createAgent({ name: "${file}-agent", decisionEngine });
  // agent.tools.register(myTool);

  return createWorkflow({
    name: "${file}",
    agent,
    maxSteps: 10,
    // Replace with an LLM-backed IntentParser to plan steps from the goal.
    parser: createStepIntentParser([])
  });
}
`
        }
      ];
    }

    case "module": {
      const moduleConst = `${camel(parts)}Module`;
      return [
        {
          path: `src/modules/${file}/index.ts`,
          content: `import type { NexoModule } from "@nexo-alpha/core";

export const ${moduleConst}: NexoModule = {
  name: "${file}",
  description: "TODO: describe the ${file} module",
  purpose: "TODO: why this module exists",
  apis: [
    {
      name: "get${pascal(parts)}Status",
      method: "GET",
      path: "/${file}/status",
      description: "Health of the ${file} module.",
      handler: () => ({ module: "${file}", status: "ok" })
    }
  ]
};
`
        }
      ];
    }
  }
}

export interface WriteGeneratedOptions {
  /** Overwrite existing files. Default: false */
  readonly force?: boolean;
}

/**
 * Writes generated files under `root`. Checks every target first and writes
 * nothing if any exists (unless `force`), so a run never half-applies.
 * Returns the written paths relative to `root`.
 */
export async function writeGeneratedFiles(
  root: string,
  files: readonly GeneratedFile[],
  options: WriteGeneratedOptions = {}
): Promise<string[]> {
  if (options.force !== true) {
    const existing: string[] = [];
    for (const file of files) {
      const exists = await stat(join(root, file.path)).then(() => true, () => false);
      if (exists) existing.push(file.path);
    }
    if (existing.length > 0) {
      throw new Error(`Refusing to overwrite existing file(s): ${existing.join(", ")}. Pass --force to overwrite.`);
    }
  }

  const written: string[] = [];
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf-8");
    written.push(relative(root, target).split("\\").join("/"));
  }
  return written;
}

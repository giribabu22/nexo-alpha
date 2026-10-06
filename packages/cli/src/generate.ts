/**
 * `nexo generate <kind> <name>` — scaffolds framework building blocks as
 * TypeScript source files that follow the framework's conventions.
 *
 * - tool:     src/tools/<name>.ts      an agent tool (the ACT layer)
 * - workflow: src/workflows/<name>.ts  an agent + workflow wiring
 * - module:   src/modules/<name>/index.ts  a NexoModule with one API
 * - resource: src/<plural>/<name>.model.ts, <plural>.api.ts, <plural>.page.tsx
 *             a model, its CRUD API and a page with a form and a table
 * - page:     src/pages/<name>.page.tsx    a page component for `page()`
 *
 * Generation is pure ({@link generateFiles}); writing is separate
 * ({@link writeGeneratedFiles}) and refuses to overwrite without `force`.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type GeneratorKind = "tool" | "workflow" | "module" | "resource" | "page";

export const GENERATOR_KINDS: readonly GeneratorKind[] = ["tool", "workflow", "module", "resource", "page"];

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

/** English plural of the last word, by simple rules ("invoice" → "invoices", "category" → "categories"). */
export function pluralize(parts: readonly string[]): string[] {
  const last = parts[parts.length - 1]!;
  const plural = /[^aeiou]y$/.test(last)
    ? `${last.slice(0, -1)}ies`
    : /(s|x|z|ch|sh)$/.test(last)
      ? `${last}es`
      : `${last}s`;
  return [...parts.slice(0, -1), plural];
}

export interface GenerateOptions {
  /** For `resource`: also write a page with a form and a table. Default: true (false for backend-only projects). */
  readonly page?: boolean;
}

export function generateFiles(kind: GeneratorKind, name: string, options: GenerateOptions = {}): GeneratedFile[] {
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

    case "resource": {
      const plural = pluralize(parts);
      const folder = kebab(plural);
      const Model = pascal(parts);
      const Page = `${pascal(plural)}Page`;
      const files: GeneratedFile[] = [
        {
          path: `src/${folder}/${file}.model.ts`,
          content: `import { field, model, type Infer } from "@nexo-alpha/core/model";

/** The ${Model} model: its types, validation, API schema, forms and tables all follow from this definition. */
export const ${Model} = model("${folder}", {
  // TODO: replace with the real fields. See docs/primitives.md#model for field types.
  name: field.string({ minLength: 1 })
});
export type ${Model} = Infer<typeof ${Model}>;
`
        },
        {
          path: `src/${folder}/${folder}.api.ts`,
          content: `import { resource, type NexoDocumentStore } from "@nexo-alpha/core";
import { ${Model} } from "./${file}.model.js";

/** CRUD API at /api/${folder}. Register it with app.module(${camel(plural)}Resource(store)). */
export function ${camel(plural)}Resource(store: NexoDocumentStore) {
  return resource(${Model}, { store });
}
`
        },
        {
          path: `src/${folder}/${folder}.page.tsx`,
          content: `import React from "react";
import { NexoForm, NexoResourceTable, NexoStack } from "@nexo-alpha/frontend";
import { ${Model} } from "./${file}.model.js";

/** Create and list ${folder.replace(/-/g, " ")}. Add it to the app with page("/${folder}", ${Page}). */
export function ${Page}(): React.JSX.Element {
  return (
    <NexoStack>
      <NexoForm model={${Model}} />
      <NexoResourceTable model={${Model}} allowDelete />
    </NexoStack>
  );
}
`
        }
      ];
      return options.page === false ? files.filter((file) => !file.path.endsWith(".page.tsx")) : files;
    }

    case "page": {
      const Page = `${pascal(parts)}Page`;
      return [
        {
          path: `src/pages/${file}.page.tsx`,
          content: `import React from "react";
import type { NexoPageRouteProps } from "@nexo-alpha/frontend";

/** Add it to the app with page("/${file}", ${Page}); path parameters arrive in \`params\`. */
export function ${Page}({ params }: NexoPageRouteProps): React.JSX.Element {
  void params;
  return <h1>${pascal(parts).replace(/([a-z])([A-Z])/g, "$1 $2")}</h1>;
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

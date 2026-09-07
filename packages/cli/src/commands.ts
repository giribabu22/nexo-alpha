import type { NexoApplication } from "@nexo-alpha/core";
import {
  buildContext,
  contextToJson,
  knowledgeToJson,
  type ApplicationKnowledge
} from "@nexo-alpha/context";
import { createSourceInterface, createVerificationInterface } from "@nexo-alpha/tools";
import {
  renderApplicationSummary,
  renderDevelopmentState,
  renderHealth,
  renderModuleDetail,
  renderValidation
} from "./render.js";

export function inspect(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined,
  moduleName?: string
): string {
  const context = buildContext(app, knowledge);

  if (moduleName === undefined) {
    return renderApplicationSummary(context);
  }

  const module = context.modules.find((m) => m.name === moduleName);

  if (module === undefined) {
    const known = context.modules.map((m) => m.name);
    const suggestion =
      known.length > 0
        ? ` Did you mean one of: ${known.join(", ")}?`
        : " This application has no registered modules.";
    throw new Error(`No module named "${moduleName}" found.${suggestion}`);
  }

  return renderModuleDetail(module);
}

export function status(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined
): string {
  const devState = knowledge?.getDevelopmentState() ?? {
    completed: [],
    inProgress: [],
    blocked: [],
    knownIssues: []
  };
  return renderDevelopmentState(devState);
}

export function context(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined
): string {
  return contextToJson(buildContext(app, knowledge));
}

/**
 * Renders the application's knowledge journal (decisions, constraints,
 * development state, history) as a standalone JSON snapshot — the same
 * shape a project can later restore with `knowledgeFromJson()` — plus the
 * application's current registered structure and a `structureHash`.
 * Distinct from `context()`, which always emits the full structural
 * manifest; this is the journal, so it can be redirected straight into a
 * file, e.g. `nexo knowledge > .nexo/knowledge.json`. The embedded
 * `structureHash` lets a consumer tell later whether the application's
 * registered modules/APIs/services/dependencies have since changed —
 * `knowledgeFromJson()` only restores the four journal fields, so
 * `structure`/`structureHash` here are informational, not round-tripped.
 */
export function knowledge(app: NexoApplication, appKnowledge: ApplicationKnowledge | undefined): string {
  if (appKnowledge === undefined) {
    throw new Error(
      "This application does not export a knowledge journal. Export a `knowledge` " +
        "binding (created with createKnowledge() from @nexo-alpha/context) alongside `app`."
    );
  }

  const journal = JSON.parse(knowledgeToJson(appKnowledge)) as Record<string, unknown>;
  const { structure, structureHash } = buildContext(app, appKnowledge);

  return JSON.stringify({ ...journal, structure, structureHash }, null, 2);
}

/**
 * Scans `projectRoot`'s source tree and renders a file/export inventory
 * plus a `sourceTreeHash`, as JSON. Unlike every other command here, this
 * doesn't load a Nexo application at all — it reads the project's actual
 * source files, independent of what's registered with `NexoApplication`.
 * See `createSourceInterface` in `@nexo-alpha/tools` for what "exports"
 * means here and its limits (a regex-based scan, not a real parser).
 */
export async function sourceTree(projectRoot: string): Promise<string> {
  const source = createSourceInterface(projectRoot);
  const tree = await source.describeSourceTree();
  return JSON.stringify({ ...tree, sourceTreeHash: source.sourceTreeHash(tree) }, null, 2);
}

export function validate(app: NexoApplication): string {
  const verify = createVerificationInterface(app);
  const archResult = verify.validateArchitecture();
  const configResult = verify.validateConfiguration();
  return renderValidation(archResult.issues, configResult.issues);
}

export function health(app: NexoApplication): string {
  const verify = createVerificationInterface(app);
  return renderHealth(verify.checkApplicationHealth());
}

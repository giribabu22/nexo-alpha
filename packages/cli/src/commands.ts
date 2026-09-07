import type { NexoApplication } from "@nexo-alpha/core";
import {
  buildContext,
  contextToJson,
  knowledgeToJson,
  type ApplicationKnowledge
} from "@nexo-alpha/context";
import {
  buildKnowledgeGraph,
  createReadInterface,
  createSourceInterface,
  createVerificationInterface,
  isGraphStale,
  loadKnowledgeGraph,
  saveKnowledgeGraph
} from "@nexo-alpha/tools";
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

/**
 * Renders the full ApplicationContext manifest as JSON: application
 * identity, modules, the knowledge journal (if any), and the
 * registry-derived structure/structureHash. When `sourceRoot` is given,
 * also scans that directory's actual source tree and folds the result in
 * as `sourceTree`/`sourceTreeHash` — so a single `nexo context
 * --source-root .` answers both "what's registered with the application"
 * and "what's actually in the files." Omit `sourceRoot` to skip the scan
 * entirely: unlike `structure`, which is free (it only reads the
 * in-memory registry), a source-tree scan does real file I/O, so it's
 * opt-in rather than always-on.
 */
export async function context(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined,
  sourceRoot?: string
): Promise<string> {
  const sourceTree =
    sourceRoot !== undefined
      ? await createSourceInterface(sourceRoot).describeSourceTree()
      : undefined;

  return contextToJson(buildContext(app, knowledge, sourceTree));
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

/**
 * Builds (or reuses) the application's knowledge graph — the unified
 * relationship graph over registered structure and, when `sourceRoot` is
 * given, scanned source — and persists it to `outPath` as JSON.
 *
 * Hash-gated like `structureHash`/`sourceTreeHash` themselves: if a graph
 * already exists at `outPath` and its saved `structureHash`/`sourceTreeHash`
 * still match what's live right now, the existing file is left untouched
 * and this reports "up to date" instead of silently rewriting an
 * unchanged file on every invocation. Pass `force: true` to rebuild
 * regardless.
 */
export async function graph(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined,
  outPath: string,
  sourceRoot?: string,
  force = false
): Promise<string> {
  const sourceTree =
    sourceRoot !== undefined ? await createSourceInterface(sourceRoot).describeSourceTree() : undefined;

  const context = buildContext(app, knowledge, sourceTree);

  if (!force) {
    const existing = await loadKnowledgeGraph(outPath);
    if (existing !== undefined && !isGraphStale(existing.meta, context.structureHash, context.sourceTreeHash)) {
      return `Knowledge graph at ${outPath} is up to date (${existing.graph.nodes.length} nodes, ${existing.graph.edges.length} edges). Pass --force to rebuild anyway.`;
    }
  }

  const knowledgeGraph = await buildKnowledgeGraph(context);
  const stored = await saveKnowledgeGraph(outPath, knowledgeGraph, {
    structureHash: context.structureHash,
    ...(context.sourceTreeHash !== undefined && { sourceTreeHash: context.sourceTreeHash })
  });

  return JSON.stringify(stored, null, 2);
}

/**
 * Keyword search over the knowledge graph's node names/descriptions —
 * `NexoReadInterface.search()`'s CLI surface. Plain case-insensitive
 * substring matching, not semantic search (see `searchKnowledgeGraph` in
 * `@nexo-alpha/tools`). Scans `sourceRoot` fresh on every call, same as
 * `context --source-root`/`graph` — there's no persisted index this reads
 * from instead.
 */
export async function search(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined,
  query: string,
  sourceRoot?: string
): Promise<string> {
  const sourceTree =
    sourceRoot !== undefined ? await createSourceInterface(sourceRoot).describeSourceTree() : undefined;
  const results = await createReadInterface(app, knowledge, sourceTree).search(query);
  return JSON.stringify(results, null, 2);
}

/**
 * Edges touching one graph node — `NexoReadInterface.traceCallers()`/
 * `traceDependents()`'s CLI surface. `direction: "callers"` returns only
 * `"calls"` edges pointing at `nodeId` ("what calls this"); `"dependents"`
 * (the default) returns every edge pointing at it, of any kind ("what
 * would be affected if this changed"). Node IDs come from a prior `nexo
 * graph`/`nexo search` output (e.g. `"symbol:src/orders.ts#createOrder"`,
 * `"module:payments"`).
 */
export async function trace(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined,
  nodeId: string,
  sourceRoot?: string,
  direction: "callers" | "dependents" = "dependents"
): Promise<string> {
  const sourceTree =
    sourceRoot !== undefined ? await createSourceInterface(sourceRoot).describeSourceTree() : undefined;
  const readInterface = createReadInterface(app, knowledge, sourceTree);
  const edges = direction === "callers" ? await readInterface.traceCallers(nodeId) : await readInterface.traceDependents(nodeId);
  return JSON.stringify(edges, null, 2);
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

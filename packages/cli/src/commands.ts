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
  diffKnowledgeGraphFreshness,
  hashKnowledgeGraphNodeContent,
  isGraphStale,
  loadKnowledgeGraph,
  saveKnowledgeGraph,
  type KnowledgeEdgeKind,
  type KnowledgeGraphNode,
  type KnowledgeNodeSummarizer,
  type TraversalDirection
} from "@nexo-alpha/tools";
import { hashSourceTreeFiles, type IntentEntityKind } from "@nexo-alpha/context";
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
 * Renders recorded intents ("why does this entity exist" — see `NexoIntent`
 * in `@nexo-alpha/context`) as JSON. With no `entityKind`/`entityName`
 * given, renders every recorded intent, across every entity kind including
 * `"component"`/`"function"`, which have no structural counterpart anywhere
 * else in Nexo. With both given, looks up just that one entity's
 * most-recently-recorded intent (`null` if none was recorded) — the same
 * lookup `NexoReadInterface.getIntent()` performs.
 */
export function intents(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined,
  entityKind?: IntentEntityKind,
  entityName?: string
): string {
  const readInterface = createReadInterface(app, knowledge);

  if (entityKind !== undefined && entityName !== undefined) {
    return JSON.stringify(readInterface.getIntent(entityKind, entityName) ?? null, null, 2);
  }

  return JSON.stringify(readInterface.getIntents(), null, 2);
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
 * Wraps a caller-supplied {@link KnowledgeNodeSummarizer} so a node whose
 * content (per `hashKnowledgeGraphNodeContent`) hasn't changed since
 * `previousNodes` was captured reuses its prior summary instead of
 * re-invoking `summarize` — the point being that a real LLM-backed
 * summarizer only pays for genuinely new or changed nodes.
 */
function withSummaryCache(
  summarize: KnowledgeNodeSummarizer,
  previousNodes: ReadonlyMap<string, KnowledgeGraphNode>
): KnowledgeNodeSummarizer {
  return (node) => {
    const previous = previousNodes.get(node.id);
    if (previous?.summary !== undefined && previous.summaryHash === hashKnowledgeGraphNodeContent(node)) {
      return previous.summary;
    }
    return summarize(node);
  };
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
 *
 * When `summarize` is supplied (see `KnowledgeNodeSummarizer` in
 * `@nexo-alpha/tools` — Nexo never calls an LLM itself, this is entirely
 * caller-supplied), it's wrapped with {@link withSummaryCache} against the
 * previously saved graph at `outPath`, so only nodes whose content actually
 * changed get re-summarized. `--force` clears this cache too, the same as
 * it clears the whole-graph staleness check — a forced rebuild summarizes
 * every node fresh.
 */
export async function graph(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined,
  outPath: string,
  sourceRoot?: string,
  force = false,
  summarize?: KnowledgeNodeSummarizer
): Promise<string> {
  const sourceTree =
    sourceRoot !== undefined ? await createSourceInterface(sourceRoot).describeSourceTree() : undefined;

  const context = buildContext(app, knowledge, sourceTree);

  let effectiveSummarize = summarize;

  if (!force) {
    const existing = await loadKnowledgeGraph(outPath);
    if (existing !== undefined && !isGraphStale(existing.meta, context.structureHash, context.sourceTreeHash)) {
      return `Knowledge graph at ${outPath} is up to date (${existing.graph.nodes.length} nodes, ${existing.graph.edges.length} edges). Pass --force to rebuild anyway.`;
    }
    if (summarize !== undefined && existing !== undefined) {
      effectiveSummarize = withSummaryCache(summarize, new Map(existing.graph.nodes.map((node) => [node.id, node])));
    }
  }

  const knowledgeGraph = await buildKnowledgeGraph(context, {
    ...(effectiveSummarize !== undefined && { summarize: effectiveSummarize })
  });
  const stored = await saveKnowledgeGraph(outPath, knowledgeGraph, {
    structureHash: context.structureHash,
    ...(context.sourceTreeHash !== undefined && { sourceTreeHash: context.sourceTreeHash }),
    ...(sourceTree !== undefined && { fileHashes: hashSourceTreeFiles(sourceTree) })
  });

  return JSON.stringify(stored, null, 2);
}

/**
 * Which files changed, by structural fingerprint, since the graph at
 * `outPath` was last built — `NexoReadInterface` has no notion of this,
 * since it only ever computes a graph live from the current app/source
 * state, never compares against a previously saved one. Unlike every other
 * command here, this doesn't load a `NexoApplication` at all: the diff is
 * purely "saved meta vs. a fresh scan of `sourceRoot`," so there's nothing
 * for an application module to contribute. Throws if no graph has been
 * saved at `outPath` yet — run `nexo graph` first.
 */
export async function freshness(outPath: string, sourceRoot: string): Promise<string> {
  const existing = await loadKnowledgeGraph(outPath);
  if (existing === undefined) {
    throw new Error(`No knowledge graph found at ${outPath}. Run "nexo graph" first.`);
  }

  const sourceTree = await createSourceInterface(sourceRoot).describeSourceTree();
  const diff = diffKnowledgeGraphFreshness(existing.meta, sourceTree);

  return JSON.stringify({ outPath, generatedAt: existing.meta.generatedAt, ...diff }, null, 2);
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

/**
 * Transitive blast radius of `nodeId` — `NexoReadInterface.traceImpact()`'s
 * CLI surface. Unlike `trace()`, which only returns the immediate edges
 * touching a node, this walks the graph breadth-first and reports every
 * reachable node along with its hop count from `nodeId`, so "what would be
 * affected, however indirectly, if I changed this" is answerable without
 * chasing `trace()` by hand one hop at a time.
 */
export async function impact(
  app: NexoApplication,
  knowledge: ApplicationKnowledge | undefined,
  nodeId: string,
  sourceRoot?: string,
  direction: TraversalDirection = "dependents",
  maxDepth?: number,
  edgeKinds?: readonly KnowledgeEdgeKind[]
): Promise<string> {
  const sourceTree =
    sourceRoot !== undefined ? await createSourceInterface(sourceRoot).describeSourceTree() : undefined;
  const readInterface = createReadInterface(app, knowledge, sourceTree);
  const result = await readInterface.traceImpact(nodeId, {
    direction,
    ...(maxDepth !== undefined && { maxDepth }),
    ...(edgeKinds !== undefined && { edgeKinds })
  });
  return JSON.stringify(result, null, 2);
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

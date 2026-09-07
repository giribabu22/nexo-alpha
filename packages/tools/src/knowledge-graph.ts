import type { ApplicationContext } from "@nexo-alpha/context";

export type KnowledgeNodeKind = "module" | "api" | "service" | "job" | "file" | "symbol" | "external";
export type KnowledgeEdgeKind = "contains" | "exposes" | "depends_on" | "imports" | "calls" | "implements";

/** Where a node's information came from — every node in the graph carries one. */
export interface KnowledgeEvidence {
  readonly file: string;
  readonly line?: number;
}

export interface KnowledgeGraphNode {
  readonly id: string;
  readonly kind: KnowledgeNodeKind;
  readonly name: string;
  readonly description?: string;
  readonly evidence?: KnowledgeEvidence;
  /** Present only when a `summarize` hook was supplied to {@link buildKnowledgeGraph}. */
  readonly summary?: string;
}

export interface KnowledgeGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: KnowledgeEdgeKind;
  /** Present only for a `"calls"` edge resolved via the heuristic `obj.method()` pattern. See `CallEdge` in `@nexo-alpha/context`. */
  readonly confidence?: "heuristic";
}

export interface KnowledgeGraph {
  readonly nodes: readonly KnowledgeGraphNode[];
  readonly edges: readonly KnowledgeGraphEdge[];
}

/**
 * Caller-supplied hook that produces a short human/AI-readable summary for
 * a node. `buildKnowledgeGraph` never calls an AI provider itself — the
 * same declare-the-shape-caller-supplies-the-behavior split already used
 * for `NexoAuthenticator` (packages/core/src/api.ts) and `NexoJobRunner`
 * (packages/core/src/job.ts). Returning `undefined` leaves the node
 * without a summary.
 */
export type KnowledgeNodeSummarizer = (
  node: KnowledgeGraphNode
) => string | undefined | Promise<string | undefined>;

export interface BuildKnowledgeGraphOptions {
  readonly summarize?: KnowledgeNodeSummarizer;
}

function moduleId(name: string): string {
  return `module:${name}`;
}
function apiId(moduleName: string, apiName: string): string {
  return `api:${moduleName}.${apiName}`;
}
function serviceId(moduleName: string, serviceName: string): string {
  return `service:${moduleName}.${serviceName}`;
}
function jobId(moduleName: string, jobName: string): string {
  return `job:${moduleName}.${jobName}`;
}
function fileId(path: string): string {
  return `file:${path}`;
}
function symbolId(path: string, name: string): string {
  return `symbol:${path}#${name}`;
}
function externalId(name: string): string {
  return `external:${name}`;
}

/** `exactOptionalPropertyTypes`-safe way to conditionally include `description`. */
function descriptionField(description: string | undefined): { readonly description: string } | Record<string, never> {
  return description !== undefined ? { description } : {};
}

/**
 * Builds a unified relationship graph over an `ApplicationContext`'s
 * registry-derived structure (modules/APIs/services/jobs/declared
 * dependencies) and, when present, its scanned source tree
 * (files/symbols/imports/calls) — the two halves of Knowledge that
 * `buildContext()` already joins side by side, joined again here into a
 * single queryable graph instead of two parallel lists.
 *
 * Every node carries `evidence` (a file, and a line when known) pointing
 * back to where it came from, so nothing in the graph is unsourced — a
 * module/API/service/job node itself still has no evidence (it's declared
 * in code the scan doesn't parse for that purpose), but when a module
 * declares `sourceFiles` (`NexoModule.sourceFiles`) and a source tree was
 * scanned, an `"implements"` edge links it to the matching `file` node(s),
 * which do carry evidence. A declared path the scan didn't actually find is
 * left unlinked, not guessed at.
 *
 * Bare package imports (e.g. `"react"`, `"node:fs"`) become `"imports"`
 * edges to an `external` node too, the same way an unresolved call target
 * does — a file's dependency on a package it doesn't own is still a
 * dependency worth representing in the graph.
 */
export async function buildKnowledgeGraph(
  context: ApplicationContext,
  options: BuildKnowledgeGraphOptions = {}
): Promise<KnowledgeGraph> {
  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges: KnowledgeGraphEdge[] = [];

  const addNode = (node: KnowledgeGraphNode): void => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  };

  const registeredModuleNames = new Set(context.modules.map((module) => module.name));

  for (const module of context.modules) {
    addNode({
      id: moduleId(module.name),
      kind: "module",
      name: module.name,
      ...descriptionField(module.purpose ?? module.description)
    });

    for (const api of module.apis) {
      const id = apiId(module.name, api.name);
      addNode({
        id,
        kind: "api",
        name: api.name,
        ...descriptionField(api.purpose ?? api.description)
      });
      edges.push({ from: moduleId(module.name), to: id, kind: "exposes" });
    }

    for (const service of module.services) {
      const id = serviceId(module.name, service.name);
      addNode({
        id,
        kind: "service",
        name: service.name,
        ...descriptionField(service.purpose ?? service.description)
      });
      edges.push({ from: moduleId(module.name), to: id, kind: "contains" });
    }

    for (const job of module.jobs) {
      const id = jobId(module.name, job.name);
      addNode({
        id,
        kind: "job",
        name: job.name,
        ...descriptionField(job.description)
      });
      edges.push({ from: moduleId(module.name), to: id, kind: "contains" });
    }
  }

  for (const edge of context.structure.dependencyEdges) {
    const targetIsModule = registeredModuleNames.has(edge.to);
    const to = targetIsModule ? moduleId(edge.to) : externalId(edge.to);
    if (!targetIsModule) {
      addNode({ id: to, kind: "external", name: edge.to });
    }
    edges.push({ from: moduleId(edge.from), to, kind: "depends_on" });
  }

  if (context.sourceTree !== undefined) {
    for (const file of context.sourceTree.files) {
      addNode({ id: fileId(file.path), kind: "file", name: file.path, evidence: { file: file.path } });

      for (const symbol of file.symbols) {
        const id = symbolId(file.path, symbol.name);
        addNode({
          id,
          kind: "symbol",
          name: symbol.name,
          evidence: { file: file.path, line: symbol.line }
        });
        edges.push({ from: fileId(file.path), to: id, kind: "contains" });
      }
    }

    const scannedFilePaths = new Set(context.sourceTree.files.map((file) => file.path));
    for (const module of context.modules) {
      for (const path of module.sourceFiles) {
        // A declared sourceFiles path that wasn't actually found by the scan
        // is left unlinked, not guessed at or errored on — same stance as an
        // unresolved bare-package call/import.
        if (scannedFilePaths.has(path)) {
          edges.push({ from: moduleId(module.name), to: fileId(path), kind: "implements" });
        }
      }
    }

    for (const edge of context.sourceTree.importEdges) {
      edges.push({ from: fileId(edge.from), to: fileId(edge.to), kind: "imports" });
    }

    for (const file of context.sourceTree.files) {
      for (const specifier of file.imports) {
        if (specifier.startsWith(".")) continue; // already covered by importEdges above
        const to = externalId(specifier);
        addNode({ id: to, kind: "external", name: specifier });
        edges.push({ from: fileId(file.path), to, kind: "imports" });
      }
    }

    for (const edge of context.sourceTree.callEdges) {
      const from = symbolId(edge.from.file, edge.from.symbol);
      const confidence = edge.confidence !== undefined ? { confidence: edge.confidence } : {};
      if (edge.to !== undefined) {
        edges.push({ from, to: symbolId(edge.to.file, edge.to.symbol), kind: "calls", ...confidence });
      } else if (edge.toExternal !== undefined) {
        const to = externalId(edge.toExternal);
        addNode({ id: to, kind: "external", name: edge.toExternal });
        edges.push({ from, to, kind: "calls", ...confidence });
      }
    }
  }

  const { summarize } = options;
  const collectedNodes = [...nodes.values()];
  const summarizedNodes =
    summarize === undefined
      ? collectedNodes
      : await Promise.all(
          collectedNodes.map(async (node) => {
            const summary = await summarize(node);
            return summary === undefined ? node : { ...node, summary };
          })
        );

  return {
    nodes: summarizedNodes,
    edges: [...edges].sort((a, b) => {
      if (a.from !== b.from) return a.from.localeCompare(b.from);
      if (a.to !== b.to) return a.to.localeCompare(b.to);
      return a.kind.localeCompare(b.kind);
    })
  };
}

/**
 * Keyword search over node names/descriptions/summaries — plain
 * case-insensitive substring matching, not a vector/semantic index. See
 * {@link buildKnowledgeGraph}'s doc comment for why: no embedding provider
 * is wired into this framework.
 */
export function searchKnowledgeGraph(graph: KnowledgeGraph, query: string): readonly KnowledgeGraphNode[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }

  return graph.nodes.filter(
    (node) =>
      node.name.toLowerCase().includes(needle) ||
      (node.description?.toLowerCase().includes(needle) ?? false) ||
      (node.summary?.toLowerCase().includes(needle) ?? false)
  );
}

/** Edges of kind `"calls"` that point at `nodeId` — "what calls this symbol." */
export function traceCallers(graph: KnowledgeGraph, nodeId: string): readonly KnowledgeGraphEdge[] {
  return graph.edges.filter((edge) => edge.kind === "calls" && edge.to === nodeId);
}

/** Every edge that points at `nodeId`, of any kind — "what would be affected if this changed." */
export function traceDependents(graph: KnowledgeGraph, nodeId: string): readonly KnowledgeGraphEdge[] {
  return graph.edges.filter((edge) => edge.to === nodeId);
}

/**
 * `"dependents"` walks edges backward (what points at a node, transitively —
 * change-impact/blast-radius analysis); `"dependencies"` walks them forward
 * (what a node points at, transitively).
 */
export type TraversalDirection = "dependents" | "dependencies";

export interface TraceImpactOptions {
  /** Default: `"dependents"`. */
  readonly direction?: TraversalDirection;
  /** Maximum hops to traverse. Default: unlimited (cycle protection still applies). */
  readonly maxDepth?: number;
  /** Restrict traversal to these edge kinds. Default: all kinds, same stance as {@link traceDependents}. */
  readonly edgeKinds?: readonly KnowledgeEdgeKind[];
}

export interface TraceImpactHit {
  readonly nodeId: string;
  /** Hop count from the origin (1 = directly connected). */
  readonly depth: number;
  /** The edge that first reached this node (shortest path, since traversal is BFS). */
  readonly via: KnowledgeGraphEdge;
}

export interface TraceImpactResult {
  readonly nodeId: string;
  readonly direction: TraversalDirection;
  /** Every node reachable from `nodeId` in `direction`, excluding `nodeId` itself, each at its shortest-path depth. */
  readonly reached: readonly TraceImpactHit[];
}

/**
 * Multi-hop traversal over the graph, breadth-first so each reached node is
 * recorded at its shortest-path depth and a visited set gives cycle
 * protection for free. This is what {@link traceDependents}/{@link traceCallers}
 * can't answer on their own: "what is the full blast radius of changing this
 * node," not just its immediate neighbors.
 */
export function traceImpact(
  graph: KnowledgeGraph,
  nodeId: string,
  options: TraceImpactOptions = {}
): TraceImpactResult {
  const direction = options.direction ?? "dependents";
  const { maxDepth, edgeKinds } = options;

  const candidateEdges =
    edgeKinds === undefined ? graph.edges : graph.edges.filter((edge) => edgeKinds.includes(edge.kind));

  const visited = new Set<string>([nodeId]);
  const reached: TraceImpactHit[] = [];
  let frontier = [nodeId];
  let depth = 0;

  while (frontier.length > 0 && (maxDepth === undefined || depth < maxDepth)) {
    depth += 1;
    const nextFrontier: string[] = [];

    for (const current of frontier) {
      const neighbors =
        direction === "dependents"
          ? candidateEdges.filter((edge) => edge.to === current).map((edge) => ({ id: edge.from, via: edge }))
          : candidateEdges.filter((edge) => edge.from === current).map((edge) => ({ id: edge.to, via: edge }));

      for (const { id, via } of neighbors) {
        if (visited.has(id)) continue;
        visited.add(id);
        reached.push({ nodeId: id, depth, via });
        nextFrontier.push(id);
      }
    }

    frontier = nextFrontier;
  }

  return { nodeId, direction, reached };
}

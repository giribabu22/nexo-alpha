import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { KnowledgeGraph } from "./knowledge-graph.js";

/**
 * The schema version of {@link StoredKnowledgeGraph} written by
 * {@link saveKnowledgeGraph}. Bump if the on-disk shape changes in a way
 * that isn't backward-compatible with {@link loadKnowledgeGraph}.
 */
export const KNOWLEDGE_GRAPH_SCHEMA_VERSION = 1;

/**
 * Staleness metadata saved alongside a {@link KnowledgeGraph} — mirrors
 * `structureHash`/`sourceTreeHash` already on `ApplicationContext`
 * (packages/context/src/context.ts), so a saved graph can be compared
 * against a freshly computed context without re-diffing the graph itself.
 */
export interface KnowledgeGraphMeta {
  readonly structureHash: string;
  /** Absent when the graph was built without a source-tree scan. */
  readonly sourceTreeHash?: string;
  readonly generatedAt: string;
  readonly schemaVersion: number;
}

export interface StoredKnowledgeGraph {
  readonly meta: KnowledgeGraphMeta;
  readonly graph: KnowledgeGraph;
}

/**
 * Writes a {@link KnowledgeGraph} to `path` as JSON, alongside the
 * structure/source-tree hashes it was built from. Creates any missing
 * parent directories (e.g. `.nexo/`) the same way a project first sets up
 * its own config directory.
 */
export async function saveKnowledgeGraph(
  path: string,
  graph: KnowledgeGraph,
  hashes: { readonly structureHash: string; readonly sourceTreeHash?: string }
): Promise<StoredKnowledgeGraph> {
  const stored: StoredKnowledgeGraph = {
    meta: {
      structureHash: hashes.structureHash,
      ...(hashes.sourceTreeHash !== undefined && { sourceTreeHash: hashes.sourceTreeHash }),
      generatedAt: new Date().toISOString(),
      schemaVersion: KNOWLEDGE_GRAPH_SCHEMA_VERSION
    },
    graph
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(stored, null, 2), "utf8");

  return stored;
}

/**
 * Reads a previously saved {@link StoredKnowledgeGraph} from `path`.
 * Returns `undefined` when the file is missing or its contents aren't
 * valid JSON — the same graceful-degradation stance as
 * `NexoReadInterface.getModule()` returning `undefined` for an unknown
 * name, rather than throwing on an unexceptional "not there yet" case.
 */
export async function loadKnowledgeGraph(path: string): Promise<StoredKnowledgeGraph | undefined> {
  try {
    const contents = await readFile(path, "utf8");
    return JSON.parse(contents) as StoredKnowledgeGraph;
  } catch {
    return undefined;
  }
}

/**
 * Whether a saved graph's metadata still matches the application's current
 * `structureHash`/`sourceTreeHash` — `true` means the saved graph no longer
 * reflects the live registry and/or source tree and should be rebuilt.
 */
export function isGraphStale(
  meta: KnowledgeGraphMeta,
  structureHash: string,
  sourceTreeHash?: string
): boolean {
  return meta.structureHash !== structureHash || meta.sourceTreeHash !== sourceTreeHash;
}

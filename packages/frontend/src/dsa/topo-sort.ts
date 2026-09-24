/**
 * Topological sort (Kahn's algorithm) — O(V + E).
 *
 * Returns nodes in dependency-first order (all dependencies before dependents).
 * Throws a descriptive error if a cycle is detected.
 *
 * Used to:
 *  - Order NexoModule startup so dependencies initialise before dependents
 *  - Order DAG render batches correctly when depth alone is ambiguous
 */
export interface TopoNode {
  /** Unique identifier for this node. */
  readonly id: string;
  /** IDs of nodes this one depends on (must come before this node). */
  readonly deps: readonly string[];
}

export interface TopoSortResult<T extends TopoNode> {
  /** Nodes in dependency-first topological order. */
  readonly sorted: readonly T[];
  /** Whether a cycle was detected (sorted will be partial if true). */
  readonly hasCycle: boolean;
  /** IDs of nodes involved in the cycle(s), if any. */
  readonly cycleNodes: readonly string[];
}

/**
 * Topological sort via Kahn's algorithm.
 *
 * @param nodes - All nodes to sort. Unknown dep IDs are silently ignored.
 * @returns Sorted nodes + cycle detection metadata.
 */
export function topoSort<T extends TopoNode>(nodes: readonly T[]): TopoSortResult<T> {
  const nodeMap = new Map<string, T>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  // In-degree count per node (only counting edges within the node set)
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>(); // dep → dependents

  for (const n of nodes) {
    if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
    if (!adjList.has(n.id)) adjList.set(n.id, []);

    for (const dep of n.deps) {
      if (!nodeMap.has(dep)) continue; // skip external / unknown deps
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      const list = adjList.get(dep) ?? [];
      list.push(n.id);
      adjList.set(dep, list);
    }
  }

  // Kahn's: queue starts with all zero-in-degree nodes
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: T[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);

    for (const dependent of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) {
        queue.push(dependent);
      }
    }
  }

  const hasCycle = sorted.length < nodes.length;
  const sortedIds = new Set(sorted.map((n) => n.id));
  const cycleNodes = hasCycle ? [...nodeMap.keys()].filter((id) => !sortedIds.has(id)) : [];

  if (hasCycle) {
    throw new Error(
      `[NexoTopoSort] Circular dependency detected among: ${cycleNodes.join(", ")}`
    );
  }

  return { sorted, hasCycle, cycleNodes };
}

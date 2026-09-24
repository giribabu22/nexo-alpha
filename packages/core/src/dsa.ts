/**
 * DSA utilities for @nexo-alpha/core
 *
 * Topological sort for module startup ordering and dependency-aware
 * cycle detection. Uses Kahn's algorithm O(V+E).
 */

export interface TopoNode {
  /** Unique identifier for this node. */
  readonly id: string;
  /** IDs of nodes this one depends on (must start before this node). */
  readonly deps: readonly string[];
}

export interface TopoSortResult<T extends TopoNode> {
  /** Nodes in dependency-first topological order. */
  readonly sorted: readonly T[];
  /** Whether a cycle was detected. */
  readonly hasCycle: boolean;
  /** IDs of nodes involved in the cycle(s). */
  readonly cycleNodes: readonly string[];
}

/**
 * Topological sort via Kahn's algorithm.
 * O(V + E) time, O(V + E) space.
 *
 * @throws {Error} if a circular dependency is detected (includes cycle node IDs)
 */
export function topoSort<T extends TopoNode>(nodes: readonly T[]): TopoSortResult<T> {
  const nodeMap = new Map<string, T>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>(); // dep → dependents

  for (const n of nodes) {
    if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
    if (!adjList.has(n.id)) adjList.set(n.id, []);

    for (const dep of n.deps) {
      if (!nodeMap.has(dep)) continue;
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      const list = adjList.get(dep) ?? [];
      list.push(n.id);
      adjList.set(dep, list);
    }
  }

  // Queue starts with all zero-in-degree nodes
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
      if (newDeg === 0) queue.push(dependent);
    }
  }

  const hasCycle = sorted.length < nodes.length;
  const sortedIds = new Set(sorted.map((n) => n.id));
  const cycleNodes = hasCycle ? [...nodeMap.keys()].filter((id) => !sortedIds.has(id)) : [];

  if (hasCycle) {
    throw new Error(
      `[NexoCore] Circular module dependency detected: ${cycleNodes.join(" → ")}`
    );
  }

  return { sorted, hasCycle, cycleNodes };
}

// ---------------------------------------------------------------------------
// DSA: Memoize — O(1) repeated call avoidance via Map
// ---------------------------------------------------------------------------

/**
 * Creates a memoized version of `fn` keyed by JSON.stringify of its argument.
 * Useful for expensive pure functions called repeatedly with the same input
 * (e.g., schema validators, config parsers).
 */
export function memoize<TInput, TOutput>(
  fn: (input: TInput) => TOutput,
  keyFn?: (input: TInput) => string
): (input: TInput) => TOutput {
  const cache = new Map<string, TOutput>();
  const makeKey = keyFn ?? ((input) => JSON.stringify(input));

  return (input: TInput): TOutput => {
    const key = makeKey(input);
    if (cache.has(key)) return cache.get(key)!;
    const result = fn(input);
    cache.set(key, result);
    return result;
  };
}

// ---------------------------------------------------------------------------
// DSA: CountingMap — O(1) frequency tracking
// ---------------------------------------------------------------------------

/**
 * A Map that tracks counts of string keys.
 * Used in telemetry and event frequency analysis.
 */
export class CountingMap {
  private readonly counts = new Map<string, number>();

  increment(key: string, by = 1): number {
    const next = (this.counts.get(key) ?? 0) + by;
    this.counts.set(key, next);
    return next;
  }

  decrement(key: string, by = 1): number {
    const next = Math.max(0, (this.counts.get(key) ?? 0) - by);
    if (next === 0) this.counts.delete(key);
    else this.counts.set(key, next);
    return next;
  }

  get(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  topN(n: number): Array<{ key: string; count: number }> {
    return [...this.counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  clear(): void {
    this.counts.clear();
  }
}

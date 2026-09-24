import { ArrayDeque } from "./queue.js";
import { MinHeap } from "./heap.js";

export interface ElementNode<TData = unknown> {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly parents: Set<string>;
  readonly children: Set<string>;
  dirty: boolean;
  version: number;
  data?: TData | undefined;
}

/**
 * NexoElementGraph — Directed Acyclic Graph tracking parent→child
 * component relationships for optimised dirty-propagation and render ordering.
 *
 * Upgraded internals:
 *  - markDirty() uses ArrayDeque<string> for O(1) BFS instead of Array.shift()
 *  - getRenderBatch() uses MinHeap<ElementNode> for O(n log n) depth-ordered
 *    sort instead of Array.sort() on the full list
 */
export class NexoElementGraph<TData = unknown> {
  private readonly nodes = new Map<string, ElementNode<TData>>();

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNode(id: string): ElementNode<TData> | undefined {
    return this.nodes.get(id);
  }

  addNode(id: string, name: string, depth = 0, initialData?: TData): ElementNode<TData> {
    const existing = this.nodes.get(id);
    if (existing) {
      if (initialData !== undefined) existing.data = initialData;
      return existing;
    }

    const node: ElementNode<TData> = {
      id,
      name,
      depth,
      parents: new Set(),
      children: new Set(),
      dirty: false,
      version: 1,
      data: initialData
    };

    this.nodes.set(id, node);
    return node;
  }

  removeNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    for (const parentId of node.parents) {
      this.nodes.get(parentId)?.children.delete(id);
    }
    for (const childId of node.children) {
      this.nodes.get(childId)?.parents.delete(id);
    }

    return this.nodes.delete(id);
  }

  addEdge(parentId: string, childId: string): void {
    if (parentId === childId) {
      throw new Error(`Self-referencing parent-child relation on "${parentId}" is invalid in a DAG`);
    }

    const parent = this.nodes.get(parentId);
    const child = this.nodes.get(childId);
    if (!parent || !child) return;

    parent.children.add(childId);
    child.parents.add(parentId);
  }

  /**
   * Mark a node dirty and propagate to all reachable children.
   *
   * Uses ArrayDeque for O(1) BFS (replaces Array.shift() which is O(n)).
   * Returns the set of all affected node IDs.
   */
  markDirty(nodeId: string, propagateToChildren = true): Set<string> {
    const affected = new Set<string>();
    const node = this.nodes.get(nodeId);
    if (!node) return affected;

    node.dirty = true;
    node.version++;
    affected.add(nodeId);

    if (propagateToChildren) {
      const queue = new ArrayDeque<string>();
      queue.pushAll(node.children);

      while (!queue.isEmpty) {
        const currentId = queue.shift()!;
        if (!affected.has(currentId)) {
          affected.add(currentId);
          const childNode = this.nodes.get(currentId);
          if (childNode) {
            childNode.dirty = true;
            childNode.version++;
            queue.pushAll(childNode.children);
          }
        }
      }
    }

    return affected;
  }

  clearDirty(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) node.dirty = false;
  }

  /**
   * Return dirty nodes in depth-first render order (parents before children).
   *
   * Uses MinHeap<ElementNode> for O(n log n) ordering instead of
   * Array.sort() which rebuilds its array on every call.
   */
  getRenderBatch(dirtyNodeIds?: Iterable<string>): readonly ElementNode<TData>[] {
    const targetIds = dirtyNodeIds
      ? new Set(dirtyNodeIds)
      : new Set([...this.nodes.values()].filter((n) => n.dirty).map((n) => n.id));

    if (targetIds.size === 0) return [];

    // MinHeap orders by depth (ascending) — parents render before children
    const heap = new MinHeap<ElementNode<TData>>((a, b) => a.depth - b.depth);

    for (const id of targetIds) {
      const n = this.nodes.get(id);
      if (n !== undefined) heap.push(n);
    }

    const result: ElementNode<TData>[] = [];
    while (!heap.isEmpty) {
      result.push(heap.pop()!);
    }
    return result;
  }

  getAllNodes(): readonly ElementNode<TData>[] {
    return [...this.nodes.values()];
  }

  get size(): number {
    return this.nodes.size;
  }

  clear(): void {
    this.nodes.clear();
  }
}

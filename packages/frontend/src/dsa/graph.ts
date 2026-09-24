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

    // Disconnect from parents
    for (const parentId of node.parents) {
      const parent = this.nodes.get(parentId);
      if (parent) {
        parent.children.delete(id);
      }
    }

    // Disconnect from children
    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      if (child) {
        child.parents.delete(id);
      }
    }

    return this.nodes.delete(id);
  }

  addEdge(parentId: string, childId: string): void {
    if (parentId === childId) {
      throw new Error(`Self-referencing parent-child relation on "${parentId}" is invalid in a DAG`);
    }

    const parent = this.nodes.get(parentId);
    const child = this.nodes.get(childId);

    if (!parent || !child) {
      return;
    }

    parent.children.add(childId);
    child.parents.add(parentId);
  }

  markDirty(nodeId: string, propagateToChildren = true): Set<string> {
    const affected = new Set<string>();
    const node = this.nodes.get(nodeId);
    if (!node) return affected;

    node.dirty = true;
    node.version++;
    affected.add(nodeId);

    if (propagateToChildren) {
      const queue = [...node.children];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (!affected.has(currentId)) {
          affected.add(currentId);
          const childNode = this.nodes.get(currentId);
          if (childNode) {
            childNode.dirty = true;
            childNode.version++;
            queue.push(...childNode.children);
          }
        }
      }
    }

    return affected;
  }

  clearDirty(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.dirty = false;
    }
  }

  getRenderBatch(dirtyNodeIds?: Iterable<string>): readonly ElementNode<TData>[] {
    const targetIds = dirtyNodeIds
      ? new Set(dirtyNodeIds)
      : new Set([...this.nodes.values()].filter((n) => n.dirty).map((n) => n.id));

    if (targetIds.size === 0) {
      return [];
    }

    // Topological sorting via Kahn's algorithm or depth ranking
    const matchedNodes = [...targetIds]
      .map((id) => this.nodes.get(id))
      .filter((n): n is ElementNode<TData> => n !== undefined);

    // Sort parents before children (lower depth to higher depth)
    return matchedNodes.sort((a, b) => a.depth - b.depth);
  }

  getAllNodes(): readonly ElementNode<TData>[] {
    return [...this.nodes.values()];
  }

  clear(): void {
    this.nodes.clear();
  }
}

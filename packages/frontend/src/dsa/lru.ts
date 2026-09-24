interface LruNode<K, V> {
  key: K;
  value: V;
  prev: LruNode<K, V> | null;
  next: LruNode<K, V> | null;
}

export class NexoLruCache<K = string, V = unknown> {
  private readonly capacity: number;
  private readonly map = new Map<K, LruNode<K, V>>();
  private head: LruNode<K, V> | null = null;
  private tail: LruNode<K, V> | null = null;

  constructor(capacity = 100) {
    if (capacity <= 0) {
      throw new Error("LruCache capacity must be greater than 0");
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToHead(node);
    return node.value;
  }

  set(key: K, value: V): this {
    let node = this.map.get(key);

    if (node) {
      node.value = value;
      this.moveToHead(node);
      return this;
    }

    node = { key, value, prev: null, next: null };
    this.map.set(key, node);
    this.addToHead(node);

    if (this.map.size > this.capacity) {
      this.removeTail();
    }

    return this;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  private addToHead(node: LruNode<K, V>): void {
    node.next = this.head;
    node.prev = null;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LruNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: LruNode<K, V>): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeTail(): void {
    if (!this.tail) return;
    const tailKey = this.tail.key;
    this.removeNode(this.tail);
    this.map.delete(tailKey);
  }
}

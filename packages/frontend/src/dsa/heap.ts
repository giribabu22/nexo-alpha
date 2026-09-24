/**
 * MinHeap<T> — O(log n) push/pop binary min-heap.
 *
 * Used for:
 *  - Priority-ordered render batching (lowest depth = highest priority)
 *  - Scheduler next-fire ordering in DscJobScheduler
 *
 * The comparator receives (a, b) and must return < 0 when a has higher
 * priority (should come out first).
 */
export class MinHeap<T> {
  private readonly data: T[] = [];
  private readonly cmp: (a: T, b: T) => number;

  constructor(comparator: (a: T, b: T) => number) {
    this.cmp = comparator;
  }

  get size(): number {
    return this.data.length;
  }

  get isEmpty(): boolean {
    return this.data.length === 0;
  }

  /** O(log n) */
  push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  /** Peek at the minimum without removing. O(1) */
  peek(): T | undefined {
    return this.data[0];
  }

  /** Remove and return the minimum. O(log n) */
  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Build a heap from an array in O(n). */
  static from<T>(items: T[], comparator: (a: T, b: T) => number): MinHeap<T> {
    const h = new MinHeap<T>(comparator);
    h.data.push(...items);
    for (let i = Math.floor(h.data.length / 2) - 1; i >= 0; i--) {
      h.siftDown(i);
    }
    return h;
  }

  clear(): void {
    this.data.length = 0;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.cmp(this.data[i]!, this.data[parent]!) < 0) {
        this.swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;

      if (left < n && this.cmp(this.data[left]!, this.data[smallest]!) < 0) {
        smallest = left;
      }
      if (right < n && this.cmp(this.data[right]!, this.data[smallest]!) < 0) {
        smallest = right;
      }

      if (smallest !== i) {
        this.swap(i, smallest);
        i = smallest;
      } else {
        break;
      }
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.data[a]!;
    this.data[a] = this.data[b]!;
    this.data[b] = tmp;
  }
}

/** Depth-ordered heap: roots (depth 0) come out first. */
export function createDepthHeap<T extends { depth: number }>(): MinHeap<T> {
  return new MinHeap<T>((a, b) => a.depth - b.depth);
}

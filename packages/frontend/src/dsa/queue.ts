/**
 * ArrayDeque — O(1) amortized push/shift via a circular ring buffer.
 *
 * JavaScript's built-in Array.shift() is O(n). This replaces it in BFS/queue
 * scenarios (markDirty propagation, render-batch ordering) with O(1) dequeue.
 *
 * Capacity doubles when full (amortized O(1) push).
 */
export class ArrayDeque<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private _size = 0;

  constructor(initialCapacity = 16) {
    this.buf = new Array(initialCapacity);
  }

  get size(): number {
    return this._size;
  }

  get isEmpty(): boolean {
    return this._size === 0;
  }

  /** O(1) amortized. */
  push(item: T): void {
    if (this._size === this.buf.length) {
      this.resize();
    }
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) & (this.buf.length - 1);
    this._size++;
  }

  /** Push many items at once. */
  pushAll(items: Iterable<T>): void {
    for (const item of items) {
      this.push(item);
    }
  }

  /** O(1) dequeue from front. Returns undefined on empty. */
  shift(): T | undefined {
    if (this._size === 0) return undefined;
    const item = this.buf[this.head];
    this.buf[this.head] = undefined; // free GC ref
    this.head = (this.head + 1) & (this.buf.length - 1);
    this._size--;
    return item;
  }

  /** Peek at the front without removing. */
  peek(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buf[this.head];
  }

  clear(): void {
    this.buf = new Array(16);
    this.head = 0;
    this.tail = 0;
    this._size = 0;
  }

  private resize(): void {
    const newCap = this.buf.length * 2;
    const newBuf: (T | undefined)[] = new Array(newCap);
    for (let i = 0; i < this._size; i++) {
      newBuf[i] = this.buf[(this.head + i) & (this.buf.length - 1)];
    }
    this.buf = newBuf;
    this.head = 0;
    this.tail = this._size;
  }
}

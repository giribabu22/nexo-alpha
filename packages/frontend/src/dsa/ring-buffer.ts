/**
 * RingBuffer<T> — bounded circular buffer with O(1) push/read.
 *
 * Used as the backing store for DscCollector metrics so telemetry has
 * a hard cap on memory usage. When full, the oldest entry is silently
 * overwritten (FIFO eviction).
 *
 * Unlike ArrayDeque, RingBuffer does NOT grow — it is intentionally
 * bounded at construction time for predictable memory footprint.
 */
export class RingBuffer<T> {
  private readonly buf: (T | undefined)[];
  private head = 0;   // index of the oldest entry
  private tail = 0;   // index where the next entry will be written
  private _size = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error("RingBuffer capacity must be > 0");
    }
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  get size(): number {
    return this._size;
  }

  get isFull(): boolean {
    return this._size === this.capacity;
  }

  get isEmpty(): boolean {
    return this._size === 0;
  }

  /**
   * Write an item. O(1).
   * If the buffer is full, the oldest entry is overwritten.
   */
  push(item: T): void {
    if (this._size === this.capacity) {
      // Overwrite oldest — advance head
      this.head = (this.head + 1) % this.capacity;
    } else {
      this._size++;
    }
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
  }

  /** Read all items in insertion order (oldest → newest). O(n). */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this._size; i++) {
      result.push(this.buf[(this.head + i) % this.capacity] as T);
    }
    return result;
  }

  /** Peek at the oldest item without removing it. O(1). */
  peekOldest(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buf[this.head];
  }

  /** Peek at the newest item. O(1). */
  peekNewest(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buf[(this.tail - 1 + this.capacity) % this.capacity];
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this._size = 0;
  }
}

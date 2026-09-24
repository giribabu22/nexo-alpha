/**
 * NexoBloomFilter — probabilistic membership test in O(k) time & O(m) space.
 *
 * A Bloom filter allows fast "definitely NOT in set" checks with zero false
 * negatives and a tunable false-positive rate. We use it in the DSC layer
 * as a cheap pre-check before hitting the LRU cache: if the Bloom filter
 * says the key is absent, we skip the Map lookup entirely.
 *
 * False-positive probability: p ≈ (1 - e^(-k*n/m))^k
 * Optimal hash count: k = (m/n) * ln(2)
 *
 * Default: m=2048 bits, k=3 hashes → ~1.2% FP rate at 512 entries.
 */
export class NexoBloomFilter {
  private readonly bits: Uint8Array;
  private readonly m: number; // total bit count
  private readonly k: number; // hash function count

  constructor(m = 2048, k = 3) {
    this.m = m;
    this.k = k;
    this.bits = new Uint8Array(Math.ceil(m / 8));
  }

  /** Add a key. O(k). */
  add(key: string): void {
    for (let i = 0; i < this.k; i++) {
      const index = this.hash(key, i) % this.m;
      this.bits[index >> 3]! |= 1 << (index & 7);
    }
  }

  /**
   * Test for membership. O(k).
   * Returns false  → key is DEFINITELY not present.
   * Returns true   → key is PROBABLY present (may be a false positive).
   */
  mightContain(key: string): boolean {
    for (let i = 0; i < this.k; i++) {
      const index = this.hash(key, i) % this.m;
      if (!((this.bits[index >> 3]! >> (index & 7)) & 1)) {
        return false;
      }
    }
    return true;
  }

  clear(): void {
    this.bits.fill(0);
  }

  /**
   * Double-hash function: hash_i(key) = h1(key) + i * h2(key)
   * (Kirsch–Mitzenmacher technique — only 2 real hashes needed for k).
   */
  private hash(key: string, seed: number): number {
    let h1 = 2166136261; // FNV-1a offset basis
    let h2 = 0;

    for (let j = 0; j < key.length; j++) {
      const c = key.charCodeAt(j);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ (c << 5), 2246822519);
    }

    // Combine with seed using the K-M technique
    return Math.abs((h1 + seed * h2) | 0);
  }
}

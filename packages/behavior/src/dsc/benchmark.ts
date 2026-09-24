/**
 * DSC Benchmark Harness
 *
 * Measures the real-world performance delta between:
 *  - A raw function call (no DSC)
 *  - The same function wrapped in DscOrchestrator (with caching, dedup, bloom)
 *
 * Run this in any Node.js environment to validate the DSA upgrades are
 * delivering their expected O(1) cache, O(1) bloom-filter, and ring-buffer
 * throughput guarantees.
 */

import { DscOrchestrator } from "./orchestrator.js";
import { DscCollector } from "./collector.js";

export interface BenchmarkResult {
  readonly name: string;
  readonly iterations: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly opsPerSec: number;
}

export interface BenchmarkOptions {
  /** Number of warm-up calls before measurement. Default: 100. */
  readonly warmup?: number;
  /** Number of measured iterations. Default: 1000. */
  readonly iterations?: number;
}

/**
 * Benchmark a raw async function.
 */
export async function benchmarkFn<T>(
  name: string,
  fn: () => Promise<T>,
  options: BenchmarkOptions = {}
): Promise<BenchmarkResult> {
  const warmup = options.warmup ?? 100;
  const iterations = options.iterations ?? 1000;

  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  // Measure
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / times.length;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);

  return {
    name,
    iterations,
    totalMs: Math.round(totalMs * 100) / 100,
    avgMs: Math.round(avgMs * 1000) / 1000,
    minMs: Math.round(minMs * 1000) / 1000,
    maxMs: Math.round(maxMs * 1000) / 1000,
    opsPerSec: Math.round(1000 / avgMs)
  };
}

export interface DscBenchmarkReport {
  readonly raw: BenchmarkResult;
  readonly dscCold: BenchmarkResult;
  readonly dscWarm: BenchmarkResult;
  readonly cacheSpeedup: number;
  readonly overhead: number;
  readonly collectorMetrics: ReturnType<DscCollector["getMetrics"]>;
}

/**
 * Run the full DSC benchmark suite:
 *  1. Raw function (baseline)
 *  2. DSC cold (first call, no cache)
 *  3. DSC warm (cache hit — should approach O(1))
 *
 * @param operationName - Name used in DSC operation records
 * @param workFn - The function to benchmark (should be async + do real work)
 * @param options - Benchmark options
 */
export async function runDscBenchmark<T>(
  operationName: string,
  workFn: () => Promise<T>,
  options: BenchmarkOptions = {}
): Promise<DscBenchmarkReport> {
  const collector = new DscCollector(8192);
  const orchestrator = new DscOrchestrator(collector);

  // 1. Raw baseline
  const raw = await benchmarkFn(`${operationName}:raw`, workFn, options);

  // 2. DSC cold (no cache seeded, idempotent so first call populates cache)
  const dscColdOp = {
    name: operationName,
    idempotent: true,
    ttlMs: 60_000,
    execute: async (_ctx: unknown) => workFn()
  };

  const dscCold = await benchmarkFn(
    `${operationName}:dsc-cold`,
    () => orchestrator.run(dscColdOp as any, {}),
    { warmup: 1, iterations: options.iterations ?? 1000 }
  );

  // 3. DSC warm (cache fully populated — should be ~O(1) LRU + Bloom hit)
  const dscWarm = await benchmarkFn(
    `${operationName}:dsc-warm`,
    () => orchestrator.run(dscColdOp as any, {}),
    options
  );

  const cacheSpeedup =
    dscCold.avgMs > 0 ? Math.round((dscCold.avgMs / dscWarm.avgMs) * 10) / 10 : 1;

  const overhead =
    raw.avgMs > 0 ? Math.round(((dscCold.avgMs - raw.avgMs) / raw.avgMs) * 1000) / 10 : 0;

  return {
    raw,
    dscCold,
    dscWarm,
    cacheSpeedup,
    overhead,
    collectorMetrics: collector.getMetrics()
  };
}

/**
 * Print a benchmark report to the console in a human-readable table.
 */
export function printDscBenchmarkReport(report: DscBenchmarkReport): void {
  const { raw, dscCold, dscWarm, cacheSpeedup, overhead, collectorMetrics } = report;

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  DSC Benchmark: ${raw.name.padEnd(36)}║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(
    `║  Raw (baseline):   avg=${String(raw.avgMs + "ms").padEnd(8)} ops/s=${String(raw.opsPerSec).padEnd(10)}║`
  );
  console.log(
    `║  DSC cold:         avg=${String(dscCold.avgMs + "ms").padEnd(8)} ops/s=${String(dscCold.opsPerSec).padEnd(10)}║`
  );
  console.log(
    `║  DSC warm (cache): avg=${String(dscWarm.avgMs + "ms").padEnd(8)} ops/s=${String(dscWarm.opsPerSec).padEnd(10)}║`
  );
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  Cache speedup:    ${String(cacheSpeedup + "x").padEnd(34)}║`);
  console.log(`║  DSC overhead:     ${String(overhead + "%").padEnd(34)}║`);
  console.log(`║  Cache hit rate:   ${String(formatPct(collectorMetrics.cacheHitRate)).padEnd(34)}║`);
  console.log(`║  Deduped ops:      ${String(collectorMetrics.deduplicatedOps).padEnd(34)}║`);
  console.log(`║  Total ops:        ${String(collectorMetrics.totalOperations).padEnd(34)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

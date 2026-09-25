#!/usr/bin/env node
/**
 * Throughput benchmarks for Nexo's runtime hot paths. Run after `pnpm build`:
 *
 *   pnpm bench            # default sizes
 *   pnpm bench -- --quick # smaller sizes, for CI smoke runs
 *
 * Numbers are machine-dependent; compare runs on the same machine to spot
 * regressions.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  createFileDocumentStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore
} from "../packages/core/dist/index.js";
import { createJobQueue } from "../packages/scheduler/dist/index.js";
import { createDocumentWorkflowStore } from "../packages/agent/dist/index.js";
import { createTestAgent, createToolStub, runSteps } from "../packages/agent/dist/testing.js";

const quick = process.argv.includes("--quick");
const scale = (n) => (quick ? Math.max(1, Math.floor(n / 10)) : n);
const results = [];

async function bench(name, operations, fn) {
  const start = performance.now();
  await fn();
  const ms = performance.now() - start;
  results.push({ benchmark: name, ops: operations, "total ms": Math.round(ms), "ops/sec": Math.round((operations / ms) * 1000) });
}

const dir = await mkdtemp(join(tmpdir(), "nexo-bench-"));
try {
  // --- Document stores ------------------------------------------------------
  const stores = [
    ["memory", async () => createInMemoryDocumentStore()],
    ["file", async () => createFileDocumentStore(join(dir, "bench.json"))],
    ["sqlite", async () => createSqliteDocumentStore(join(dir, "bench.sqlite"))]
  ];
  for (const [name, create] of stores) {
    let store;
    try {
      store = await create();
    } catch {
      results.push({ benchmark: `store.put (${name})`, ops: 0, "total ms": 0, "ops/sec": "n/a (needs Node >= 22.5)" });
      continue;
    }
    const n = scale(name === "file" ? 500 : 5000);
    await bench(`store.put (${name})`, n, async () => {
      for (let i = 0; i < n; i++) await store.put("docs", `d${i}`, { i, payload: "x".repeat(200) });
    });
    await bench(`store.get (${name})`, n, async () => {
      for (let i = 0; i < n; i++) await store.get("docs", `d${i}`);
    });
    await store.close();
  }

  // --- Workflows ------------------------------------------------------------
  const { agent } = createTestAgent({ tools: [createToolStub("lookup"), createToolStub("refund")] });
  const steps = [{ action: "lookup" }, { action: "refund" }];

  const runs = scale(2000);
  await bench("workflow run, 2 steps (in-memory)", runs, async () => {
    for (let i = 0; i < runs; i++) await runSteps(agent, steps);
  });

  try {
    const sqlite = await createSqliteDocumentStore(join(dir, "runs.sqlite"));
    const persisted = scale(500);
    await bench("workflow run, 2 steps (SQLite-persisted)", persisted, async () => {
      for (let i = 0; i < persisted; i++) {
        await runSteps(agent, steps, { workflow: { store: createDocumentWorkflowStore(sqlite) } });
      }
    });
    await sqlite.close();
  } catch {
    results.push({ benchmark: "workflow run (SQLite-persisted)", ops: 0, "total ms": 0, "ops/sec": "n/a (needs Node >= 22.5)" });
  }

  // --- Job queue ------------------------------------------------------------
  for (const concurrency of [1, 8]) {
    const jobs = scale(2000);
    const queue = createJobQueue({ store: createInMemoryDocumentStore(), concurrency, pollIntervalMs: 50 });
    queue.define("noop", async () => undefined);
    await queue.start();
    await bench(`queue enqueue+process (concurrency ${concurrency})`, jobs, async () => {
      for (let i = 0; i < jobs; i++) await queue.enqueue("noop", { i });
      await queue.whenIdle();
    });
    await queue.stop();
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`Nexo benchmarks (Node ${process.version}${quick ? ", --quick" : ""})`);
console.table(results);

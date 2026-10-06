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
  createSqliteDocumentStore,
  field,
  model,
  resource
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

  // --- resource().list on SQLite: in SQL vs in memory -------------------------
  try {
    const Product = model("products", {
      name: field.string(),
      price: field.number(),
      category: field.enum(["tools", "toys", "books"])
    });
    const sqlite = await createSqliteDocumentStore(join(dir, "products.sqlite"));
    const records = scale(50000);
    const categories = ["tools", "toys", "books"];
    for (let i = 0; i < records; i++) {
      const id = `p${i}`;
      await sqlite.put("products", id, { id, name: `Product ${i}`, price: i % 997, category: categories[i % 3], createdAt: "t", updatedAt: "t" });
    }
    // The same store without query(): resource() falls back to list() + in-memory filtering.
    const { query: _sql, ...withoutQuery } = sqlite;
    const query = { where: { category: "toys" }, sort: "-price", search: "9", limit: 20, offset: 40 };
    const pages = scale(50);
    for (const [label, store] of [["in SQL", sqlite], ["in memory", withoutQuery]]) {
      const products = resource(Product, { store, searchable: ["name"] });
      await bench(`resource.list on ${records} SQLite rows (${label})`, pages, async () => {
        for (let i = 0; i < pages; i++) await products.list(query);
      });
    }

    // Orders of one customer: a selective filter on a ref field, which resource() indexes.
    const Order = model("orders", { customerId: field.ref("customers"), total: field.number() });
    for (let i = 0; i < records; i++) {
      const id = `o${i}`;
      await sqlite.put("orders", id, { id, customerId: `c${i % 1000}`, total: i % 500, createdAt: "t", updatedAt: "t" });
    }
    for (const [label, store] of [["in SQL, indexed", sqlite], ["in memory", withoutQuery]]) {
      const orders = resource(Order, { store });
      await bench(`orders of 1 customer, ${records} rows (${label})`, pages, async () => {
        for (let i = 0; i < pages; i++) await orders.list({ where: { customerId: `c${i}` }, sort: "-total", limit: 20 });
      });
    }
    await sqlite.close();
  } catch (error) {
    results.push({ benchmark: "resource.list (SQLite)", ops: 0, "total ms": 0, "ops/sec": `n/a (${error.message})` });
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

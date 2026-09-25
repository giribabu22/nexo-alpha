/**
 * Storage adapter tests: document-store-backed WorkflowStore / AgentMemory,
 * and concurrency safety of the file-backed stores.
 *
 * Build first:  pnpm --filter @nexo-alpha/agent build
 * Then run:     pnpm --filter @nexo-alpha/agent test
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { createInMemoryDocumentStore, createSqliteDocumentStore } from "@nexo-alpha/core";
import { createDecisionEngine, confirmationRule } from "@nexo-alpha/decision";

import {
  createAgent,
  createDocumentAgentMemory,
  createDocumentWorkflowStore,
  createFileAgentMemory,
  createFileWorkflowStore,
  createInMemoryAgentMemory,
  createStepIntentParser,
  createWorkflow
} from "../dist/index.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-agent-storage-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function state(id, overrides = {}) {
  return { id, workflowName: "w", goal: "g", step: 1, status: "RUNNING", history: [], context: {}, ...overrides };
}

test("FileWorkflowStore: concurrent saves are not lost", async () => {
  await withTempDir(async (dir) => {
    const store = createFileWorkflowStore(path.join(dir, "runs.json"));
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(state(`run-${i}`))));
    assert.equal((await store.list()).length, 20);
  });
});

test("AgentMemory (in-memory and file): concurrent remember() calls are not lost", async () => {
  await withTempDir(async (dir) => {
    for (const memory of [createInMemoryAgentMemory(), createFileAgentMemory(path.join(dir, "memory.json"))]) {
      await Promise.all(Array.from({ length: 20 }, (_, i) => memory.remember(`k${i}`, i)));
      assert.equal((await memory.recall()).length, 20);
    }
  });
});

test("DocumentWorkflowStore: save, load, filtered list, delete, and custom collection", async () => {
  const documents = createInMemoryDocumentStore();
  const store = createDocumentWorkflowStore(documents);

  await store.save(state("a", { status: "COMPLETED" }));
  await store.save(state("b", { workflowName: "other" }));

  assert.equal((await store.load("a")).status, "COMPLETED");
  assert.deepEqual((await store.list({ status: "COMPLETED" })).map((s) => s.id), ["a"]);
  assert.deepEqual((await store.list({ workflowName: "other" })).map((s) => s.id), ["b"]);
  assert.equal(await store.delete("a"), true);
  assert.equal(await store.load("a"), undefined);

  assert.equal((await documents.list("workflow_runs")).length, 1);
  await createDocumentWorkflowStore(documents, { collection: "runs_v2" }).save(state("c"));
  assert.equal((await documents.list("runs_v2")).length, 1);
});

test("DocumentAgentMemory: same behaviour as the other memories, one document per entry", async () => {
  const documents = createInMemoryDocumentStore();
  const memory = createDocumentAgentMemory(documents);

  const first = await memory.remember("refund-policy", "Refunds over 500 need approval", { tags: ["policy"], scope: "support" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await memory.remember("refund-policy", "Refunds over 1000 need approval", { tags: ["policy"], scope: "support" });
  assert.equal(second.createdAt, first.createdAt);

  await memory.remember("shipping", "Ships in two days", { tags: ["logistics"] });
  await Promise.all(Array.from({ length: 10 }, (_, i) => memory.remember(`bulk-${i}`, i)));

  assert.deepEqual((await memory.recall({ text: "refund approval" })).map((e) => e.key), ["refund-policy"]);
  assert.deepEqual((await memory.recall({ tags: ["logistics"] })).map((e) => e.key), ["shipping"]);
  assert.equal((await memory.get("refund-policy")).value, "Refunds over 1000 need approval");
  assert.equal(await memory.forget("shipping"), true);
  assert.equal(await memory.forget("shipping"), false);
  assert.equal((await documents.list("agent_memory")).length, 11);
});

test("SQLite: a paused workflow survives a 'restart' and resumes from a new connection", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  await withTempDir(async (dir) => {
    const dbPath = path.join(dir, "nexo.sqlite");

    function build(documents, requireConfirmation) {
      const engine = createDecisionEngine({ name: "sqlite-test" });
      if (requireConfirmation) {
        engine.addRule(confirmationRule({ actions: ["refund"], requires: () => true, question: "Refund?" }));
      }
      const agent = createAgent({ decisionEngine: engine });
      agent.tools.register({
        action: "refund",
        execute: async ({ extras }) => {
          await extras.memory.remember("last-refund", "order-9");
          return { success: true, data: { refunded: true }, durationMs: 1 };
        }
      });
      return createWorkflow({
        name: "refund",
        agent,
        parser: createStepIntentParser([{ action: "refund" }]),
        store: createDocumentWorkflowStore(documents),
        memory: createDocumentAgentMemory(documents)
      });
    }

    // Process 1: run until it pauses for confirmation, then shut down.
    const firstConnection = await createSqliteDocumentStore(dbPath);
    const paused = await build(firstConnection, true).run("Refund order 9");
    assert.equal(paused.status, "WAITING");
    await firstConnection.close();

    // Process 2: new connection, load the run by ID and resume it.
    const secondConnection = await createSqliteDocumentStore(dbPath);
    try {
      const workflow = build(secondConnection, false);
      const loaded = await workflow.load(paused.id);
      assert.equal(loaded.status, "WAITING");

      const finished = await workflow.resume(paused.id, { approved: true });
      assert.equal(finished.status, "COMPLETED");
      assert.equal((await workflow.store.load(paused.id)).status, "COMPLETED");
      assert.equal((await createDocumentAgentMemory(secondConnection).get("last-refund")).value, "order-9");
    } finally {
      await secondConnection.close();
    }
  });
});

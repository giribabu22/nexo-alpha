/**
 * Agent Memory tests
 *
 * Build first:  pnpm --filter @nexo-alpha/agent build
 * Then run:     pnpm --filter @nexo-alpha/agent test
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  createAgent,
  createWorkflow,
  createStepIntentParser,
  createInMemoryAgentMemory,
  createFileAgentMemory
} from "../dist/index.js";

import { createDecisionEngine } from "@nexo-alpha/decision";

test("AgentMemory: remember, get, forget", async () => {
  const memory = createInMemoryAgentMemory();

  const entry = await memory.remember("customer:42:preference", { refund: "cash" }, { tags: ["customer"], scope: "support" });
  assert.equal(entry.key, "customer:42:preference");
  assert.deepEqual(entry.tags, ["customer"]);
  assert.equal(entry.scope, "support");

  assert.deepEqual((await memory.get("customer:42:preference")).value, { refund: "cash" });
  assert.equal(await memory.forget("customer:42:preference"), true);
  assert.equal(await memory.forget("customer:42:preference"), false);
  assert.equal(await memory.get("customer:42:preference"), undefined);
});

test("AgentMemory: overwriting a key keeps createdAt and updates the value", async () => {
  const memory = createInMemoryAgentMemory();

  const first = await memory.remember("k", 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await memory.remember("k", 2);

  assert.equal(second.value, 2);
  assert.equal(second.createdAt, first.createdAt);
  assert.ok(second.updatedAt > first.updatedAt);
  assert.equal((await memory.recall()).length, 1);
});

test("AgentMemory: returned entries cannot mutate stored state", async () => {
  const memory = createInMemoryAgentMemory();
  const value = { list: [1] };

  await memory.remember("k", value);
  value.list.push(2);
  (await memory.get("k")).value.list.push(3);

  assert.deepEqual((await memory.get("k")).value, { list: [1] });
});

test("AgentMemory: recall filters by key, scope and all tags", async () => {
  const memory = createInMemoryAgentMemory();
  await memory.remember("a", 1, { tags: ["billing", "vip"], scope: "support" });
  await memory.remember("b", 2, { tags: ["billing"], scope: "support" });
  await memory.remember("c", 3, { tags: ["billing", "vip"], scope: "sales" });

  assert.deepEqual((await memory.recall({ key: "b" })).map((e) => e.key), ["b"]);
  assert.deepEqual((await memory.recall({ scope: "support", tags: ["vip"] })).map((e) => e.key), ["a"]);
  assert.equal((await memory.recall({ tags: ["billing"] })).length, 3);
});

test("AgentMemory: text recall ranks by matched words and respects limit", async () => {
  const memory = createInMemoryAgentMemory();
  await memory.remember("refund-policy", "Refunds over 500 need finance approval");
  await memory.remember("shipping", "Orders ship within two days");
  await memory.remember("refund-vip", "VIP customers get instant refund approval");

  const results = await memory.recall({ text: "refund approval for VIP" });
  assert.deepEqual(results.map((e) => e.key), ["refund-vip", "refund-policy"]);

  assert.equal((await memory.recall({ text: "refund", limit: 1 })).length, 1);
  assert.equal((await memory.recall({ text: "an of" })).length, 0);
});

test("AgentMemory (File): persists across instances", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-mem-test-"));
  const filePath = path.join(tmpDir, "nested", "memory.json");

  try {
    await createFileAgentMemory(filePath).remember("fact", { ok: true }, { tags: ["t"] });

    const reopened = createFileAgentMemory(filePath);
    assert.deepEqual((await reopened.get("fact")).value, { ok: true });
    assert.equal(await reopened.forget("fact"), true);
    assert.equal(await createFileAgentMemory(filePath).get("fact"), undefined);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("Workflow + AgentMemory: a fact remembered in one run is recalled by the next", async () => {
  const memory = createInMemoryAgentMemory();
  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "approve-all" }) });

  agent.tools.register({
    action: "learn_preference",
    execute: async ({ extras }) => {
      await extras.memory.remember("customer-42-refund", "prefers cash refund", { tags: ["customer"] });
      return { success: true, data: { learned: true }, durationMs: 1 };
    }
  });

  let seenContext;
  agent.tools.register({
    action: "use_preference",
    execute: async ({ extras }) => {
      seenContext = extras.workflowContext;
      return { success: true, data: { used: true }, durationMs: 1 };
    }
  });

  const first = createWorkflow({
    name: "learn",
    agent,
    memory,
    parser: createStepIntentParser([{ action: "learn_preference" }])
  });
  assert.equal((await first.run("Talk to customer 42")).status, "COMPLETED");

  const second = createWorkflow({
    name: "use",
    agent,
    memory,
    parser: createStepIntentParser([{ action: "use_preference" }])
  });
  const state = await second.run("Process refund for customer 42");

  assert.equal(state.status, "COMPLETED");
  assert.deepEqual(state.context.memory, { "customer-42-refund": "prefers cash refund" });
  assert.deepEqual(seenContext.memory, { "customer-42-refund": "prefers cash refund" });
});

test("Workflow + AgentMemory: custom recallMemory and initialContext precedence", async () => {
  const memory = createInMemoryAgentMemory();
  await memory.remember("unrelated", "nothing to do with the goal", { tags: ["always"] });

  const agent = createAgent({ decisionEngine: createDecisionEngine({ name: "approve-all" }) });
  const parser = createStepIntentParser([]);

  const byTag = createWorkflow({ name: "tag", agent, memory, parser, recallMemory: () => ({ tags: ["always"] }) });
  assert.deepEqual((await byTag.run("Goal")).context.memory, { unrelated: "nothing to do with the goal" });

  const defaultQuery = createWorkflow({ name: "default", agent, memory, parser });
  assert.equal("memory" in (await defaultQuery.run("Ship parcels")).context, false);

  const overridden = await byTag.run("Goal", { initialContext: { memory: { mine: true } } });
  assert.deepEqual(overridden.context.memory, { mine: true });
});

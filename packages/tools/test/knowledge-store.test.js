import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isGraphStale, loadKnowledgeGraph, saveKnowledgeGraph } from "../dist/index.js";

const sampleGraph = { nodes: [{ id: "module:shop", kind: "module", name: "shop" }], edges: [] };

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-knowledge-store-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("saveKnowledgeGraph writes a file (creating parent directories) and loadKnowledgeGraph reads it back", async () => {
  await withTempDir(async (dir) => {
    const outPath = join(dir, "nested", "knowledge-graph.json");

    const stored = await saveKnowledgeGraph(outPath, sampleGraph, {
      structureHash: "abc123",
      sourceTreeHash: "def456"
    });

    assert.equal(stored.meta.structureHash, "abc123");
    assert.equal(stored.meta.sourceTreeHash, "def456");
    assert.equal(stored.meta.schemaVersion, 1);
    assert.deepEqual(stored.graph, sampleGraph);

    const loaded = await loadKnowledgeGraph(outPath);
    assert.deepEqual(loaded, stored);
  });
});

test("saveKnowledgeGraph omits sourceTreeHash entirely when not given", async () => {
  await withTempDir(async (dir) => {
    const outPath = join(dir, "knowledge-graph.json");
    const stored = await saveKnowledgeGraph(outPath, sampleGraph, { structureHash: "abc123" });

    assert.ok(!("sourceTreeHash" in stored.meta));
  });
});

test("loadKnowledgeGraph returns undefined for a missing file", async () => {
  await withTempDir(async (dir) => {
    const result = await loadKnowledgeGraph(join(dir, "does-not-exist.json"));
    assert.equal(result, undefined);
  });
});

test("loadKnowledgeGraph returns undefined for unparseable content", async () => {
  await withTempDir(async (dir) => {
    const outPath = join(dir, "broken.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outPath, "not json", "utf8");

    const result = await loadKnowledgeGraph(outPath);
    assert.equal(result, undefined);
  });
});

test("isGraphStale detects a mismatched structureHash or sourceTreeHash", () => {
  const meta = { structureHash: "abc", sourceTreeHash: "def", generatedAt: "2024-01-01T00:00:00.000Z", schemaVersion: 1 };

  assert.equal(isGraphStale(meta, "abc", "def"), false);
  assert.equal(isGraphStale(meta, "changed", "def"), true);
  assert.equal(isGraphStale(meta, "abc", "changed"), true);
  assert.equal(isGraphStale(meta, "abc", undefined), true);
});

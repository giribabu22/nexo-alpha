import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSummarizer } from "../dist/index.js";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-load-summarizer-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadSummarizer loads a named 'summarize' export", async () => {
  await withTempDir(async (dir) => {
    const modulePath = join(dir, "named.mjs");
    await writeFile(modulePath, "export function summarize(node) { return `s:${node.name}`; }\n", "utf8");

    const summarize = await loadSummarizer(modulePath);
    assert.equal(typeof summarize, "function");
    assert.equal(await summarize({ id: "x", kind: "module", name: "orders" }), "s:orders");
  });
});

test("loadSummarizer falls back to the default export when there's no named 'summarize'", async () => {
  await withTempDir(async (dir) => {
    const modulePath = join(dir, "default.mjs");
    await writeFile(modulePath, "export default function (node) { return `d:${node.name}`; }\n", "utf8");

    const summarize = await loadSummarizer(modulePath);
    assert.equal(await summarize({ id: "x", kind: "module", name: "orders" }), "d:orders");
  });
});

test("loadSummarizer throws a descriptive error when the module exports no function", async () => {
  await withTempDir(async (dir) => {
    const modulePath = join(dir, "broken.mjs");
    await writeFile(modulePath, "export const summarize = 42;\n", "utf8");

    await assert.rejects(
      loadSummarizer(modulePath),
      /does not export a summarizer function/
    );
  });
});

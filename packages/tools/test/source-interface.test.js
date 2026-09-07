import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createSourceInterface } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const sampleFixture = join(here, "fixtures", "source-sample");

test("describeSourceTree finds source files and ignores build output and non-source files", async () => {
  const source = createSourceInterface(sampleFixture);
  const tree = await source.describeSourceTree();

  const paths = tree.files.map((file) => file.path);

  assert.equal(tree.fileCount, 2);
  assert.deepEqual(paths, ["nested/gadget.js", "widget.ts"]);
  assert.ok(!paths.some((path) => path.includes("build")));
  assert.ok(!paths.some((path) => path.endsWith(".md")));
});

test("describeSourceTree extracts named exports, aliased exports, and defaults", async () => {
  const source = createSourceInterface(sampleFixture);
  const tree = await source.describeSourceTree();

  const widget = tree.files.find((file) => file.path === "widget.ts");
  assert.deepEqual(widget.exports, [
    "DEFAULT_WIDGET_ID",
    "Widget",
    "createWidget",
    "helper"
  ]);

  const gadget = tree.files.find((file) => file.path === "nested/gadget.js");
  assert.deepEqual(gadget.exports, ["Gadget", "default"]);
});

test("sourceTreeHash is stable across identical scans and changes when a file's exports change", async () => {
  const source = createSourceInterface(sampleFixture);
  const treeA = await source.describeSourceTree();
  const treeB = await source.describeSourceTree();

  assert.equal(source.sourceTreeHash(treeA), source.sourceTreeHash(treeB));

  const mutated = {
    ...treeA,
    files: treeA.files.map((file) =>
      file.path === "widget.ts" ? { ...file, exports: [...file.exports, "extra"] } : file
    )
  };

  assert.notEqual(source.sourceTreeHash(treeA), source.sourceTreeHash(mutated));
});

test("describeSourceTree respects a custom extension filter", async () => {
  const source = createSourceInterface(sampleFixture, { extensions: [".js"] });
  const tree = await source.describeSourceTree();

  assert.deepEqual(tree.files.map((file) => file.path), ["nested/gadget.js"]);
});

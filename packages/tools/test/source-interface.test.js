import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createSourceInterface } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const sampleFixture = join(here, "..", "fixtures", "source-sample");

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

test("describeSourceTree extracts raw import specifiers per file, relative and bare alike", async () => {
  const source = createSourceInterface(sampleFixture);
  const tree = await source.describeSourceTree();

  const widget = tree.files.find((file) => file.path === "widget.ts");
  assert.deepEqual(widget.imports, ["./nested/gadget.js", "node:fs/promises"]);

  const gadget = tree.files.find((file) => file.path === "nested/gadget.js");
  assert.deepEqual(gadget.imports, ["../widget.js"]);
});

test("describeSourceTree resolves relative imports to real files, even across a .js-specifier/.ts-file mismatch", async () => {
  const source = createSourceInterface(sampleFixture);
  const tree = await source.describeSourceTree();

  assert.deepEqual(tree.importEdges, [
    { from: "nested/gadget.js", to: "widget.ts" },
    { from: "widget.ts", to: "nested/gadget.js" }
  ]);
});

test("describeSourceTree never turns a bare package specifier into an import edge", async () => {
  const source = createSourceInterface(sampleFixture);
  const tree = await source.describeSourceTree();

  assert.ok(
    !tree.importEdges.some((edge) => edge.to.includes("node:fs")),
    "node:fs/promises should stay out of importEdges"
  );
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

test("sourceTreeHash changes when importEdges change, independent of files", async () => {
  const source = createSourceInterface(sampleFixture);
  const tree = await source.describeSourceTree();

  const withoutEdges = { ...tree, importEdges: [] };

  assert.notEqual(source.sourceTreeHash(tree), source.sourceTreeHash(withoutEdges));
});

test("describeSourceTree respects a custom extension filter", async () => {
  const source = createSourceInterface(sampleFixture, { extensions: [".js"] });
  const tree = await source.describeSourceTree();

  assert.deepEqual(tree.files.map((file) => file.path), ["nested/gadget.js"]);
});

const graphFixture = join(here, "..", "fixtures", "graph-sample");

test("describeSourceTree extracts top-level symbols with kind/exported/line", async () => {
  const source = createSourceInterface(graphFixture);
  const tree = await source.describeSourceTree();

  const service = tree.files.find((file) => file.path === "service.ts");
  assert.deepEqual(
    service.symbols.map((symbol) => ({ name: symbol.name, kind: symbol.kind, exported: symbol.exported })),
    [
      { name: "formatName", kind: "function", exported: true },
      { name: "greet", kind: "function", exported: true }
    ]
  );
  assert.equal(service.symbols[0].line, 1);
  assert.equal(service.symbols[1].line, 5);
});

test("describeSourceTree resolves a same-file call to a top-level symbol", async () => {
  const source = createSourceInterface(graphFixture);
  const tree = await source.describeSourceTree();

  assert.ok(
    tree.callEdges.some(
      (edge) =>
        edge.from.file === "service.ts" &&
        edge.from.symbol === "greet" &&
        edge.to?.file === "service.ts" &&
        edge.to?.symbol === "formatName"
    ),
    "expected a service.ts#greet -> service.ts#formatName call edge"
  );
});

test("describeSourceTree resolves a call through an imported binding to the exporting file", async () => {
  const source = createSourceInterface(graphFixture);
  const tree = await source.describeSourceTree();

  assert.ok(
    tree.callEdges.some(
      (edge) =>
        edge.from.file === "index.ts" &&
        edge.from.symbol === "run" &&
        edge.to?.file === "service.ts" &&
        edge.to?.symbol === "greet"
    ),
    "expected an index.ts#run -> service.ts#greet call edge"
  );
});

test("describeSourceTree records a call to a bare-package import as external, not a graph edge to nowhere", async () => {
  const source = createSourceInterface(graphFixture);
  const tree = await source.describeSourceTree();

  const edge = tree.callEdges.find((edge) => edge.from.file === "index.ts" && edge.from.symbol === "run" && edge.toExternal !== undefined);
  assert.ok(edge, "expected an external call edge from index.ts#run");
  assert.equal(edge.toExternal, "node:crypto");
  assert.equal(edge.to, undefined);
});

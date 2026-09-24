import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";
import {
  context,
  freshness,
  graph,
  health,
  impact,
  inspect,
  intents,
  knowledge,
  search,
  status,
  trace,
  validate
} from "../dist/commands.js";

const here = dirname(fileURLToPath(import.meta.url));

function buildFixture() {
  const app = createApplication({ name: "shop", version: "0.1.0" });

  app.module({ name: "orders" });
  app.module({
    name: "payments",
    purpose: "Handle customer payments",
    dependencies: ["orders"]
  });

  const knowledge = createKnowledge();
  knowledge.setDevelopmentState({ currentObjective: "Implement payment recovery" });

  return { app, knowledge };
}

test("inspect with no module name renders the application summary", () => {
  const { app, knowledge } = buildFixture();
  const output = inspect(app, knowledge);

  assert.match(output, /Nexo Application/);
  assert.match(output, /orders/);
  assert.match(output, /payments/);
});

test("inspect with a valid module name renders module detail", () => {
  const { app, knowledge } = buildFixture();
  const output = inspect(app, knowledge, "payments");

  assert.match(output, /^payments/);
  assert.match(output, /Purpose: Handle customer payments/);
});

test("inspect with an unknown module name throws with suggestions", () => {
  const { app, knowledge } = buildFixture();
  assert.throws(
    () => inspect(app, knowledge, "missing"),
    /No module named "missing" found\. Did you mean one of: orders, payments\?/
  );
});

test("status renders the development state", () => {
  const { app, knowledge } = buildFixture();
  const output = status(app, knowledge);

  assert.match(output, /Nexo Development Status/);
  assert.match(output, /Implement payment recovery/);
});

test("context returns valid JSON matching the manifest", async () => {
  const { app, knowledge } = buildFixture();
  const output = await context(app, knowledge);
  const parsed = JSON.parse(output);

  assert.equal(parsed.application.name, "shop");
  assert.equal(parsed.modules.length, 2);
  assert.equal(parsed.sourceTree, undefined, "sourceTree should be omitted without a sourceRoot");
});

test("context folds in a source-tree scan when sourceRoot is given", async () => {
  const { app, knowledge } = buildFixture();
  const output = await context(app, knowledge, join(here, "..", "fixtures"));
  const parsed = JSON.parse(output);

  const appFile = parsed.sourceTree.files.find((file) => file.path === "app.js");
  assert.ok(appFile, "fixtures/app.js should be included in the scan");
  assert.ok(appFile.exports.includes("app"));
  assert.equal(typeof parsed.sourceTreeHash, "string");
});

test("knowledge returns the journal as a standalone JSON snapshot", () => {
  const { app, knowledge: journal } = buildFixture();
  journal.addDecision({ title: "Use Redis", status: "accepted" });

  const output = knowledge(app, journal);
  const parsed = JSON.parse(output);

  assert.equal(parsed.decisions.length, 1);
  assert.equal(parsed.decisions[0].title, "Use Redis");
  assert.ok(parsed.generatedAt, "generatedAt should be present");
  assert.equal(typeof parsed.schemaVersion, "number");
  assert.equal(parsed.structure.moduleCount, 2);
  assert.equal(typeof parsed.structureHash, "string");
});

test("knowledge throws a clear error when the app exports no knowledge journal", () => {
  const { app } = buildFixture();

  assert.throws(
    () => knowledge(app, undefined),
    /does not export a knowledge journal/
  );
});

test("intents with no filter lists every recorded intent", () => {
  const { app, knowledge: journal } = buildFixture();
  journal.addIntent({
    entityKind: "component",
    entityName: "CheckoutForm",
    purpose: "Collects payment details and submits a checkout."
  });
  journal.addIntent({
    entityKind: "module",
    entityName: "payments",
    purpose: "Handle customer payments end to end."
  });

  const parsed = JSON.parse(intents(app, journal));

  assert.equal(parsed.length, 2);
  assert.deepEqual(
    parsed.map((intent) => intent.entityName),
    ["CheckoutForm", "payments"]
  );
});

test("intents with entityKind/entityName filters to that one entity's most recent intent", () => {
  const { app, knowledge: journal } = buildFixture();
  journal.addIntent({ entityKind: "function", entityName: "processPayment", purpose: "First pass." });
  journal.addIntent({ entityKind: "function", entityName: "processPayment", purpose: "Revised." });

  const output = intents(app, journal, "function", "processPayment");
  assert.equal(JSON.parse(output).purpose, "Revised.");
});

test("intents returns null for an entity with no recorded intent", () => {
  const { app, knowledge: journal } = buildFixture();
  assert.equal(intents(app, journal, "component", "Missing"), "null");
});

test("intents returns an empty list when the app exports no knowledge journal", () => {
  const { app } = buildFixture();
  assert.deepEqual(JSON.parse(intents(app, undefined)), []);
});

test("validate renders validation results", () => {
  const { app } = buildFixture();
  const output = validate(app);

  assert.match(output, /Nexo Validation: PASSED/);
});

test("health renders application health metrics", () => {
  const { app } = buildFixture();
  const output = health(app);

  assert.match(output, /Nexo Application Health/);
  assert.match(output, /Modules: 2/);
  assert.match(output, /Architecture Valid: YES/);
});

test("search finds nodes by keyword over the registry alone", async () => {
  const { app, knowledge: journal } = buildFixture();
  const results = JSON.parse(await search(app, journal, "payments"));

  assert.ok(results.some((node) => node.id === "module:payments"));
});

test("trace defaults to dependents and narrows to callers with the direction argument", async () => {
  const { app, knowledge: journal } = buildFixture();

  const dependents = JSON.parse(await trace(app, journal, "module:orders"));
  assert.ok(dependents.some((edge) => edge.from === "module:payments" && edge.kind === "depends_on"));

  const callers = JSON.parse(await trace(app, journal, "module:orders", undefined, "callers"));
  assert.deepEqual(callers, []);
});

test("impact walks the transitive dependents of a node and respects direction/maxDepth/edgeKinds", async () => {
  const { app, knowledge: journal } = buildFixture();

  const dependents = JSON.parse(await impact(app, journal, "module:orders"));
  assert.equal(dependents.direction, "dependents");
  assert.ok(dependents.reached.some((hit) => hit.nodeId === "module:payments" && hit.depth === 1));

  const dependencies = JSON.parse(await impact(app, journal, "module:payments", undefined, "dependencies"));
  assert.equal(dependencies.direction, "dependencies");
  assert.ok(dependencies.reached.some((hit) => hit.nodeId === "module:orders"));

  const capped = JSON.parse(
    await impact(app, journal, "module:orders", undefined, "dependents", undefined, ["exposes"])
  );
  assert.deepEqual(capped.reached, []);
});

test("graph builds and persists a knowledge graph, then reports up to date on an unchanged rebuild", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-cli-graph-"));
  try {
    const { app, knowledge: journal } = buildFixture();
    const outPath = join(dir, "knowledge-graph.json");

    const first = JSON.parse(await graph(app, journal, outPath));
    assert.ok(first.graph.nodes.some((node) => node.id === "module:payments"));
    assert.equal(typeof first.meta.structureHash, "string");

    const second = await graph(app, journal, outPath);
    assert.match(second, /up to date/);

    const forced = JSON.parse(await graph(app, journal, outPath, undefined, true));
    assert.equal(forced.meta.structureHash, first.meta.structureHash);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("graph caches summaries for unchanged nodes, re-summarizes changed ones, and clears the cache under --force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-cli-graph-summarize-"));
  try {
    const { app, knowledge: journal } = buildFixture();
    const outPath = join(dir, "knowledge-graph.json");

    let calls = 0;
    const summarize = (node) => {
      calls += 1;
      return `summary of ${node.name}`;
    };

    const first = JSON.parse(await graph(app, journal, outPath, undefined, false, summarize));
    const nodeCount = first.graph.nodes.length;
    assert.equal(calls, nodeCount, "every node should be summarized on the first build");
    assert.ok(first.graph.nodes.every((node) => typeof node.summary === "string" && typeof node.summaryHash === "string"));

    // A non-force rebuild with nothing changed at all hits the whole-graph
    // "up to date" short-circuit before buildKnowledgeGraph even runs, so
    // register a second app to make the structure genuinely stale first.
    const { app: appB, knowledge: journalB } = buildFixture();
    appB.module({ name: "shipping" });

    calls = 0;
    const second = JSON.parse(await graph(appB, journalB, outPath, undefined, false, summarize));
    assert.equal(calls, 1, "only the newly added module's node should be summarized");
    const orders = second.graph.nodes.find((node) => node.id === "module:orders");
    assert.equal(orders.summary, "summary of orders", "unchanged node should keep its cached summary");
    const shipping = second.graph.nodes.find((node) => node.id === "module:shipping");
    assert.equal(shipping.summary, "summary of shipping");

    calls = 0;
    const forced = JSON.parse(await graph(appB, journalB, outPath, undefined, true, summarize));
    assert.equal(calls, forced.graph.nodes.length, "--force should clear the summary cache and re-summarize every node");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freshness reports added/changed/removed files since the graph was last built", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-cli-freshness-"));
  try {
    const srcDir = join(dir, "src");
    await mkdir(srcDir, { recursive: true });

    await writeFile(join(srcDir, "a.ts"), "export function run() {}\n", "utf8");
    await writeFile(join(srcDir, "b.ts"), "export function helper() {}\n", "utf8");

    const { app, knowledge: journal } = buildFixture();
    const outPath = join(dir, "knowledge-graph.json");

    await graph(app, journal, outPath, srcDir);

    const unchanged = JSON.parse(await freshness(outPath, srcDir));
    assert.deepEqual(unchanged.added, []);
    assert.deepEqual(unchanged.changed, []);
    assert.deepEqual(unchanged.removed, []);

    await writeFile(join(srcDir, "a.ts"), "export function run() {}\nexport function extra() {}\n", "utf8");
    await rm(join(srcDir, "b.ts"));
    await writeFile(join(srcDir, "c.ts"), "export function newThing() {}\n", "utf8");

    const diff = JSON.parse(await freshness(outPath, srcDir));
    assert.deepEqual(diff.added, ["c.ts"]);
    assert.deepEqual(diff.changed, ["a.ts"]);
    assert.deepEqual(diff.removed, ["b.ts"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freshness throws a clear error when no graph has been saved yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-cli-freshness-missing-"));
  try {
    await assert.rejects(
      freshness(join(dir, "knowledge-graph.json"), dir),
      /No knowledge graph found at .*\. Run "nexo graph" first\./
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


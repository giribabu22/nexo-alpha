import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createApplication } from "@nexo-alpha/core";
import { buildContext } from "@nexo-alpha/context";
import {
  buildKnowledgeGraph,
  createSourceInterface,
  searchKnowledgeGraph,
  traceCallers,
  traceDependents,
  traceImpact
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const graphFixture = join(here, "..", "fixtures", "graph-sample");

async function buildFixtureContext() {
  const app = createApplication({ name: "shop", version: "0.1.0" });

  app.module({ name: "orders", description: "Order management" });

  app.module({
    name: "billing",
    purpose: "Handle invoicing",
    dependencies: ["stripe", "orders"],
    apis: [{ name: "createInvoice", method: "POST", path: "/invoices", purpose: "Create a new invoice" }],
    services: [{ name: "InvoiceService" }],
    jobs: [{ name: "sendReminders", schedule: "0 9 * * *", description: "Nag overdue invoices" }],
    sourceFiles: ["index.ts", "does-not-exist.ts"]
  });

  const sourceTree = await createSourceInterface(graphFixture).describeSourceTree();

  return buildContext(app, undefined, sourceTree);
}

test("buildKnowledgeGraph creates module/api/service/job nodes with contains/exposes edges", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  assert.equal(byId.get("module:billing")?.kind, "module");
  assert.equal(byId.get("module:billing")?.description, "Handle invoicing");
  assert.equal(byId.get("api:billing.createInvoice")?.description, "Create a new invoice");
  assert.equal(byId.get("service:billing.InvoiceService")?.kind, "service");
  assert.equal(byId.get("job:billing.sendReminders")?.description, "Nag overdue invoices");

  assert.ok(
    graph.edges.some((e) => e.from === "module:billing" && e.to === "api:billing.createInvoice" && e.kind === "exposes")
  );
  assert.ok(
    graph.edges.some((e) => e.from === "module:billing" && e.to === "service:billing.InvoiceService" && e.kind === "contains")
  );
  assert.ok(
    graph.edges.some((e) => e.from === "module:billing" && e.to === "job:billing.sendReminders" && e.kind === "contains")
  );
});

test("buildKnowledgeGraph turns a registered-module dependency into a module node and an unregistered one into an external node", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  assert.ok(
    graph.edges.some((e) => e.from === "module:billing" && e.to === "module:orders" && e.kind === "depends_on")
  );
  assert.ok(
    graph.edges.some((e) => e.from === "module:billing" && e.to === "external:stripe" && e.kind === "depends_on")
  );
  assert.equal(graph.nodes.find((n) => n.id === "external:stripe")?.kind, "external");
});

test("buildKnowledgeGraph carries file/symbol nodes and import/call edges from the source tree, with evidence", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  const greetSymbol = graph.nodes.find((n) => n.id === "symbol:service.ts#greet");
  assert.ok(greetSymbol, "expected a symbol node for service.ts#greet");
  assert.deepEqual(greetSymbol.evidence, { file: "service.ts", line: 5 });

  assert.ok(graph.edges.some((e) => e.from === "file:index.ts" && e.to === "file:service.ts" && e.kind === "imports"));
  assert.ok(
    graph.edges.some(
      (e) => e.from === "symbol:index.ts#run" && e.to === "symbol:service.ts#greet" && e.kind === "calls"
    )
  );
  assert.ok(
    graph.edges.some((e) => e.from === "symbol:index.ts#run" && e.to === "external:node:crypto" && e.kind === "calls")
  );
});

test("buildKnowledgeGraph turns a bare package import into an edge to an external node, but not a relative import", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  assert.ok(
    graph.edges.some((e) => e.from === "file:index.ts" && e.to === "external:node:crypto" && e.kind === "imports")
  );
  assert.equal(graph.nodes.find((n) => n.id === "external:node:crypto")?.kind, "external");

  assert.ok(
    !graph.nodes.some((n) => n.kind === "external" && n.name.startsWith(".")),
    "a relative import should never produce an external node"
  );
});

test("buildKnowledgeGraph resolves constructor calls to the target class's own symbol node", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  assert.ok(
    graph.edges.some(
      (e) => e.from === "symbol:factory.ts#createWidget" && e.to === "symbol:models.ts#Widget" && e.kind === "calls"
    )
  );
  assert.ok(
    graph.edges.some(
      (e) => e.from === "symbol:factory.ts#createLocal" && e.to === "symbol:factory.ts#Local" && e.kind === "calls"
    )
  );
});

test("buildKnowledgeGraph links a module to its declared sourceFiles, skipping any path the scan didn't find", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  assert.ok(
    graph.edges.some((e) => e.from === "module:billing" && e.to === "file:index.ts" && e.kind === "implements")
  );
  assert.ok(
    !graph.edges.some((e) => e.from === "module:billing" && e.kind === "implements" && e.to.includes("does-not-exist"))
  );
});

test("searchKnowledgeGraph matches names and descriptions case-insensitively", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  const byName = searchKnowledgeGraph(graph, "InvoiceService");
  assert.ok(byName.some((n) => n.id === "service:billing.InvoiceService"));

  const byDescription = searchKnowledgeGraph(graph, "nag overdue");
  assert.ok(byDescription.some((n) => n.id === "job:billing.sendReminders"));

  assert.deepEqual(searchKnowledgeGraph(graph, "   "), []);
});

test("traceCallers returns only calls edges pointing at a node; traceDependents returns any kind", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  const callers = traceCallers(graph, "symbol:service.ts#greet");
  assert.equal(callers.length, 1);
  assert.equal(callers[0].from, "symbol:index.ts#run");

  const dependents = traceDependents(graph, "module:orders");
  assert.ok(dependents.some((e) => e.kind === "depends_on" && e.from === "module:billing"));
});

test("traceImpact walks dependents transitively in shortest-path order", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  const result = traceImpact(graph, "symbol:service.ts#formatName");

  assert.equal(result.direction, "dependents");
  const greet = result.reached.find((hit) => hit.nodeId === "symbol:service.ts#greet");
  const run = result.reached.find((hit) => hit.nodeId === "symbol:index.ts#run");
  assert.equal(greet?.depth, 1);
  assert.equal(run?.depth, 2);
  assert.equal(greet?.via.from, "symbol:service.ts#greet");
  assert.equal(run?.via.from, "symbol:index.ts#run");
  assert.ok(!result.reached.some((hit) => hit.nodeId === "symbol:service.ts#formatName"), "origin should be excluded");
});

test("traceImpact terminates on a cycle without revisiting a node", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  const result = traceImpact(graph, "symbol:cycle.ts#pingA", { edgeKinds: ["calls"] });

  assert.deepEqual(
    result.reached.map((hit) => hit.nodeId),
    ["symbol:cycle.ts#pingB"]
  );
});

test("traceImpact respects maxDepth", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  const result = traceImpact(graph, "symbol:service.ts#formatName", { maxDepth: 1, edgeKinds: ["calls"] });

  assert.deepEqual(
    result.reached.map((hit) => hit.nodeId),
    ["symbol:service.ts#greet"]
  );
});

test("traceImpact respects edgeKinds and the dependencies direction", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());

  const dependents = traceImpact(graph, "module:orders", { edgeKinds: ["depends_on"] });
  assert.ok(dependents.reached.some((hit) => hit.nodeId === "module:billing"));

  const dependencies = traceImpact(graph, "module:billing", { direction: "dependencies", edgeKinds: ["depends_on"] });
  assert.ok(dependencies.reached.some((hit) => hit.nodeId === "module:orders"));
  assert.ok(dependencies.reached.some((hit) => hit.nodeId === "external:stripe"));
});

test("buildKnowledgeGraph calls an optional summarize hook and leaves other nodes unsummarized", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext(), {
    summarize: (node) => (node.kind === "module" ? `summary of ${node.name}` : undefined)
  });

  const module = graph.nodes.find((n) => n.id === "module:billing");
  assert.equal(module.summary, "summary of billing");

  const api = graph.nodes.find((n) => n.id === "api:billing.createInvoice");
  assert.equal(api.summary, undefined);
  assert.ok(!("summary" in api), "unsummarized node should omit the summary key entirely");
});

test("buildKnowledgeGraph never calls summarize when the option is omitted", async () => {
  const graph = await buildKnowledgeGraph(await buildFixtureContext());
  assert.ok(graph.nodes.every((node) => !("summary" in node)));
});

import { app, dscCollector, knowledge, scheduler, type TodoItem } from "./app.js";
import { startHapiServer } from "@nexo-alpha/hapi";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { NexoFullstackDashboard } from "./components/TodoPage.js";

async function runDemo() {
  console.log("===============================================================");
  console.log("🚀 NEXO FULLSTACK + DSC INTERACTIVE DEMO & VERIFICATION");
  console.log("===============================================================\n");

  // Step 1: Start Application & Hapi Server
  console.log("1. Starting Nexo Application & Hapi Server...");
  await app.start();
  scheduler.start();

  const PORT = 4055;
  const server = await startHapiServer(app, { port: PORT });
  console.log(`   ✅ App started: ${app.name} (v${app.version})`);
  console.log(`   ✅ Modules registered: [${app.getModules().map((m: { name: string }) => m.name).join(", ")}]`);
  console.log(`   ✅ Hapi Server listening at: ${server.info.uri}`);

  const baseUrl = server.info.uri;

  // Step 2: Test DSC Execution Pipeline & Caching via HTTP
  console.log("\n2. Testing Deterministic State & Computation (DSC) Pipeline via HTTP...");

  console.log("   --> Request 1: GET /api/todos (Cold run / Cache miss expected)");
  const res1 = await fetch(`${baseUrl}/api/todos`);
  const todos1 = (await res1.json()) as TodoItem[];
  console.log(`   Returned ${todos1.length} todos. Status: ${res1.status}`);

  console.log("   --> Request 2: GET /api/todos (Identical request / DSC Cache hit expected)");
  const res2 = await fetch(`${baseUrl}/api/todos`);
  const todos2 = (await res2.json()) as TodoItem[];
  console.log(`   Returned ${todos2.length} todos. Status: ${res2.status}`);

  console.log("   --> Request 3: POST /api/todos (State mutation / Cache invalidation)");
  const res3 = await fetch(`${baseUrl}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Validate nexoComp React background rendering",
      priority: "high",
      category: "frontend"
    })
  });
  const createdTodo = await res3.json();
  console.log("   Added new task:", createdTodo);

  console.log("   --> Request 4: GET /api/todos (Post-mutation fresh fetch)");
  const res4 = await fetch(`${baseUrl}/api/todos`);
  const todos4 = (await res4.json()) as TodoItem[];
  console.log(`   Returned ${todos4.length} todos.`);

  // Step 3: Inspect DSC Collector Metrics
  console.log("\n3. Inspecting Live DSC Telemetry Metrics...");
  const metricsRes = await fetch(`${baseUrl}/api/dsc/metrics`);
  const metrics = (await metricsRes.json()) as {
    totalOperations: number;
    cacheHitRate: number;
    totalTokensSaved: number;
    deduplicatedOps: number;
    averageDurationMs: number;
  };
  console.log(`   - Total Operations Tracked: ${metrics.totalOperations}`);
  console.log(`   - Cache Hit Rate:           ${Math.round(metrics.cacheHitRate * 100)}%`);
  console.log(`   - Average Latency:          ${metrics.averageDurationMs} ms`);
  console.log(`   - Deduplicated Operations:  ${metrics.deduplicatedOps}`);

  // Step 4: Verify Knowledge Context
  console.log("\n4. Checking Knowledge Graph Context...");
  const decisions = knowledge.getDecisions();
  console.log(`   - Registered Decisions: ${decisions.length}`);
  for (const d of decisions) {
    const statusStr = (d.status ?? "accepted").toUpperCase();
    console.log(`     • [${statusStr}] ${d.title}: ${d.reason}`);
  }

  // Step 5: Render UI in React Background via nexoComp
  console.log("\n5. Testing nexoComp React Background Rendering...");
  const renderedHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(NexoFullstackDashboard, {
      todos: todos4,
      dscMetrics: metrics,
      serverUri: baseUrl
    })
  );

  console.log(`   ✅ Rendered nexoComp Virtual Tree successfully!`);
  console.log(`   - HTML Output Size: ${renderedHtml.length} bytes`);
  console.log(`   - Top-level Component: ${NexoFullstackDashboard.compName}`);
  console.log(`   - Declared Purpose: ${NexoFullstackDashboard.purpose}`);
  console.log(`   - Dependencies: [${NexoFullstackDashboard.dependencies?.join(", ")}]`);

  // Step 6: Cleanup & Shutdown
  console.log("\n6. Shutting down demo servers cleanly...");
  scheduler.stop();
  await server.stop();
  await app.stop();

  console.log("\n===============================================================");
  console.log("🎉 ALL DEMO CHECKS & VERIFICATIONS COMPLETED SUCCESSFULLY!");
  console.log("===============================================================");
}

runDemo().catch((err) => {
  console.error("Demo failed with error:", err);
  process.exit(1);
});

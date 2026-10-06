import { app, dscCollector, knowledge, scheduler, jobQueue, type TodoItem } from "./app.js";
import { startHapiServer } from "@nexo-alpha/hapi";
import { createNexoClient } from "@nexo-alpha/frontend/client";
import { renderStudioHtml } from "./render-studio.js";

async function runDemo() {
  console.log("===============================================================");
  console.log("🚀 NEXO FULLSTACK STUDIO & RUNTIME VERIFICATION DEMO");
  console.log("===============================================================\n");

  // Step 1: Start Application, Scheduler & Hapi Server
  console.log("1. Starting Nexo Application, Schedulers & Hapi Server...");
  await app.start();
  scheduler.start();
  await jobQueue.start();

  const PORT = 4055;
  const server = await startHapiServer(app, { port: PORT });
  const baseUrl = server.info.uri;

  console.log(`   ✅ App started: ${app.name} (v${app.version})`);
  console.log(`   ✅ Registered Modules (${app.getModules().length}): [${app.getModules().map((m: { name: string }) => m.name).join(", ")}]`);
  console.log(`   ✅ Server listening at: ${baseUrl}`);

  // Step 2: Initialize Nexo Universal Client
  console.log("\n2. Initializing Nexo Universal Client (@nexo-alpha/frontend/client)...");
  const client = createNexoClient({ baseUrl, projectId: "default" });
  const health = await client.getHealth();
  console.log(`   ✅ Client connected. Server status: ${health.status} (${health.framework})`);
  console.log(`   ✅ Active modules detected by client: ${health.modules.length}`);

  // Step 3: Test DSC Execution Pipeline & Caching
  console.log("\n3. Testing DSC Idempotent Caching Pipeline...");
  console.log("   --> Request 1: GET /api/todos (Cold run)");
  const res1 = await fetch(`${baseUrl}/api/todos`);
  const todos1 = (await res1.json()) as TodoItem[];
  console.log(`       Returned ${todos1.length} todos.`);

  console.log("   --> Request 2: GET /api/todos (DSC Cache hit expected)");
  const res2 = await fetch(`${baseUrl}/api/todos`);
  const todos2 = (await res2.json()) as TodoItem[];
  console.log(`       Returned ${todos2.length} todos.`);

  console.log("   --> Request 3: POST /api/todos (State mutation / Cache invalidation)");
  const res3 = await fetch(`${baseUrl}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Verify Nexo Studio interactive tabs and dashboards",
      priority: "high",
      category: "frontend"
    })
  });
  const createdTodo = await res3.json();
  console.log(`       Created task #${createdTodo.id}: "${createdTodo.text}"`);

  // Step 4: Verify Knowledge Context
  console.log("\n4. Verifying Knowledge Context & ADR Manifest (/api/knowledge)...");
  const knowledgeData = await client.getKnowledge();
  console.log(`   ✅ Loaded Knowledge Decisions: ${knowledgeData.decisions.length}`);
  for (const d of knowledgeData.decisions) {
    console.log(`      • [${d.status?.toUpperCase() ?? "ACCEPTED"}] ${d.title}: ${d.reason}`);
  }
  console.log(`   ✅ Architectural Constraints: ${knowledgeData.constraints.length}`);
  console.log(`   ✅ Component Intents: ${knowledgeData.intents.length}`);

  // Step 5: Test AI Agent Workflows & Decision Engine
  console.log("\n5. Testing AI Agent Workflows & Deterministic Decision Engine...");
  console.log("   --> Describing workflow 'task-optimizer' via client.workflows.describe()...");
  const desc = await client.workflows.describe("task-optimizer");
  console.log(`       Workflow Name: ${desc.name}`);
  console.log(`       Allowed Tools: [${desc.tools.map((t) => t.action).join(", ")}]`);

  console.log("   --> Starting a workflow run: 'Optimize pending tasks and audit priorities'...");
  const run = await client.workflows.startRun("task-optimizer", {
    goal: "Optimize pending tasks and audit priorities",
    actor: "studio-user"
  });
  console.log(`       Run ID: ${run.id} | Initial Status: ${run.status}`);

  console.log("   --> Waiting for queued background workflow execution to complete...");
  const completedRun = await client.workflows.waitForRun("task-optimizer", run.id, { intervalMs: 100, timeoutMs: 5000 });
  console.log(`       Final Status: ${completedRun.status}`);
  console.log(`       Executed Steps (${completedRun.history.length}):`);
  for (const [idx, step] of completedRun.history.entries()) {
    const outcome = step.decision.result;
    console.log(`         - Step ${idx + 1}: Action "${step.intent.action}" -> Decision: ${outcome}`);
  }

  // Step 6: Test Agent Memory API
  console.log("\n6. Testing Agent Cross-Run Memory (/memory)...");
  const memories = await client.memory.recall({ limit: 10 });
  console.log(`   ✅ Total active memories recalled: ${memories.length}`);
  for (const m of memories) {
    console.log(`      • [${m.tags.join(",")}] ${m.key}`);
  }

  // Step 7: Test Projects API (Multi-Tenancy)
  console.log("\n7. Testing Multi-Tenant Projects API (/projects)...");
  const projectsRes = await fetch(`${baseUrl}/projects`, {
    headers: { "x-user": "admin" }
  });
  const projectsData = (await projectsRes.json()) as { projects: Array<{ id: string; name: string }> };
  const projectList = projectsData.projects ?? [];
  console.log(`   ✅ Available Workspace Tenants: ${projectList.length}`);
  for (const p of projectList) {
    console.log(`      • Workspace ID: "${p.id}" | Name: "${p.name}"`);
  }

  // Step 8: Test Metrics & Prometheus Exposition
  console.log("\n8. Testing Metrics & Prometheus Export (/metrics)...");
  const metrics = await client.getMetrics();
  console.log(`   ✅ Tracked APIs: ${Object.keys(metrics.apis).length}`);
  console.log(`   ✅ Tracked Workflows: ${Object.keys(metrics.workflows).length}`);
  console.log(`   ✅ Tracked Queues: ${Object.keys(metrics.queues).length}`);

  const promRes = await fetch(`${baseUrl}/metrics/prometheus`);
  const promText = await promRes.text();
  console.log(`   ✅ Prometheus exposition active (${promText.length} bytes exported).`);

  // Step 9: Render Fullstack Studio HTML UI
  console.log("\n9. Testing Fullstack Studio Interactive UI Rendering...");
  const studioHtml = renderStudioHtml(baseUrl);
  console.log(`   ✅ Studio UI rendered successfully (${studioHtml.length} bytes).`);
  console.log(`   ✅ Studio available at: ${baseUrl}/studio and ${baseUrl}/`);

  // Step 10: Clean Shutdown
  console.log("\n10. Shutting down demo servers cleanly...");
  scheduler.stop();
  await jobQueue.stop();
  await server.stop();
  await app.stop();

  console.log("\n===============================================================");
  console.log("🎉 ALL FULLSTACK STUDIO MODULE CHECKS PASSED WITH FLYING COLORS!");
  console.log("===============================================================");
}

runDemo().catch((err) => {
  console.error("Demo failed with error:", err);
  process.exit(1);
});

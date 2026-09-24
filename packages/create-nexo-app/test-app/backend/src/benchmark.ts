import { app, dscCollector } from "./app.js";

async function runBenchmark(): Promise<void> {
  console.log("=================================================================");
  console.log("   NEXO RUNTIME: DSC BASELINE BENCHMARKING (PHASE 2)");
  console.log("=================================================================\n");

  const apis = app.getApis();
  const getHealthApi = apis.find((a) => a.name === "getHealth")!;
  const getKnowledgeApi = apis.find((a) => a.name === "getKnowledge")!;
  const getTodosApi = apis.find((a) => a.name === "getTodos")!;
  const addTodoApi = apis.find((a) => a.name === "addTodo")!;
  const toggleTodoApi = apis.find((a) => a.name === "toggleTodo")!;

  const dummyContext = {
    params: {},
    query: {},
    payload: {},
    headers: {}
  };

  dscCollector.clear();
  const overallStart = performance.now();

  console.log("► [1/4] Running 25 sequential read operations (/api/health)...");
  for (let i = 0; i < 25; i++) {
    await getHealthApi.handler!(dummyContext);
  }

  console.log("► [2/4] Running 25 sequential read operations (/api/knowledge)...");
  for (let i = 0; i < 25; i++) {
    await getKnowledgeApi.handler!(dummyContext);
  }

  console.log("► [3/4] Running 20 read operations (/api/todos)...");
  for (let i = 0; i < 20; i++) {
    await getTodosApi.handler!(dummyContext);
  }

  console.log("► [4/4] Running 10 state mutations (/api/todos add & toggle)...");
  for (let i = 1; i <= 5; i++) {
    await addTodoApi.handler!({
      ...dummyContext,
      payload: { text: `Benchmark Task #${i}` }
    });
    await toggleTodoApi.handler!({
      ...dummyContext,
      params: { id: String(i) }
    });
  }

  // Concurrent Burst Simulation (10 simultaneous getKnowledge calls)
  console.log("► Running concurrent burst simulation (10 parallel getKnowledge queries)...");
  await Promise.all([
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext),
    getKnowledgeApi.handler!(dummyContext)
  ]);

  const totalWallTime = Math.round((performance.now() - overallStart) * 100) / 100;
  const metrics = dscCollector.getMetrics();
  const records = dscCollector.getRecords();

  let totalPayloadBytes = 0;
  const opBreakdown: Record<string, { count: number; totalMs: number; totalBytes: number }> = {};

  for (const r of records) {
    totalPayloadBytes += r.payloadSizeBytes ?? 0;
    if (!opBreakdown[r.operationName]) {
      opBreakdown[r.operationName] = { count: 0, totalMs: 0, totalBytes: 0 };
    }
    const b = opBreakdown[r.operationName]!;
    b.count++;
    b.totalMs += r.durationMs;
    b.totalBytes += r.payloadSizeBytes ?? 0;
  }

  console.log("\n-----------------------------------------------------------------");
  console.log("             DSC BASELINE BENCHMARK REPORT (RAW DATA)            ");
  console.log("-----------------------------------------------------------------");
  console.log(`Total Operations Executed : ${metrics.totalOperations}`);
  console.log(`Total Wall Clock Time     : ${totalWallTime} ms`);
  console.log(`Total Handled Duration    : ${metrics.totalDurationMs} ms`);
  console.log(`Average Latency / Op      : ${metrics.averageDurationMs} ms`);
  console.log(`Total Data Processed      : ${(totalPayloadBytes / 1024).toFixed(2)} KB (${totalPayloadBytes} bytes)`);
  console.log(`Estimated Token Footprint : ~${Math.round(totalPayloadBytes / 4)} tokens (at ~4 chars/token)`);
  console.log(`Cache Hit Rate            : ${(metrics.cacheHitRate * 100).toFixed(1)}% (pre-optimization baseline)`);
  console.log("-----------------------------------------------------------------");
  console.log("Per-Operation Latency & Volume Breakdown:");
  console.log("-----------------------------------------------------------------");
  console.table(
    Object.entries(opBreakdown).map(([op, data]) => ({
      Operation: op,
      Calls: data.count,
      "Total (ms)": Math.round(data.totalMs * 100) / 100,
      "Avg (ms)": Math.round((data.totalMs / data.count) * 1000) / 1000,
      "Data (bytes)": data.totalBytes,
      "Est. Tokens": Math.round(data.totalBytes / 4)
    }))
  );

  console.log("-----------------------------------------------------------------");
  console.log("KEY BASELINE FINDINGS FOR PHASE 3 & 4 OPTIMIZATIONS:");
  console.log("-----------------------------------------------------------------");
  console.log("1. Duplicate Knowledge Queries: 35 calls to system.getKnowledge");
  console.log(`   transmitted ${(opBreakdown["system.getKnowledge"]?.totalBytes || 0)} bytes of virtually static ADR/invariant data.`);
  console.log("   -> Target: Delta compression & hash caching will eliminate >85% of this volume.");
  console.log("2. Duplicate Health Heartbeats: 25 calls to system.getHealth");
  console.log(`   transmitted ${(opBreakdown["system.getHealth"]?.totalBytes || 0)} bytes without caching.`);
  console.log("   -> Target: 1-second idempotent cache can eliminate redundant polling computations.");
  console.log("3. In-flight Duplication: 10 concurrent getKnowledge calls ran independently.");
  console.log("   -> Target: DSC Orchestrator in-flight deduplication will coalesce concurrent requests.");
  console.log("=================================================================\n");
}

runBenchmark().catch(console.error);

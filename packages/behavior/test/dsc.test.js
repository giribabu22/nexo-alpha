import test from "node:test";
import assert from "node:assert/strict";
import {
  createDscCollector,
  createDscInterceptor,
  createDscOrchestrator
} from "../dist/index.js";

test("DscCollector aggregates metrics across stages correctly", () => {
  const collector = createDscCollector();

  collector.record({
    operationId: "op-1",
    operationName: "test-query",
    stage: "plan",
    status: "success",
    durationMs: 5,
    promptTokens: 20
  });

  collector.record({
    operationId: "op-1",
    operationName: "test-query",
    stage: "execute",
    status: "cached",
    durationMs: 1,
    cacheHit: true,
    tokensSaved: 150
  });

  const metrics = collector.getMetrics();
  assert.equal(metrics.totalOperations, 2);
  assert.equal(metrics.totalDurationMs, 6);
  assert.equal(metrics.totalPromptTokens, 20);
  assert.equal(metrics.totalTokensSaved, 150);
  assert.equal(metrics.cacheHits, 1);
  assert.equal(metrics.cacheHitRate, 1);
  assert.equal(metrics.stageDurations.plan, 5);
  assert.equal(metrics.stageDurations.execute, 1);
});

test("DscInterceptor instruments functions transparently without altering output", async () => {
  const collector = createDscCollector();
  const interceptor = createDscInterceptor(collector);

  const rawFn = async (a, b) => {
    return { sum: a + b };
  };

  const instrumented = interceptor.instrument("addOperation", rawFn, {
    trackPayloadSize: true
  });

  const result = await instrumented(10, 25);
  assert.deepEqual(result, { sum: 35 });

  const records = collector.getRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].operationName, "addOperation");
  assert.equal(records[0].status, "success");
  assert.ok(records[0].payloadSizeBytes > 0);
});

test("DscOrchestrator executes 5-stage pipeline in exact order", async () => {
  const collector = createDscCollector();
  const orchestrator = createDscOrchestrator(collector);

  const stagesExecuted = [];

  const operation = {
    name: "userRegistration",
    plan: (ctx) => {
      stagesExecuted.push("plan");
      ctx.stageData.validated = true;
    },
    resolve: (ctx) => {
      stagesExecuted.push("resolve");
      ctx.stageData.userId = 42;
    },
    execute: async (ctx) => {
      stagesExecuted.push("execute");
      return { id: ctx.stageData.userId, name: ctx.input.name };
    },
    verify: (result) => {
      stagesExecuted.push("verify");
      return result.id === 42;
    },
    write: (result) => {
      stagesExecuted.push("write");
    }
  };

  const output = await orchestrator.run(operation, { name: "Alice" });
  assert.deepEqual(output, { id: 42, name: "Alice" });
  assert.deepEqual(stagesExecuted, ["plan", "resolve", "execute", "verify", "write"]);

  const metrics = collector.getMetrics();
  assert.equal(metrics.totalOperations, 5); // plan, resolve, execute, verify, write
});

test("DscOrchestrator supports early termination in plan stage", async () => {
  const collector = createDscCollector();
  const orchestrator = createDscOrchestrator(collector);

  let executeCalled = false;

  const operation = {
    name: "constantLookup",
    plan: (ctx) => {
      if (ctx.input.id === "zero") {
        return { skipExecution: true, earlyResult: 0 };
      }
      return {};
    },
    execute: async () => {
      executeCalled = true;
      return 100;
    }
  };

  const earlyResult = await orchestrator.run(operation, { id: "zero" });
  assert.equal(earlyResult, 0);
  assert.equal(executeCalled, false);

  const records = collector.getRecords();
  assert.equal(records[0].status, "early_terminated");
});

test("DscOrchestrator caches idempotent operations and returns cached result", async () => {
  const collector = createDscCollector();
  const orchestrator = createDscOrchestrator(collector);

  let executions = 0;

  const operation = {
    name: "expensiveMath",
    idempotent: true,
    execute: async (ctx) => {
      executions++;
      return ctx.input.x * 2;
    }
  };

  const res1 = await orchestrator.run(operation, { x: 21 });
  assert.equal(res1, 42);
  assert.equal(executions, 1);

  // Second identical run should hit cache
  const res2 = await orchestrator.run(operation, { x: 21 });
  assert.equal(res2, 42);
  assert.equal(executions, 1); // execute was NOT called again!

  const metrics = collector.getMetrics();
  assert.equal(metrics.cacheHits, 1);
});

test("DscOrchestrator deduplicates concurrent in-flight executions", async () => {
  const collector = createDscCollector();
  const orchestrator = createDscOrchestrator(collector);

  let executionCount = 0;

  const operation = {
    name: "slowQuery",
    idempotent: true,
    execute: async (ctx) => {
      executionCount++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return `result-${ctx.input.query}`;
    }
  };

  // Launch 3 concurrent requests with identical inputs
  const [r1, r2, r3] = await Promise.all([
    orchestrator.run(operation, { query: "alpha" }),
    orchestrator.run(operation, { query: "alpha" }),
    orchestrator.run(operation, { query: "alpha" })
  ]);

  assert.equal(r1, "result-alpha");
  assert.equal(r2, "result-alpha");
  assert.equal(r3, "result-alpha");
  assert.equal(executionCount, 1); // executed only once!

  const metrics = collector.getMetrics();
  assert.ok(metrics.deduplicatedOps >= 2);
});

test("DscOrchestrator throws and halts pipeline on verification failure", async () => {
  const collector = createDscCollector();
  const orchestrator = createDscOrchestrator(collector);

  let writeCalled = false;

  const operation = {
    name: "faultyMutation",
    execute: async () => ({ value: -1 }),
    verify: (result) => {
      if (result.value < 0) {
        return { valid: false, reason: "Value cannot be negative" };
      }
      return true;
    },
    write: () => {
      writeCalled = true;
    }
  };

  await assert.rejects(
    () => orchestrator.run(operation, {}),
    /\[DSC Verify Failed\] faultyMutation: Value cannot be negative/
  );

  assert.equal(writeCalled, false); // Write was prevented!
});

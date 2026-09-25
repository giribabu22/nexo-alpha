import test from "node:test";
import assert from "node:assert/strict";

import { createInMemoryDocumentStore } from "@nexo-alpha/core";
import { createDecisionEngine, permissionRule } from "@nexo-alpha/decision";

import { createAgent, createDocumentAuditTrail } from "../dist/index.js";
import { createToolStub } from "../dist/testing.js";

function agentWith(options = {}) {
  const engine = createDecisionEngine({ name: "audit" });
  engine.addRule(permissionRule({ actions: ["refund"], check: ({ intent }) => intent.actor === "admin" }));
  const agent = createAgent({ decisionEngine: engine, ...options });
  agent.tools.register(createToolStub("refund"));
  agent.tools.register(createToolStub("lookup"));
  return agent;
}

test("auditSink: receives approved and blocked records; the durable trail can be queried", async () => {
  const audit = createDocumentAuditTrail(createInMemoryDocumentStore());
  const agent = agentWith({ auditSink: audit.sink });

  await agent.execute({ action: "lookup", actor: "sam" });
  await agent.execute({ action: "refund", actor: "sam" });
  await agent.execute({ action: "refund", actor: "admin" });

  const all = await audit.query();
  assert.equal(all.length, 3);
  assert.ok(all[0].startedAt >= all[2].startedAt); // most recent first

  const blocked = await audit.query({ status: "BLOCKED" });
  assert.deepEqual(blocked.map((r) => [r.intent.actor, r.decision.result]), [["sam", "REJECT"]]);
  assert.equal((await audit.query({ actor: "admin", action: "refund" })).length, 1);
  assert.equal((await audit.query({ decision: "REJECT" })).length, 1);
  assert.equal((await audit.query({ limit: 2 })).length, 2);
  assert.equal((await audit.query({ since: "2999-01-01T00:00:00Z" })).length, 0);
  assert.equal((await audit.query({ until: "2000-01-01T00:00:00Z" })).length, 0);
});

test("auditSink: a failing sink never blocks execution", async () => {
  const agent = agentWith({ auditSink: () => { throw new Error("disk full"); } });
  const record = await agent.execute({ action: "lookup", actor: "sam" });
  assert.equal(record.status, "APPROVED_AND_COMPLETE");
  assert.equal(agent.auditLog.size, 1);
});

test("maxAuditEntries: the in-memory log keeps only the newest records", async () => {
  const agent = agentWith({ maxAuditEntries: 2 });
  for (const actor of ["a", "b", "c"]) await agent.execute({ action: "lookup", actor });
  assert.deepEqual(agent.auditLog.entries.map((r) => r.intent.actor), ["b", "c"]);
});

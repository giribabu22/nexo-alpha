/**
 * Tool permission (RBAC) tests
 *
 * Build first:  pnpm --filter @nexo-alpha/agent build
 * Then run:     pnpm --filter @nexo-alpha/agent test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "@nexo-alpha/core";
import { createHapiServer } from "@nexo-alpha/hapi";
import { createAccessControl, createDecisionEngine, confirmationRule } from "@nexo-alpha/decision";

import {
  createAgent,
  createWorkflow,
  createStepIntentParser,
  createWorkflowApiModule,
  toolPermissionRule
} from "../dist/index.js";

const access = createAccessControl([
  { name: "viewer", permissions: ["orders:read"] },
  { name: "support", permissions: ["orders:refund"], inherits: ["viewer"] }
]);

const USER_ROLES = { ann: ["viewer"], sam: ["support"] };

function buildAgent(ruleOptions = {}) {
  const engine = createDecisionEngine({ name: "tool-perms" });
  const agent = createAgent({ decisionEngine: engine });
  const calls = [];

  const tool = (action, permissions) => ({
    action,
    ...(permissions !== undefined ? { permissions } : {}),
    execute: async ({ intent }) => {
      calls.push({ action, actor: intent.actor });
      return { success: true, data: { action }, durationMs: 1 };
    }
  });

  agent.tools.register(tool("view_order", ["orders:read"]));
  agent.tools.register(tool("refund_order", ["orders:refund"]));
  agent.tools.register(tool("ping"));

  engine.addRule(toolPermissionRule({
    access,
    tools: agent.tools,
    resolveRoles: ({ intent }) => USER_ROLES[intent.actor] ?? [],
    ...ruleOptions
  }));

  return { agent, engine, calls };
}

test("ToolRegistry.get returns the registered tool, including declared permissions", () => {
  const { agent } = buildAgent();
  assert.deepEqual(agent.tools.get("refund_order").permissions, ["orders:refund"]);
  assert.equal(agent.tools.get("missing"), undefined);
});

test("toolPermissionRule: tool runs only when the actor's roles grant its declared permissions", async () => {
  const { agent, calls } = buildAgent();

  const allowed = await agent.execute({ action: "refund_order", actor: "sam" });
  assert.equal(allowed.status, "APPROVED_AND_COMPLETE");

  const denied = await agent.execute({ action: "refund_order", actor: "ann" });
  assert.equal(denied.status, "BLOCKED");
  assert.equal(denied.decision.code, "PERMISSION_DENIED");
  assert.equal(denied.decision.rule, "tool-permissions");

  assert.deepEqual(calls, [{ action: "refund_order", actor: "sam" }]);
});

test("toolPermissionRule: undeclared tools pass unless denyUndeclared is set", async () => {
  assert.equal((await buildAgent().agent.execute({ action: "ping", actor: "ann" })).status, "APPROVED_AND_COMPLETE");

  const strict = await buildAgent({ denyUndeclared: true }).agent.execute({ action: "ping", actor: "sam" });
  assert.equal(strict.status, "BLOCKED");
});

test("Workflow: an explicit run actor cannot be overridden by a parsed intent's actor", async () => {
  const { agent, calls } = buildAgent();

  const workflow = createWorkflow({
    name: "impersonation",
    agent,
    // The parser (e.g. LLM output) claims the privileged actor.
    parser: createStepIntentParser([{ action: "refund_order", actor: "sam" }])
  });

  const state = await workflow.run("Refund order 1", { actor: "ann" });
  assert.equal(state.status, "FAILED");
  assert.match(state.error, /PERMISSION_DENIED|lacks permission/);
  assert.equal(calls.length, 0);

  // Without an explicit actor the parsed actor still applies (backwards compatible).
  const legacy = await workflow.run("Refund order 1");
  assert.equal(legacy.status, "COMPLETED");
  assert.deepEqual(calls, [{ action: "refund_order", actor: "sam" }]);
});

test("Workflow API: resolveActor drives RBAC for both start and resume", async () => {
  const { agent, engine, calls } = buildAgent();
  engine.addRule(confirmationRule({ name: "confirm", actions: ["view_order"], requires: () => true, question: "Sure?" }));

  const app = createApplication({ name: "rbac-api" });
  app.module(createWorkflowApiModule({
    workflows: [
      createWorkflow({ name: "refund", agent, parser: createStepIntentParser([{ action: "refund_order" }]) }),
      createWorkflow({ name: "view", agent, parser: createStepIntentParser([{ action: "view_order" }]) })
    ],
    resolveActor: (context) => context.headers["x-user"]
  }));
  const server = await createHapiServer(app, { logging: false });

  const run = async (url, user, payload = {}) =>
    JSON.parse((await server.inject({ method: "POST", url, headers: { "x-user": user }, payload })).payload);

  assert.equal((await run("/workflows/refund/runs", "ann", { goal: "g", actor: "sam" })).status, "FAILED");
  assert.equal((await run("/workflows/refund/runs", "sam", { goal: "g" })).status, "COMPLETED");

  // Resume is checked against the resuming user, not the one who started the run.
  const waiting = await run("/workflows/view/runs", "ann", { goal: "g" });
  assert.equal(waiting.status, "WAITING");
  engine.removeRule("confirm");
  const resumed = await run(`/workflows/view/runs/${waiting.id}/resume`, "nobody");
  assert.equal(resumed.status, "FAILED");
  assert.match(resumed.error, /lacks permission/);

  assert.deepEqual(calls, [{ action: "refund_order", actor: "sam" }]);
});

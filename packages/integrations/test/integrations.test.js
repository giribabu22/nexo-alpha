import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { createAccessControl } from "@nexo-alpha/decision";
import { installToolkit, toolPermissionRule } from "@nexo-alpha/agent";
import { createTestAgent, runSteps } from "@nexo-alpha/agent/testing";

import { createGitHubToolkit, createSlackToolkit } from "../dist/index.js";

/** A local stand-in for api.github.com / hooks.slack.com that records requests. */
async function startFakeApi(respond) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const request = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined };
      requests.push(request);
      const { status = 200, json, text } = respond(request);
      res.statusCode = status;
      res.end(json !== undefined ? JSON.stringify(json) : text ?? "");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

// ---------------------------------------------------------------------------
// installToolkit
// ---------------------------------------------------------------------------

test("installToolkit: registers tools and verifiers; all-or-nothing on conflicts", () => {
  const { agent } = createTestAgent();
  const toolkit = createSlackToolkit({ webhookUrl: "https://hooks.slack.com/services/x" });

  assert.deepEqual(installToolkit(agent, toolkit), ["slack_post_message"]);
  assert.throws(() => installToolkit(agent, toolkit), /already registered slack_post_message/);

  const tool = (action) => ({ action, execute: async () => ({ success: true, durationMs: 0 }) });
  const { agent: other } = createTestAgent({ tools: [tool("b")] });
  assert.throws(() => installToolkit(other, { name: "bad", tools: [tool("a"), tool("a"), tool("b")] }), /repeated actions a; already registered b/);
  assert.equal(other.tools.has("a"), false);

  let verified = false;
  const { agent: withVerifier } = createTestAgent();
  installToolkit(withVerifier, {
    name: "v",
    tools: [tool("c")],
    verifiers: [{ action: "c", verify: () => { verified = true; return { status: "COMPLETE" }; } }]
  });
  return withVerifier.execute({ action: "c" }).then(() => assert.equal(verified, true));
});

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

test("GitHub: create issue, comment and read, with auth headers and the configured repository", async () => {
  const api = await startFakeApi((request) => {
    if (request.method === "POST" && request.url === "/repos/acme/app/issues") return { status: 201, json: { number: 7, html_url: "https://github.com/acme/app/issues/7" } };
    if (request.url === "/repos/acme/app/issues/7/comments") return { status: 201, json: { id: 99, html_url: "https://github.com/acme/app/issues/7#c99" } };
    if (request.url === "/repos/acme/app/issues/7") return { json: { number: 7, title: "Bug", state: "open", html_url: "u", labels: [{ name: "bug" }] } };
    return { status: 404, json: { message: "Not Found" } };
  });
  try {
    const { agent } = createTestAgent();
    installToolkit(agent, createGitHubToolkit({ token: "ghp_test", repository: "acme/app", apiUrl: api.url }));

    const run = await runSteps(agent, [
      { action: "github_create_issue", payload: { title: "Bug", body: "Details", labels: ["bug"] } },
      { action: "github_comment", payload: { number: 7, body: "Looking into it" } },
      { action: "github_get_issue", payload: { number: 7 } }
    ]);

    assert.equal(run.status, "COMPLETED");
    assert.deepEqual(run.context.github_create_issue, { number: 7, url: "https://github.com/acme/app/issues/7" });
    assert.deepEqual(run.context.github_get_issue.labels, ["bug"]);
    assert.equal(api.requests[0].headers.authorization, "Bearer ghp_test");
    assert.equal(api.requests[0].headers["x-github-api-version"], "2022-11-28");
    assert.deepEqual(api.requests[0].body, { title: "Bug", body: "Details", labels: ["bug"] });
    assert.deepEqual(api.requests[1].body, { body: "Looking into it" });
  } finally {
    await api.close();
  }
});

test("GitHub: invalid input and API errors become failed results, never exceptions", async () => {
  const api = await startFakeApi(() => ({ status: 403, json: { message: "Resource not accessible by integration" } }));
  try {
    const toolkit = createGitHubToolkit({ token: "t", repository: "acme/app", apiUrl: api.url });
    const [createIssue, comment] = toolkit.tools;

    assert.match((await createIssue.execute({ intent: { action: "github_create_issue", payload: {} } })).error, /"title" is required/);
    assert.match((await createIssue.execute({ intent: { action: "x", payload: { title: "t", labels: "bug" } } })).error, /"labels" must be an array/);
    assert.match((await comment.execute({ intent: { action: "x", payload: { number: -1, body: "b" } } })).error, /positive integer/);
    assert.equal(api.requests.length, 0);

    const denied = await createIssue.execute({ intent: { action: "x", payload: { title: "t" } } });
    assert.equal(denied.success, false);
    assert.equal(denied.error, "HTTP 403: Resource not accessible by integration");
  } finally {
    await api.close();
  }

  const unreachable = createGitHubToolkit({ token: "t", repository: "acme/app", apiUrl: "http://127.0.0.1:9", timeoutMs: 2000 });
  assert.match((await unreachable.tools[2].execute({ intent: { action: "x", payload: { number: 1 } } })).error, /Request failed/);

  assert.throws(() => createGitHubToolkit({ token: "t", repository: "not a repo" }), /owner\/repo/);
  assert.throws(() => createGitHubToolkit({ token: " ", repository: "a/b" }), /needs a token/);
});

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

test("Slack: posts text and blocks; validates input; never leaks the webhook URL", async () => {
  const api = await startFakeApi(() => ({ text: "ok" }));
  try {
    const [post] = createSlackToolkit({ webhookUrl: `${api.url}/services/T/B/secret`, maxTextLength: 10 }).tools;

    const result = await post.execute({ intent: { action: "slack_post_message", payload: { text: "Deployed", blocks: [{ type: "divider" }] } } });
    assert.deepEqual(result.data, { posted: true });
    assert.equal(api.requests[0].url, "/services/T/B/secret");
    assert.deepEqual(api.requests[0].body, { text: "Deployed", blocks: [{ type: "divider" }] });
    assert.ok(!JSON.stringify(result).includes("secret"));

    assert.match((await post.execute({ intent: { action: "x", payload: {} } })).error, /"text" is required/);
    assert.match((await post.execute({ intent: { action: "x", payload: { text: "far too long text" } } })).error, /exceeds 10/);
    assert.match((await post.execute({ intent: { action: "x", payload: { text: "hi", blocks: "no" } } })).error, /"blocks" must be an array/);
  } finally {
    await api.close();
  }

  assert.throws(() => createSlackToolkit({ webhookUrl: "not a url" }), /valid webhookUrl/);
  assert.throws(() => createSlackToolkit({ webhookUrl: "http://hooks.slack.com/x" }), /https/);
});

test("Toolkit tools are gated by RBAC like any other tool", async () => {
  const api = await startFakeApi(() => ({ text: "ok" }));
  try {
    const access = createAccessControl([
      { name: "bot", permissions: ["slack:post"] },
      { name: "intern", permissions: [] }
    ]);
    const roles = { release_bot: ["bot"], intern: ["intern"] };
    const { agent, engine } = createTestAgent();
    installToolkit(agent, createSlackToolkit({ webhookUrl: `${api.url}/hook` }));
    engine.addRule(toolPermissionRule({ access, tools: agent.tools, resolveRoles: ({ intent }) => roles[intent.actor] ?? [] }));

    const denied = await runSteps(agent, [{ action: "slack_post_message", payload: { text: "hi" } }], { actor: "intern" });
    assert.equal(denied.status, "FAILED");
    assert.match(denied.error, /slack:post/);
    assert.equal(api.requests.length, 0);

    const allowed = await runSteps(agent, [{ action: "slack_post_message", payload: { text: "hi" } }], { actor: "release_bot" });
    assert.equal(allowed.status, "COMPLETED");
    assert.equal(api.requests.length, 1);
  } finally {
    await api.close();
  }
});

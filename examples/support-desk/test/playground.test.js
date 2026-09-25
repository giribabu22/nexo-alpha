import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPlayground } from "../dist/playground.js";

test("playground: explore RBAC, approval, memory and metrics through commands", async () => {
  const playground = await createPlayground();
  try {
    assert.match(await playground.execute("help"), /refund <order-id>/);
    assert.match(await playground.execute("as nobody"), /Unknown user/);

    assert.match(await playground.execute("as ann"), /viewer/);
    assert.match(await playground.execute("refund o-1"), /FAILED[\s\S]*lacks permission\(s\): orders:refund/);

    await playground.execute("as sam");
    assert.match(await playground.execute("refund o-1"), /COMPLETED/);

    const large = await playground.execute("refund o-2");
    assert.match(large, /WAITING[\s\S]*manager's approval/);
    const runId = /queued (\S+)/.exec(large)[1];

    await playground.execute("as max");
    assert.match(await playground.execute(`approve ${runId}`), /COMPLETED[\s\S]*refund_order by max/);

    assert.match(await playground.execute("memory refund"), /refund:o-1 = \{"amount":40,"by":"sam"\}/);
    assert.match(await playground.execute("runs"), /Refund order o-2/);
    assert.match(await playground.execute("metrics"), /refunds: started 3, completed 2, failed 1, paused 1/); // acme only
    assert.match(await playground.execute("projects"), /acme  "Acme Corp"  \(manager\)[\s\S]*globex  "Globex"  \(manager\)/);
    assert.match(await playground.execute("project globex"), /Now in project globex/);
    assert.match(await playground.execute("runs"), /No runs yet/); // acme's runs are not visible in globex
    assert.match(await playground.execute("metrics"), /refunds: no runs yet/);
    await playground.execute("as ops");
    assert.match(await playground.execute("metrics"), /refunds: started 3, completed 2, failed 1, paused 1/);
    assert.match(await playground.execute("dance"), /Unknown command/);
  } finally {
    await playground.close();
  }
});

test("playground: runs interactively over stdin", async () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "playground.js");
  const output = await new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [script], { timeout: 20_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin.end("as max\nrefund o-2\nexit\n");
  });
  assert.match(output, /Nexo support-desk playground/);
  assert.match(output, /Now acting as max/);
  assert.match(output, /COMPLETED/);
});

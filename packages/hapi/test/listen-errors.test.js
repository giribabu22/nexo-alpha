/** Listening failures say which port and host, why, and what to change; Node's error stays as `cause`. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";

import { createApplication, NexoConfigurationError } from "@nexo-alpha/core";
import { startHapiServer, serve } from "../dist/index.js";
import { explainListenError } from "../dist/create-server.js";

async function occupiedPort(fn) {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, "localhost", resolve));
  try {
    await fn(blocker.address().port);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
}

test("startHapiServer: a port in use is named, with what to do", () =>
  occupiedPort(async (port) => {
    await assert.rejects(startHapiServer(createApplication({ name: "a" }), { port, logging: false }), (error) => {
      assert.ok(error instanceof NexoConfigurationError);
      assert.equal(
        error.message,
        `Can't listen on port ${port} on localhost: another process is already using it (EADDRINUSE). Stop that process, or choose another port (the port option; serve() also reads PORT).`
      );
      assert.equal(error.cause.code, "EADDRINUSE");
      return true;
    });
  }));

test("serve(): the same message, and nothing is left running", () =>
  occupiedPort(async (port) => {
    const app = createApplication({ name: "b" });
    await assert.rejects(serve({ port, logging: false, handleSignals: false, app, store: ":memory:" }), /Can't listen on port \d+ on localhost: another process is already using it/);
    assert.equal(app.state, "stopped");
  }));

test("explainListenError: permission, a host that isn't this machine, and anything else unchanged", () => {
  const error = (code) => Object.assign(new Error(`listen ${code}`), { code });
  assert.match(explainListenError(error("EACCES"), 80, "localhost").message, /port 80 on localhost: permission denied \(EACCES\)\. Ports below 1024 .* port of 1024 or higher/);
  assert.match(explainListenError(error("EADDRNOTAVAIL"), 3000, "10.9.9.9").message, /"10\.9\.9\.9" isn't an address of this machine \(EADDRNOTAVAIL\)\. Use "localhost", or "0\.0\.0\.0"/);
  const other = error("ECONNRESET");
  assert.equal(explainListenError(other, 3000, "localhost"), other);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createLogger, noopLogger } from "../dist/index.js";

function capture(options = {}) {
  const entries = [];
  const logger = createLogger({ sink: (entry) => entries.push(entry), now: () => new Date("2026-09-25T00:00:00.000Z"), ...options });
  return { logger, entries };
}

test("createLogger: writes structured entries at or above the minimum level", () => {
  const { logger, entries } = capture({ level: "info", fields: { service: "api" } });

  logger.debug("hidden");
  logger.info("hello", { userId: "u1" });
  logger.error("boom", { error: new Error("bad") });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { service: "api", userId: "u1", time: "2026-09-25T00:00:00.000Z", level: "info", msg: "hello" });
  assert.equal(entries[1].level, "error");
  assert.equal(entries[1].error.message, "bad");
  assert.equal(entries[1].error.name, "Error");
});

test("child loggers add bound fields; call fields win; reserved keys cannot be overridden", () => {
  const { logger, entries } = capture({ level: "debug" });
  const child = logger.child({ requestId: "r1", scope: "outer" }).child({ scope: "inner" });

  child.debug("step", { scope: "call", level: "spoofed", msg: "spoofed" });

  assert.deepEqual(entries[0], { requestId: "r1", scope: "call", level: "debug", msg: "step", time: "2026-09-25T00:00:00.000Z" });
});

test("a throwing sink never breaks the caller; noopLogger discards everything", () => {
  const logger = createLogger({ sink: () => { throw new Error("disk full"); } });
  assert.doesNotThrow(() => logger.warn("still fine"));

  assert.doesNotThrow(() => noopLogger.child({ a: 1 }).error("ignored"));
  assert.equal(noopLogger.child({}), noopLogger);
});

test("redaction: credentials are replaced at any depth, case-insensitively; cycles are safe", () => {
  const { logger, entries } = capture();
  const cyclic = { name: "loop" };
  cyclic.self = cyclic;

  logger.child({ Authorization: "Bearer abc" }).info("request", {
    headers: { authorization: "Bearer abc", "x-api-key": "k", accept: "json" },
    user: { name: "sam", password: "hunter2", tokens: [{ refreshToken: "r" }] },
    secret: "s",
    cyclic
  });

  const [entry] = entries;
  assert.equal(entry.Authorization, "[REDACTED]");
  assert.deepEqual(entry.headers, { authorization: "[REDACTED]", "x-api-key": "[REDACTED]", accept: "json" });
  assert.deepEqual(entry.user, { name: "sam", password: "[REDACTED]", tokens: [{ refreshToken: "[REDACTED]" }] });
  assert.equal(entry.secret, "[REDACTED]");
  assert.equal(entry.cyclic.self, "[Circular]");
  assert.doesNotThrow(() => JSON.stringify(entry));
});

test("redaction: custom keys replace the defaults; [] disables it", () => {
  const custom = capture({ redact: ["ssn"] });
  custom.logger.info("x", { ssn: "123", password: "visible" });
  assert.deepEqual([custom.entries[0].ssn, custom.entries[0].password], ["[REDACTED]", "visible"]);

  const off = capture({ redact: [] });
  off.logger.info("x", { password: "p" });
  assert.equal(off.entries[0].password, "p");
});

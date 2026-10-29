/**
 * The time recorder (TIME-PROTOCOL.md): timing arithmetic, and that a prepared
 * task fails its check until it is done, for a feature task and a debug task.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "nexo-time-"));
process.env.NEXO_TIME_RESULTS = join(scratch, "results.jsonl");
process.env.NEXO_TIME_SESSIONS = join(scratch, "sessions");
const { prepare, readEvents, report, sessionTimes, verify } = await import("../time/record.mjs");
const answers = join(import.meta.dirname, "..", "src");

test.after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

test("active time leaves out pauses; elapsed doesn't; a session ends at its first passing verify", () => {
  const min = 60_000;
  const events = [
    { type: "prepare", session: "s1", task: "debug-wrong-scope", variant: "after", at: 0 },
    { type: "start", session: "s1", at: 0 },
    { type: "found", session: "s1", cause: "the scope is spelled invite:write", at: 4 * min },
    { type: "pause", session: "s1", at: 5 * min },
    { type: "resume", session: "s1", at: 15 * min },
    { type: "verify", session: "s1", passed: false, at: 17 * min },
    { type: "verify", session: "s1", passed: true, at: 20 * min },
    { type: "verify", session: "s1", passed: true, at: 30 * min }
  ];
  const [s] = sessionTimes(events);
  assert.deepEqual(s.done, { activeMs: 10 * min, elapsedMs: 20 * min });
  assert.deepEqual(s.found, { activeMs: 4 * min, cause: "the scope is spelled invite:write" });
  assert.equal(s.verifies, 2);
  assert.match(report(events), /\| debug-wrong-scope \| after \| 1 \| 10\.0 min \| 20\.0 min \| 4\.0 min \(1\/1 right\) \| 2 \|/);
});

test("feature task: the stubs fail the check; the finished feature passes it", { timeout: 180_000 }, () => {
  const { id, workspace } = prepare("p1", "user-crud", "after");
  const dir = join(workspace, "src", "user-crud", "after");
  assert.match(readFileSync(join(dir, "users.api.ts"), "utf8"), /not written yet/);
  assert.equal(verify(id).passed, false);

  for (const file of readdirSync(join(answers, "user-crud", "after"))) cpSync(join(answers, "user-crud", "after", file), join(dir, file));
  assert.equal(verify(id).passed, true);
  assert.deepEqual(readEvents().filter((e) => e.session === id).map((e) => e.type), ["prepare", "verify", "verify"]);
});

test("debug task: the injected mistake fails the check; fixing it passes", { timeout: 180_000 }, () => {
  for (const variant of ["before", "after"]) {
    const { id, workspace } = prepare("p1", "debug-wrong-scope", variant);
    const file = join(workspace, "src", "validated-post", variant, "invitations.api.ts");
    assert.match(readFileSync(file, "utf8"), /"invite:write"/);
    assert.equal(verify(id).passed, false, variant);
    writeFileSync(file, readFileSync(file, "utf8").replace('"invite:write"', '"invites:write"'));
    assert.equal(verify(id).passed, true, variant);
  }
});

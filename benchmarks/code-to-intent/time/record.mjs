#!/usr/bin/env node
/**
 * Records timed sessions for TIME-PROTOCOL.md.
 *
 *   node time/record.mjs prepare <participant> <task> <before|after>   → prints a session id and its folder
 *   node time/record.mjs start <session>
 *   node time/record.mjs pause <session> | resume <session>            → breaks don't count as active time
 *   node time/record.mjs found <session> "<what you think the cause is>"   (debug tasks)
 *   node time/record.mjs verify <session>                              → builds and runs the task's tests
 *   node time/record.mjs report
 *
 * Events go to time/results.jsonl, one JSON object per line. A session ends at
 * its first passing verify.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS, VARIANTS } from "./tasks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const repo = resolve(pkg, "..", "..");
const RESULTS = process.env.NEXO_TIME_RESULTS ?? join(here, "results.jsonl");
const SESSIONS = process.env.NEXO_TIME_SESSIONS ?? join(repo, ".nexo-time-sessions");
const now = () => Number(process.env.NEXO_TIME_NOW ?? Date.now());

export function readEvents(file = RESULTS) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
const record = (event) => appendFileSync(RESULTS, JSON.stringify({ ...event, at: now() }) + "\n");

/** A stub for each export, so the workspace compiles and the task's tests fail until it is written. */
function stub(source, file) {
  const lines = [`// ${file}: write this file. The conformance test uses these exports.`];
  for (const [, name] of source.matchAll(/^export (?:async )?function (\w+)/gm)) {
    lines.push(`export function ${name}(..._args: unknown[]): never {`, `  throw new Error("${name}: not written yet");`, "}");
  }
  for (const [, name] of source.matchAll(/^export const (\w+)/gm)) lines.push(`export const ${name}: unknown = undefined;`);
  for (const [, name] of source.matchAll(/^export (?:type|interface) (\w+)/gm)) lines.push(`export type ${name} = unknown;`);
  return lines.join("\n") + "\n";
}

export function prepare(participant, taskName, variant) {
  const task = TASKS[taskName];
  if (task === undefined) throw new Error(`Unknown task "${taskName}". Tasks: ${Object.keys(TASKS).join(", ")}`);
  if (!VARIANTS.includes(variant)) throw new Error(`Variant must be ${VARIANTS.join(" or ")}.`);
  const id = `${participant}-${taskName}-${variant}-${now()}`;
  const workspace = join(SESSIONS, id);
  mkdirSync(workspace, { recursive: true });
  for (const part of ["src", "test", "package.json"]) cpSync(join(pkg, part), join(workspace, part), { recursive: true });
  writeFileSync(
    join(workspace, "tsconfig.json"),
    JSON.stringify({ ...JSON.parse(readFileSync(join(pkg, "tsconfig.json"), "utf8")), extends: join(repo, "tsconfig.json").replaceAll("\\", "/") }, null, 2)
  );
  symlinkSync(join(pkg, "node_modules"), join(workspace, "node_modules"), "junction");

  const dir = join(workspace, "src", task.feature, variant);
  if (task.kind === "feature") {
    for (const file of readdirSync(dir)) writeFileSync(join(dir, file), stub(readFileSync(join(dir, file), "utf8"), file));
  } else {
    const pick = (value) => (typeof value === "object" ? value[variant] : value);
    const file = join(dir, pick(task.break.file));
    const source = readFileSync(file, "utf8");
    if (!source.includes(pick(task.break.find))) throw new Error(`The mistake for "${taskName}" no longer applies to ${file}.`);
    writeFileSync(file, source.replace(pick(task.break.find), pick(task.break.replace)));
  }
  record({ type: "prepare", session: id, participant, task: taskName, variant, workspace });
  return { id, workspace };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Builds the workspace and runs the task's tests there; returns whether they passed. */
export function verify(session) {
  const prepared = readEvents().find((e) => e.type === "prepare" && e.session === session);
  if (prepared === undefined) throw new Error(`No session "${session}".`);
  const task = TASKS[prepared.task];
  const tsc = createRequire(join(pkg, "package.json")).resolve("typescript/bin/tsc");
  let passed = true;
  let output = "";
  try {
    output += execFileSync(process.execPath, [tsc, "-p", "."], { cwd: prepared.workspace, encoding: "utf8", stdio: "pipe" });
    const pattern = task.tests.map((name) => `^\\[${prepared.variant}\\] ${escape(name)}$`).join("|");
    // Without NODE_TEST_CONTEXT: inherited from a parent `node --test`, it makes this run report to that parent and exit 0.
    const { NODE_TEST_CONTEXT: _parent, ...env } = process.env;
    const tests = execFileSync(process.execPath, ["--test", `--test-name-pattern=${pattern}`, "test/conformance.test.js"], {
      cwd: prepared.workspace,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...env, NODE_ENV: "test" }
    });
    output += tests;
    // A pattern matching nothing would "pass" with no tests run: require every task test to have passed.
    const ran = Number(/ℹ pass (\d+)/.exec(tests)?.[1] ?? 0);
    if (ran !== task.tests.length) {
      passed = false;
      output += `\nExpected ${task.tests.length} passing tests, got ${ran}.`;
    }
  } catch (error) {
    passed = false;
    output += `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  record({ type: "verify", session, passed });
  return { passed, output };
}

/** Active time (pauses excluded) and elapsed time per session, up to its first passing verify. */
export function sessionTimes(events) {
  const sessions = new Map();
  for (const event of events) {
    if (event.type === "prepare") {
      sessions.set(event.session, { ...event, start: undefined, running: undefined, active: 0, verifies: 0, done: undefined, found: undefined });
      continue;
    }
    const s = sessions.get(event.session);
    if (s === undefined || s.done !== undefined) continue;
    if (event.type === "start") {
      s.start = event.at;
      s.running = event.at;
    } else if (event.type === "pause" && s.running !== undefined) {
      s.active += event.at - s.running;
      s.running = undefined;
    } else if (event.type === "resume" && s.running === undefined && s.start !== undefined) {
      s.running = event.at;
    } else if (event.type === "found" && s.found === undefined && s.start !== undefined) {
      s.found = { activeMs: s.active + (s.running !== undefined ? event.at - s.running : 0), cause: event.cause };
    } else if (event.type === "verify" && s.start !== undefined) {
      s.verifies += 1;
      if (event.passed) {
        s.active += s.running !== undefined ? event.at - s.running : 0;
        s.running = undefined;
        s.done = { activeMs: s.active, elapsedMs: event.at - s.start };
      }
    }
  }
  return [...sessions.values()];
}

const median = (values) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const minutes = (ms) => (ms === undefined ? "—" : `${(ms / 60000).toFixed(1)} min`);

export function report(events) {
  const rows = [];
  for (const task of Object.keys(TASKS)) {
    for (const variant of VARIANTS) {
      const done = sessionTimes(events).filter((s) => s.task === task && s.variant === variant && s.done !== undefined);
      if (done.length === 0) continue;
      const found = done.filter((s) => s.found !== undefined);
      rows.push(
        `| ${task} | ${variant} | ${done.length} | ${minutes(median(done.map((s) => s.done.activeMs)))} | ${minutes(median(done.map((s) => s.done.elapsedMs)))} | ` +
          `${TASKS[task].kind === "debug" ? `${minutes(median(found.map((s) => s.found.activeMs)))} (${found.filter((s) => TASKS[task].cause.test(s.found.cause)).length}/${found.length} right)` : "—"} | ${median(done.map((s) => s.verifies))} |`
      );
    }
  }
  return [
    "| Task | Variant | Sessions | Active (median) | Elapsed (median) | To the cause (debug) | Verify runs (median) |",
    "|---|---|---|---|---|---|---|",
    ...rows
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "prepare": {
      const { id, workspace } = prepare(args[0], args[1], args[2]);
      console.log(`Session ${id}\nWork in ${workspace}\nThen: node time/record.mjs start ${id}`);
      break;
    }
    case "start":
    case "pause":
    case "resume":
      record({ type: command, session: args[0] });
      console.log(`${command} ${args[0]}`);
      break;
    case "found":
      record({ type: "found", session: args[0], cause: args.slice(1).join(" ") });
      console.log("recorded");
      break;
    case "verify": {
      const { passed, output } = verify(args[0]);
      console.log(passed ? "PASSED: the session is done." : `Not yet:\n${output.split("\n").filter((l) => /✖|Error|error TS/.test(l)).slice(0, 15).join("\n")}`);
      break;
    }
    case "report":
      console.log(report(readEvents()));
      break;
    default:
      console.error("Usage: node time/record.mjs prepare|start|pause|resume|found|verify|report …");
      process.exitCode = 1;
  }
}

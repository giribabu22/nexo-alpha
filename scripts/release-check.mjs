#!/usr/bin/env node
/**
 * Checks a release the way a user meets it. Run after `pnpm build`:
 *
 *   pnpm release:check                      # every template
 *   pnpm release:check -- minimal,backend-api
 *   pnpm release:check -- --keep            # keep the temp directory to inspect
 *
 * 1. Packs every package exactly as `npm publish` would (workspace:* becomes
 *    the real version).
 * 2. Installs the packed create-nexo-app and generates each template with its CLI.
 * 3. Checks that generated projects ask for this release (`^<version>`).
 * 4. `npm install`s each project: third-party packages from the registry,
 *    @nexo-alpha packages from the tarballs (they are not published yet).
 * 5. `npm run build` (for fullstack-react, a real Vite build), and `npm test`
 *    where the template has tests.
 * 6. Starts each app and checks its answers over HTTP; fullstack-react must
 *    serve the built frontend and the API from one port.
 * 7. backend-api: writes a migration with `nexo migrate create`, builds, checks
 *    `plan`, restarts the app (serve() applies it), and checks `status`,
 *    `check` and the migrated record over HTTP.
 *
 * Needs network access for the registry. Exits 1 on the first failure.
 */

import { execSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repo = fileURLToPath(new URL("..", import.meta.url));
const keep = process.argv.includes("--keep");
const only = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const templates = only?.split(",") ?? ["minimal", "backend-api", "agent-service", "fullstack-react"];
const { version } = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));

const run = (command, cwd) =>
  execSync(command, { cwd, stdio: "pipe", encoding: "utf8", env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } });
const step = (text) => console.log(`  ${text}`);

/** Requests each app must answer; `expect` is checked against status and body. */
const CHECKS = {
  minimal: {
    ready: /ready at/,
    requests: [
      ["POST", "/api/tasks", { body: { title: "" }, status: 400 }],
      ["POST", "/api/tasks", { body: { title: "Hello" }, status: 201, save: "id" }],
      ["PATCH", "/api/tasks/:id", { body: { done: true }, status: 200, has: '"done":true' }],
      ["DELETE", "/api/tasks/:id", { status: 204 }],
      ["GET", "/", { status: 200, has: "Hello from" }]
    ]
  },
  "backend-api": {
    ready: /ready at/,
    requests: [
      ["POST", "/api/notes", { body: { title: "" }, status: 400, has: "body.title" }],
      ["POST", "/api/notes", { body: { title: "Hi" }, status: 201 }],
      ["GET", "/api/notes?search=hi", { status: 200, has: '"total":1' }],
      ["GET", "/health", { status: 200 }]
    ],
    // After the first run: a migration, written and applied the way a user would.
    async migrate(dir, port) {
      run("npx nexo migrate create mark-notes", dir);
      const migrations = join(dir, "src", "migrations");
      const created = (await readdir(migrations)).find((name) => name.endsWith("-mark-notes.ts"));
      const source = await readFile(join(migrations, created), "utf8");
      await writeFile(
        join(migrations, created),
        source
          .replace("// e.g. await m.renameField(\"users\", \"name\", \"fullName\");", "await m.update(\"notes\", (note) => ({ ...note, title: `[migrated] ${String(note.title)}` }));")
          // Drop the template's down(): this change isn't reversed.
          .replace(/\n {2}\/\/ Reverses up\(\)[\s\S]*?\n {2}}\n/, "\n")
      );
      step(`nexo migrate create (${created})`);
      run("npm run build", dir);
      assert.match(run("npx nexo migrate plan", dir), /1 pending migration[\s\S]*notes: 1 updated/);
      step("nexo migrate plan");
      await exercise(dir, { ready: /ready at/, requests: [["GET", "/api/notes", { status: 200, has: "[migrated] Hi" }]] }, port);
      assert.match(run("npx nexo migrate status", dir), /1 applied, 0 pending/);
      assert.match(run("npx nexo migrate check", dir), /Every record matches its model\./);
      step("serve() applied it; nexo migrate status and check");
    }
  },
  "agent-service": {
    ready: /app ready/,
    requests: [
      ["GET", "/health", { status: 200 }],
      ["GET", "/workflows", { status: 401 }]
    ]
  },
  "fullstack-react": {
    dir: "backend",
    ready: /ready at/,
    requests: [
      ["GET", "/", { accept: "text/html", status: 200, type: "text/html", save: "asset" }],
      ["GET", "/todos", { accept: "text/html", status: 200, type: "text/html" }],
      ["GET", ":asset", { status: 200, type: "text/javascript" }],
      ["GET", "/api/todos", { status: 200, has: '"items"' }],
      ["POST", "/api/todos", { body: { text: "release check" }, status: 201 }]
    ]
  }
};

async function pack(destination) {
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(join(repo, "packages"))) run(`pnpm pack --pack-destination "${destination}"`, join(repo, "packages", name));
  const tarballs = {};
  for (const file of await readdir(destination)) {
    const match = /^nexo-alpha-(.+)-\d+\.\d+\.\d+(?:-[\w.]+)?\.tgz$/.exec(file);
    if (match) tarballs[`@nexo-alpha/${match[1]}`] = "file:" + join(destination, file).replaceAll(sep, "/");
  }
  return tarballs;
}

/** Points every @nexo-alpha dependency at its tarball; returns the ranges the generator wrote. */
async function pointAtTarballs(dir, tarballs) {
  const root = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  const ranges = new Set();
  for (const pkgDir of [dir, ...(root.workspaces ?? []).map((workspace) => join(dir, workspace))]) {
    const file = join(pkgDir, "package.json");
    const pkg = JSON.parse(await readFile(file, "utf8"));
    for (const field of ["dependencies", "devDependencies"]) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (!dep.startsWith("@nexo-alpha/")) continue;
        ranges.add(pkg[field][dep]);
        pkg[field][dep] = tarballs[dep];
      }
    }
    if (pkgDir === dir) pkg.overrides = Object.fromEntries(Object.entries(tarballs).filter(([name]) => name !== "@nexo-alpha/create-nexo-app"));
    await writeFile(file, JSON.stringify(pkg, null, 2) + "\n");
  }
  return ranges;
}

async function exercise(dir, { ready, requests }, port) {
  const child = spawn(process.execPath, ["dist/index.js"], { cwd: dir, env: { ...process.env, PORT: String(port) } });
  let log = "";
  child.stdout.on("data", (data) => (log += data));
  child.stderr.on("data", (data) => (log += data));
  try {
    const started = Date.now();
    while (!ready.test(log)) {
      if (child.exitCode !== null || Date.now() - started > 20_000) throw new Error(`did not start:\n${log}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const saved = {};
    for (const [method, rawPath, expect] of requests) {
      const path = rawPath.replace(":id", saved.id).replace(":asset", saved.asset);
      const response = await fetch(`http://localhost:${port}${path}`, {
        method,
        headers: { accept: expect.accept ?? "*/*", ...(expect.body ? { "content-type": "application/json" } : {}) },
        ...(expect.body ? { body: JSON.stringify(expect.body) } : {})
      });
      const text = await response.text();
      const where = `${method} ${path}`;
      assert.equal(response.status, expect.status, `${where}: ${text.slice(0, 200)}`);
      if (expect.type) assert.match(response.headers.get("content-type") ?? "", new RegExp(expect.type), where);
      if (expect.has) assert.ok(text.includes(expect.has), `${where} should include ${expect.has}: ${text.slice(0, 200)}`);
      if (expect.save === "id") saved.id = JSON.parse(text).id;
      if (expect.save === "asset") saved.asset = /src="(\/assets\/[^"]+\.js)"/.exec(text)?.[1];
      step(`${where} → ${response.status}`);
    }
  } finally {
    child.kill();
  }
}

const work = await mkdtemp(join(tmpdir(), "nexo-release-check-"));
console.log(`Release check for ${version} in ${work}`);
try {
  console.log("Packing");
  const tarballs = await pack(join(work, "tarballs"));
  step(`${Object.keys(tarballs).length} packages`);

  const tool = join(work, "tool");
  await mkdir(tool);
  await writeFile(join(tool, "package.json"), "{}");
  run(`npm install ${tarballs["@nexo-alpha/create-nexo-app"]}`, tool);
  const cli = join(tool, "node_modules", "@nexo-alpha", "create-nexo-app", "dist", "cli.js");

  let port = 4600;
  for (const template of templates) {
    console.log(`Template ${template}`);
    const name = `release-${template}`;
    const dir = join(work, name);
    run(`node "${cli}" ${name} --template ${template}`, work);
    const ranges = await pointAtTarballs(dir, tarballs);
    assert.deepEqual([...ranges], [`^${version}`], `generated ranges: ${[...ranges].join(", ")}`);
    step(`asks for ^${version}`);
    run("npm install", dir);
    step("npm install");
    run("npm run build", dir);
    step("npm run build");
    const { scripts } = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    if (scripts?.test) {
      run("npm test", dir);
      step("npm test");
    }
    const check = CHECKS[template];
    await exercise(join(dir, check.dir ?? "."), check, port++);
    if (check.migrate !== undefined) await check.migrate(join(dir, check.dir ?? "."), port++);
  }
  console.log(`\nRelease check passed: ${templates.join(", ")}`);
} catch (error) {
  console.error(`\nRelease check FAILED: ${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`);
  process.exitCode = 1;
} finally {
  if (keep) console.log(`Kept ${work}`);
  else await rm(work, { recursive: true, force: true });
}

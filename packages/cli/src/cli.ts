#!/usr/bin/env node
import { resolve } from "node:path";
import { loadApplication } from "./load-application.js";
import { resolveConfiguredAppPath } from "./config.js";
import type { KnowledgeEdgeKind, TraversalDirection } from "@nexo-alpha/tools";
import {
  context,
  graph,
  health,
  impact,
  inspect,
  knowledge as renderKnowledge,
  search,
  sourceTree,
  status,
  trace,
  validate
} from "./commands.js";

const USAGE = `Usage:
  nexo init [project-name] [--template <name>]
  nexo inspect [app-module-path] [moduleName]
  nexo inspect [--module moduleName]
  nexo status [app-module-path]
  nexo context [app-module-path] [--source-root <path>]
  nexo knowledge [app-module-path]
  nexo source [project-root]
  nexo graph [app-module-path] [--source-root <path>] [--out <path>] [--force]
  nexo search <query> [app-module-path] [--source-root <path>]
  nexo trace <nodeId> [app-module-path] [--source-root <path>] [--callers]
  nexo impact <nodeId> [app-module-path] [--source-root <path>] [--dependencies] [--max-depth <n>] [--edge-kinds <kind,...>]
  nexo validate [app-module-path]
  nexo health [app-module-path]

If app-module-path is omitted, Nexo looks for a "nexo.config.json" in the
current directory or a parent directory, with the shape:
  { "app": "./dist/app.js" }

"nexo source" is the one command that doesn't load an application — it
scans project-root's (default: cwd) actual source files, independent of
whatever is registered with NexoApplication. "nexo context --source-root
<path>" folds that same scan into the context manifest, so one call
answers both "what's registered" and "what's actually in the files."

"nexo graph" builds the unified knowledge graph (modules/APIs/services/
jobs/dependencies, plus files/symbols/imports/calls when --source-root is
given) and persists it to --out (default ".nexo/knowledge-graph.json").
Rebuilding is hash-gated: an up-to-date graph on disk is left alone unless
--force is passed.

"nexo search"/"nexo trace"/"nexo impact" query that same graph live (built
fresh each call, not read from a saved --out file) — case-insensitive
keyword search over node names/descriptions, and edge tracing from a node
ID (as printed by "nexo graph"/"nexo search", e.g. "module:payments" or
"symbol:src/orders.ts#createOrder"). "nexo trace" defaults to "what would
be affected if this changed" (every edge pointing at the node); --callers
narrows that to only "calls" edges ("what calls this"). "nexo impact" is
"nexo trace" taken transitively: the full multi-hop blast radius, not just
the immediate edges — defaults to the same "dependents" direction; pass
--dependencies to instead walk what the node depends on. --max-depth caps
the hop count (default: unlimited), and --edge-kinds (comma-separated,
e.g. "calls,imports") narrows which edge kinds are followed (default: all).`;

function extractFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : undefined;
}

/** For commands whose first positional argument isn't the app path (search/trace). */
async function resolveAppPathFrom(candidate: string | undefined): Promise<string | undefined> {
  if (candidate !== undefined && !candidate.startsWith("--")) {
    return candidate;
  }
  return resolveConfiguredAppPath(process.cwd());
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === undefined) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (command === "init" || command === "new") {
    const projectName = rest[0] || "my-nexo-app";
    console.log(`\n🚀 To scaffold a new Nexo project, run:\n`);
    console.log(`   npx create-nexo-app ${projectName}\n`);
    return;
  }

  if (command === "source") {
    const projectRoot = resolve(process.cwd(), rest[0] ?? ".");
    console.log(await sourceTree(projectRoot));
    return;
  }

  if (command === "search" || command === "trace" || command === "impact") {
    const [target, second] = rest;

    if (target === undefined) {
      console.error(
        `Usage: nexo ${command} <${command === "search" ? "query" : "nodeId"}> [app-module-path] [--source-root <path>]\n\n${USAGE}`
      );
      process.exitCode = 1;
      return;
    }

    const appPath = await resolveAppPathFrom(second);

    if (appPath === undefined) {
      console.error(`No app path given and no "nexo.config.json" found.\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    }

    const sourceRootFlag = extractFlagValue(rest, "--source-root");
    const sourceRoot = sourceRootFlag !== undefined ? resolve(process.cwd(), sourceRootFlag) : undefined;
    const { app, knowledge } = await loadApplication(appPath);

    if (command === "search") {
      console.log(await search(app, knowledge, target, sourceRoot));
    } else if (command === "trace") {
      console.log(await trace(app, knowledge, target, sourceRoot, rest.includes("--callers") ? "callers" : "dependents"));
    } else {
      const direction: TraversalDirection = rest.includes("--dependencies") ? "dependencies" : "dependents";
      const maxDepthFlag = extractFlagValue(rest, "--max-depth");
      const maxDepth = maxDepthFlag !== undefined ? Number(maxDepthFlag) : undefined;
      const edgeKindsFlag = extractFlagValue(rest, "--edge-kinds");
      const edgeKinds = edgeKindsFlag !== undefined ? (edgeKindsFlag.split(",") as KnowledgeEdgeKind[]) : undefined;
      console.log(await impact(app, knowledge, target, sourceRoot, direction, maxDepth, edgeKinds));
    }
    return;
  }

  let appPath: string | undefined;
  let moduleName: string | undefined;

  const [first, second] = rest;

  if (first !== undefined && !first.startsWith("--")) {
    appPath = first;
    moduleName = second;
  } else {
    moduleName = extractFlagValue(rest, "--module");
    appPath = await resolveConfiguredAppPath(process.cwd());
  }

  const sourceRootFlag = extractFlagValue(rest, "--source-root");
  const sourceRoot = sourceRootFlag !== undefined ? resolve(process.cwd(), sourceRootFlag) : undefined;

  const outFlag = extractFlagValue(rest, "--out");
  const outPath = resolve(process.cwd(), outFlag ?? ".nexo/knowledge-graph.json");
  const force = rest.includes("--force");

  if (appPath === undefined) {
    console.error(
      `No app path given and no "nexo.config.json" found.\n\n${USAGE}`
    );
    process.exitCode = 1;
    return;
  }

  const { app, knowledge } = await loadApplication(appPath);

  switch (command) {
    case "inspect":
      console.log(inspect(app, knowledge, moduleName));
      return;
    case "status":
      console.log(status(app, knowledge));
      return;
    case "context":
      console.log(await context(app, knowledge, sourceRoot));
      return;
    case "knowledge":
      console.log(renderKnowledge(app, knowledge));
      return;
    case "graph":
      console.log(await graph(app, knowledge, outPath, sourceRoot, force));
      return;
    case "validate":
      console.log(validate(app));
      return;
    case "health":
      console.log(health(app));
      return;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

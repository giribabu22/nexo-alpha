#!/usr/bin/env node
import { resolve } from "node:path";
import { loadApplication } from "./load-application.js";
import { loadSummarizer } from "./load-summarizer.js";
import { resolveConfiguredAppPath } from "./config.js";
import type { KnowledgeEdgeKind, TraversalDirection } from "@nexo-alpha/tools";
import type { IntentEntityKind } from "@nexo-alpha/context";
import {
  context,
  freshness,
  graph,
  health,
  impact,
  inspect,
  inspectResource,
  intents,
  knowledge as renderKnowledge,
  search,
  sourceTree,
  status,
  trace,
  validate
} from "./commands.js";
import { doctor, renderDoctorReport } from "./doctor.js";
import {
  migrateBackups,
  migrateCheck,
  migrateCreate,
  migrateDown,
  migratePlan,
  migrateRestore,
  migrateStatus,
  migrateUp,
  renderMigrateBackups,
  renderMigrateCheck,
  renderMigrateDown,
  renderMigratePlan,
  renderMigrateRestore,
  renderMigrateStatus,
  renderMigrateUp
} from "./migrate.js";

const MIGRATE_USAGE = `Usage:
  nexo migrate status [--json]
  nexo migrate plan [--production] [--allow-destructive <id>]... [--max-changes <n>] [--json]
  nexo migrate up [--production] [--allow-destructive <id>]... [--allow-out-of-order] [--max-changes <n>]
                  [--no-backup] [--backup-dir <dir>] [--json]
  nexo migrate backups [--backup-dir <dir>]
  nexo migrate restore <backup> --app-stopped
  nexo migrate down <id>
  nexo migrate create <name> [--dir src/migrations]
  nexo migrate check [--app <module>] [--json]
Each takes --store <path> and --migrations <module> (default: "store" and
"migrations" in nexo.config.json).`;
import { GENERATOR_KINDS, generateFiles, writeGeneratedFiles, type GeneratorKind } from "./generate.js";

const USAGE = `Usage:
  nexo init [project-name] [--template <name>]
  nexo generate <tool|workflow|module|resource|page> <name> [--dir <project-root>] [--force] [--no-page]
  nexo doctor [project-root] [--json]
  nexo inspect [app-module-path] [moduleName]
  nexo inspect [--module moduleName]
  nexo inspect resource [name] [app-module-path] [--json]
  nexo status [app-module-path]
  nexo context [app-module-path] [--source-root <path>]
  nexo knowledge [app-module-path]
  nexo intents [app-module-path] [--entity-kind <kind> --entity-name <name>]
  nexo source [project-root]
  nexo graph [app-module-path] [--source-root <path>] [--out <path>] [--force] [--summarize <path>]
  nexo freshness --source-root <path> [--out <path>]
  nexo search <query> [app-module-path] [--source-root <path>]
  nexo trace <nodeId> [app-module-path] [--source-root <path>] [--callers]
  nexo impact <nodeId> [app-module-path] [--source-root <path>] [--dependencies] [--max-depth <n>] [--edge-kinds <kind,...>]
  nexo validate [app-module-path]
  nexo health [app-module-path]
  nexo migrate <status|plan|up|down|create|check> [--store <path>] [--migrations <module>] (see below)

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

--summarize <path> loads a KnowledgeNodeSummarizer (a named "summarize"
export or default export, a (node) => string | undefined | Promise<...>
function — see @nexo-alpha/tools) and applies it to every node. Nexo never
calls an LLM itself; the summarizer is entirely caller-supplied, so this
is how you'd plug one in. A node whose content hasn't changed since the
last saved graph reuses its cached summary instead of re-invoking the
summarizer, so a real LLM-backed summarizer only pays for genuinely new
or changed nodes — --force clears this cache too and re-summarizes
everything.

"nexo freshness" reports which files were added, structurally changed, or
removed (by exports/imports/top-level-symbol fingerprint, not raw content)
since the graph at --out was last built, without rebuilding it — the
per-file counterpart to "nexo graph"'s whole-tree up-to-date check. Unlike
every other command, it doesn't load an application at all, so there's no
app-module-path argument; --source-root is required (there's nothing to
diff against without it), and it errors if no graph has been saved at
--out yet.

"nexo migrate" changes stored records when models change
(docs/architecture/migrations-design.md). "status" lists applied and
pending migrations and problems (out of order, edited, unknown). "plan"
shows what "up" would change, marks destructive changes, and exits 1 if
"up" would refuse. "up" applies pending migrations, each all-or-nothing;
with --production (or NODE_ENV=production) a destructive one runs only if
named with --allow-destructive. "down <id>" reverts the newest applied
migration. "create <name>" writes a timestamped migration file and adds
it to the list. "check" compares every stored record with its resource's
model and exits 1 on any mismatch. "up" first takes a checked backup when
a pending migration is destructive or none has been applied yet ("backups"
next to the store; the newest 5 are kept). "backups" lists them, and
"restore <backup> --app-stopped" puts one back after checking its checksum,
moving the replaced file aside. status, plan, check and backups only read
and don't create a database. --store and --migrations default to the "store"
and "migrations" paths in nexo.config.json.

"nexo intents" renders recorded intents ("why does this entity exist" —
NexoIntent in @nexo-alpha/context) as JSON: every recorded intent by
default, or with both --entity-kind and --entity-name given, just that
one entity's most-recently-recorded intent ("null" if none was recorded).
Entity kinds include "component" and "function", which have no
structural counterpart anywhere else in Nexo. Recording an intent is a
library operation (NexoWriteInterface.recordIntent() in @nexo-alpha/tools),
same as every other write op — there is no "nexo record-intent" command.

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

  if (command === "generate" || command === "g") {
    const [kind, name] = rest;
    if (kind === undefined || name === undefined || !GENERATOR_KINDS.includes(kind as GeneratorKind)) {
      console.error(`Usage: nexo generate <${GENERATOR_KINDS.join("|")}> <name> [--dir <project-root>] [--force] [--no-page]`);
      process.exitCode = 1;
      return;
    }
    const root = resolve(process.cwd(), extractFlagValue(rest, "--dir") ?? ".");
    const written = await writeGeneratedFiles(root, generateFiles(kind as GeneratorKind, name, { page: !rest.includes("--no-page") }), {
      force: rest.includes("--force")
    });
    console.log(written.map((path) => `created ${path}`).join("\n"));
    return;
  }

  if (command === "migrate") {
    const [sub, ...args] = rest;
    const flags = {
      store: extractFlagValue(args, "--store"),
      migrations: extractFlagValue(args, "--migrations"),
      cwd: process.cwd(),
      production: args.includes("--production"),
      allowDestructive: args.flatMap((arg, i) => (arg === "--allow-destructive" && args[i + 1] !== undefined ? [args[i + 1]!] : [])),
      allowOutOfOrder: args.includes("--allow-out-of-order"),
      maxChanges: extractFlagValue(args, "--max-changes") === undefined ? undefined : Number(extractFlagValue(args, "--max-changes")),
      noBackup: args.includes("--no-backup"),
      backupDir: extractFlagValue(args, "--backup-dir")
    };
    const json = args.includes("--json");
    const print = <T>(result: T, render: (r: T) => string) => console.log(json ? JSON.stringify(result, null, 2) : render(result));
    switch (sub) {
      case "status":
        print(await migrateStatus(flags), renderMigrateStatus);
        return;
      case "plan": {
        const plan = await migratePlan(flags);
        print(plan, renderMigratePlan);
        if (plan.refusals.length > 0) process.exitCode = 1;
        return;
      }
      case "up":
        print(await migrateUp(flags), renderMigrateUp);
        return;
      case "down": {
        const id = args[0];
        if (id === undefined || id.startsWith("--")) break;
        print(await migrateDown({ ...flags, id }), renderMigrateDown);
        return;
      }
      case "create": {
        const name = args[0];
        if (name === undefined || name.startsWith("--")) break;
        const created = await migrateCreate({ name, dir: extractFlagValue(args, "--dir") ?? "src/migrations", cwd: process.cwd() });
        console.log(`Created ${created.file}`);
        console.log(created.registered ? `Added it to ${created.index}` : `Add it to the list in ${created.index} yourself (no "export default [...]" found).`);
        return;
      }
      case "backups":
        print(await migrateBackups(flags), renderMigrateBackups);
        return;
      case "restore": {
        const backup = args[0];
        if (backup === undefined || backup.startsWith("--")) break;
        print(await migrateRestore({ backup, cwd: process.cwd(), appStopped: args.includes("--app-stopped") }), renderMigrateRestore);
        return;
      }
      case "check": {
        const appPath = await resolveAppPathFrom(extractFlagValue(args, "--app"));
        if (appPath === undefined) {
          console.error(`nexo migrate check needs the app: pass --app <module> or set "app" in nexo.config.json.`);
          process.exitCode = 1;
          return;
        }
        const { app } = await loadApplication(appPath);
        const result = await migrateCheck({ ...flags, app });
        print(result, renderMigrateCheck);
        if (result.problems.length > 0) process.exitCode = 1;
        return;
      }
    }
    console.error(`${MIGRATE_USAGE}

${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (command === "doctor") {
    const target = rest[0] !== undefined && !rest[0].startsWith("--") ? rest[0] : ".";
    const report = await doctor(resolve(process.cwd(), target));
    console.log(rest.includes("--json") ? JSON.stringify(report, null, 2) : renderDoctorReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "source") {
    const projectRoot = resolve(process.cwd(), rest[0] ?? ".");
    console.log(await sourceTree(projectRoot));
    return;
  }

  if (command === "freshness") {
    const sourceRootFlag = extractFlagValue(rest, "--source-root");
    if (sourceRootFlag === undefined) {
      console.error(`"nexo freshness" requires --source-root <path>.\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    }
    const sourceRoot = resolve(process.cwd(), sourceRootFlag);
    const outFlag = extractFlagValue(rest, "--out");
    const outPath = resolve(process.cwd(), outFlag ?? ".nexo/knowledge-graph.json");
    console.log(await freshness(outPath, sourceRoot));
    return;
  }

  if (command === "inspect" && rest[0] === "resource") {
    // The second positional is the resource name, unless it's a module path.
    const positional = rest.slice(1).filter((arg) => !arg.startsWith("--"));
    const looksLikePath = (arg: string | undefined) => arg !== undefined && /\.(c|m)?js$/.test(arg);
    const name = looksLikePath(positional[0]) ? undefined : positional[0];
    const appPath = await resolveAppPathFrom(name === undefined ? positional[0] : positional[1]);
    if (appPath === undefined) {
      console.error(`No app path given and no "nexo.config.json" found.\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    }
    const { app, knowledge } = await loadApplication(appPath);
    console.log(inspectResource(app, knowledge, name, rest.includes("--json")));
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
  const summarizeFlag = extractFlagValue(rest, "--summarize");
  const entityKindFlag = extractFlagValue(rest, "--entity-kind") as IntentEntityKind | undefined;
  const entityNameFlag = extractFlagValue(rest, "--entity-name");

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
    case "intents":
      console.log(intents(app, knowledge, entityKindFlag, entityNameFlag));
      return;
    case "graph": {
      const summarize = summarizeFlag !== undefined ? await loadSummarizer(summarizeFlag) : undefined;
      console.log(await graph(app, knowledge, outPath, sourceRoot, force, summarize));
      return;
    }
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

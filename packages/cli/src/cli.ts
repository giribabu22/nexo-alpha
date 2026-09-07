#!/usr/bin/env node
import { resolve } from "node:path";
import { loadApplication } from "./load-application.js";
import { resolveConfiguredAppPath } from "./config.js";
import {
  context,
  health,
  inspect,
  knowledge as renderKnowledge,
  sourceTree,
  status,
  validate
} from "./commands.js";

const USAGE = `Usage:
  nexo init [project-name] [--template <name>]
  nexo inspect [app-module-path] [moduleName]
  nexo inspect [--module moduleName]
  nexo status [app-module-path]
  nexo context [app-module-path]
  nexo knowledge [app-module-path]
  nexo source [project-root]
  nexo validate [app-module-path]
  nexo health [app-module-path]

If app-module-path is omitted, Nexo looks for a "nexo.config.json" in the
current directory or a parent directory, with the shape:
  { "app": "./dist/app.js" }

"nexo source" is the one command that doesn't load an application — it
scans project-root's (default: cwd) actual source files, independent of
whatever is registered with NexoApplication.`;

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

  let appPath: string | undefined;
  let moduleName: string | undefined;

  const [first, second] = rest;

  if (first !== undefined && !first.startsWith("--")) {
    appPath = first;
    moduleName = second;
  } else {
    const moduleFlagIndex = rest.indexOf("--module");
    if (moduleFlagIndex !== -1) {
      moduleName = rest[moduleFlagIndex + 1];
    }

    appPath = await resolveConfiguredAppPath(process.cwd());
  }

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
      console.log(context(app, knowledge));
      return;
    case "knowledge":
      console.log(renderKnowledge(app, knowledge));
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

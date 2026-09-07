#!/usr/bin/env node
import { loadApplication } from "./load-application.js";
import { resolveConfiguredAppPath } from "./config.js";
import { context, inspect, status } from "./commands.js";

const USAGE = `Usage:
  nexo inspect [app-module-path] [moduleName]
  nexo inspect [--module moduleName]
  nexo status [app-module-path]
  nexo context [app-module-path]

If app-module-path is omitted, Nexo looks for a "nexo.config.json" in the
current directory or a parent directory, with the shape:
  { "app": "./dist/app.js" }`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === undefined) {
    console.error(USAGE);
    process.exitCode = 1;
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

  const app = await loadApplication(appPath);

  switch (command) {
    case "inspect":
      console.log(inspect(app, moduleName));
      return;
    case "status":
      console.log(status(app));
      return;
    case "context":
      console.log(context(app));
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

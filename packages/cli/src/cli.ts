#!/usr/bin/env node
import { loadApplication } from "./load-application.js";
import { context, inspect, status } from "./commands.js";

const USAGE = `Usage:
  nexo inspect <app-module-path> [moduleName]
  nexo status <app-module-path>
  nexo context <app-module-path>`;

async function main(): Promise<void> {
  const [command, appPath, arg] = process.argv.slice(2);

  if (command === undefined || appPath === undefined) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const app = await loadApplication(appPath);

  switch (command) {
    case "inspect":
      console.log(inspect(app, arg));
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

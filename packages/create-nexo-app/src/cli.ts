#!/usr/bin/env node
import * as path from "node:path";
import { createNexoApp } from "./generator.js";
import { templates, defaultTemplateName } from "./templates/index.js";

const USAGE = `create-nexo-app — Scaffold a new Nexo application

Usage:
  npx create-nexo-app <project-name> [options]

Options:
  -t, --template <name>   Template to use (default: "${defaultTemplateName}")
                          Available: fullstack-react, backend-api, minimal
  -h, --help              Show this help message

Examples:
  npx create-nexo-app my-app
  npx create-nexo-app my-service --template backend-api
  npx create-nexo-app quick-start --template minimal
  npx create-nexo-app support-bot --template agent-service
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    return;
  }

  let targetDir: string | undefined;
  let templateName: string = defaultTemplateName;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === "-t" || arg === "--template") {
      templateName = args[i + 1] || defaultTemplateName;
      i++;
    } else if (!arg.startsWith("-") && targetDir === undefined) {
      targetDir = arg;
    }
  }

  if (!targetDir) {
    console.error("Error: Please specify the project name/directory.");
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  console.log(`\n🚀 Scaffolding Nexo project in ./${targetDir}...\n`);

  try {
    const result = await createNexoApp({
      targetDir,
      templateName
    });

    console.log(`✅ Success! Created ${result.projectName} using template "${result.template.name}".\n`);
    console.log(`Next steps:\n`);
    console.log(`  cd ${targetDir}`);
    console.log(`  npm install`);
    console.log(`  npm run dev\n`);
  } catch (error: any) {
    console.error(`\n❌ Failed to scaffold project: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

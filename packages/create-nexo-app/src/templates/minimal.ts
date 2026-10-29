import { Template, TemplateFile } from "./types.js";
import { NEXO_VERSION } from "./version.js";

export const minimalTemplate: Template = {
  name: "minimal",
  description: "Minimal single-file Nexo application",
  getFiles(projectName: string): TemplateFile[] {
    return [
      {
        path: ".gitignore",
        content: `node_modules
dist
data
`
      },
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: projectName,
            version: "0.1.0",
            type: "module",
            scripts: {
              dev: "tsx watch src/index.ts",
              build: "tsc",
              start: "node dist/index.js"
            },
            dependencies: {
              "@nexo-alpha/core": NEXO_VERSION,
              "@nexo-alpha/hapi": NEXO_VERSION
            },
            devDependencies: {
              "@types/node": "^20.11.0",
              tsx: "^4.19.0",
              typescript: "^5.4.0"
            }
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              lib: ["ES2022"],
              strict: true,
              skipLibCheck: true,
              outDir: "./dist",
              rootDir: "./src"
            },
            include: ["src/**/*"]
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "src/index.ts",
        content: `import { api, field, model } from "@nexo-alpha/core";
import { serve } from "@nexo-alpha/hapi";

// Declared once: TypeScript types, validation and a REST API at /api/tasks.
const Task = model("tasks", {
  title: field.string({ minLength: 1, maxLength: 200 }),
  done: field.boolean().default(false)
});

const hello = { name: "hello", apis: [api.get("/", () => ({ message: "Hello from ${projectName}!" }))] };

// Records go to data/app.json. Port $PORT or 3000; Ctrl+C stops cleanly.
await serve({ name: "${projectName}", store: "data/app.json", resources: [Task], modules: [hello] });
`
      },
      {
        path: "README.md",
        content: `<p align="center">
  <img src="https://raw.githubusercontent.com/giribabu22/nexo-alpha/main/logo.png" alt="Nexo - The AI Application Framework" width="140">
</p>

# ${projectName}

Minimal application powered by **Nexo — The AI Application Framework**.

## Quick Start
\`\`\`bash
npm install
npm run dev
\`\`\`

\`src/index.ts\` declares a Task model; \`serve()\` stores it and serves it as a REST API:

\`\`\`bash
curl -X POST localhost:3000/api/tasks -H "content-type: application/json" -d '{"title":"Hello"}'
curl "localhost:3000/api/tasks?done=false&sort=-createdAt"
\`\`\`
`
      }
    ];
  }
};

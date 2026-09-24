import { Template, TemplateFile } from "./types.js";

export const minimalTemplate: Template = {
  name: "minimal",
  description: "Minimal single-file Nexo application",
  getFiles(projectName: string): TemplateFile[] {
    return [
      {
        path: ".gitignore",
        content: `node_modules
dist
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
              "@nexo-alpha/core": "^0.4.0",
              "@nexo-alpha/hapi": "^0.4.0"
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
        content: `import { createApplication } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";

const app = createApplication({
  name: "${projectName}",
  version: "0.1.0"
});

app.module({
  name: "core",
  apis: [
    {
      name: "root",
      method: "GET",
      path: "/",
      handler: async () => ({ message: "Hello from ${projectName}!" })
    }
  ]
});

await app.start();
const server = await startHapiServer(app, { port: 3000 });
console.log(\`Running at \${server.info.uri}\`);
`
      }
    ];
  }
};

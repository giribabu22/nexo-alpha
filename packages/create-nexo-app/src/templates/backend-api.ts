import { Template, TemplateFile } from "./types.js";

export const backendApiTemplate: Template = {
  name: "backend-api",
  description: "Standalone Nexo backend API service with Hapi, scheduler, context, and CLI support",
  getFiles(projectName: string): TemplateFile[] {
    return [
      {
        path: ".gitignore",
        content: `node_modules
dist
.env
*.log
`
      },
      {
        path: ".dockerignore",
        content: `node_modules
dist
.git
.env
*.log
`
      },
      {
        path: ".env.example",
        content: `PORT=3000
NODE_ENV=development
`
      },
      {
        path: "Dockerfile",
        content: `# Dockerfile for Nexo Backend API
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
COPY --from=builder /app/dist ./dist
RUN npm install --omit=dev

EXPOSE 3000

CMD ["node", "dist/index.js"]
`
      },
      {
        path: "README.md",
        content: `# ${projectName}

A modern backend service powered by the **Nexo** application framework.

## Getting Started

### 1. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Run Development Server
\`\`\`bash
npm run dev
\`\`\`

### 3. Build & Run Production
\`\`\`bash
npm run build
npm start

# Or via Docker
docker build -t ${projectName} .
docker run -p 3000:3000 ${projectName}
\`\`\`

## Nexo CLI

Inspect your application architecture:
\`\`\`bash
npx nexo inspect
npx nexo status
npx nexo context
\`\`\`
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
              start: "node dist/index.js",
              typecheck: "tsc --noEmit",
              inspect: "nexo inspect"
            },
            dependencies: {
              "@nexo-alpha/core": "^0.2.0",
              "@nexo-alpha/context": "^0.2.0",
              "@nexo-alpha/hapi": "^0.2.0",
              "@nexo-alpha/scheduler": "^0.2.0",
              "@nexo-alpha/tools": "^0.2.0",
              "@nexo-alpha/cli": "^0.2.0"
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
              esModuleInterop: true,
              skipLibCheck: true,
              forceConsistentCasingInFileNames: true,
              outDir: "./dist",
              rootDir: "./src",
              declaration: true
            },
            include: ["src/**/*"]
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "nexo.config.json",
        content: JSON.stringify(
          {
            app: "./dist/app.js"
          },
          null,
          2
        ) + "\n"
      },
      {
        path: "src/app.ts",
        content: `import { createApplication, type NexoService } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";

export const app = createApplication({
  name: "${projectName}",
  version: "0.1.0",
  description: "Nexo backend service"
});

export const knowledge = createKnowledge();

knowledge.addDecision({
  title: "Service Architecture",
  reason: "Modular domain structure with pure Nexo service and API definitions.",
  status: "accepted"
});

// Example Data Service (Substitute with Prisma, Drizzle, etc.)
export class StorageService implements NexoService {
  readonly name = "storage-service";
  readonly description = "In-memory key-value store";
  private store = new Map<string, any>();

  set(key: string, val: any) {
    this.store.set(key, val);
  }

  get(key: string) {
    return this.store.get(key);
  }
}

const storageService = new StorageService();

// Example Domain Module
app.module({
  name: "greeting",
  description: "Greeting and welcome module",
  services: [storageService],

  apis: [
    {
      name: "sayHello",
      method: "GET",
      path: "/hello",
      description: "Returns greeting message",
      handler: async () => ({
        message: "Hello from ${projectName}!",
        framework: "Nexo",
        timestamp: new Date().toISOString()
      })
    },
    {
      name: "sayPersonalHello",
      method: "GET",
      path: "/hello/{name}",
      description: "Returns personalized greeting",
      handler: async (request: any) => ({
        message: \`Hello, \${request.params.name}! Welcome to ${projectName}.\`,
        timestamp: new Date().toISOString()
      })
    }
  ]
});

// Health & Inspection Module
app.module({
  name: "health",
  description: "System health checks",

  apis: [
    {
      name: "checkHealth",
      method: "GET",
      path: "/health",
      description: "Service health probe",
      handler: async () => ({
        status: "ok",
        app: app.name,
        version: app.version,
        uptime: process.uptime()
      })
    }
  ]
});
`
      },
      {
        path: "src/index.ts",
        content: `import { app } from "./app.js";
import { startHapiServer } from "@nexo-alpha/hapi";

async function main() {
  await app.start();

  const PORT = Number(process.env.PORT) || 3000;
  const server = await startHapiServer(app, {
    port: PORT
  });

  console.log(\`🚀 ${projectName} server running at \${server.info.uri}\`);

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(\`\\n\${signal} received. Stopping Nexo server...\`);
    try {
      await server.stop({ timeout: 5000 });
      await app.stop();
      console.log("Nexo server stopped gracefully.");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
`
      }
    ];
  }
};

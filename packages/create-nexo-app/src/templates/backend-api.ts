import { Template, TemplateFile } from "./types.js";

export const backendApiTemplate: Template = {
  name: "backend-api",
  description: "Standalone Nexo backend API service with Hapi, context, and CLI support",
  getFiles(projectName: string): TemplateFile[] {
    return [
      {
        path: ".gitignore",
        content: `node_modules
dist
data
.env
*.log
`
      },
      {
        path: ".dockerignore",
        content: `node_modules
dist
data
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
        content: `<p align="center">
  <img src="https://raw.githubusercontent.com/giribabu22/nexo-alpha/main/logo.png" alt="Nexo - The AI Application Framework" width="140">
</p>

# ${projectName}

A modern backend service powered by **Nexo — The AI Application Framework**.

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

## Your first resource: notes

\`src/notes/\` declares a model once and serves it as a REST API, with
validation, paging, search and sorting built in. Records are stored in
\`data/app.json\` (see \`src/store.ts\`).

\`\`\`bash
curl -X POST localhost:3000/api/notes -H "content-type: application/json" -d '{"title":"Hello"}'
curl "localhost:3000/api/notes?search=hello&sort=-createdAt"
\`\`\`

Add another resource, then register it in \`src/app.ts\`:
\`\`\`bash
npx nexo generate resource invoice --no-page
\`\`\`

## Nexo CLI

Inspect your application architecture:
\`\`\`bash
npx nexo inspect
npx nexo status
npx nexo context
\`\`\`

Build a knowledge graph over your modules/APIs/services and the actual
source tree, then query it:
\`\`\`bash
npm run graph
npx nexo impact <nodeId>
npx nexo freshness --source-root src
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
              inspect: "nexo inspect",
              graph: "nexo graph --source-root src --out .nexo/knowledge-graph.json"
            },
            dependencies: {
              "@nexo-alpha/core": "^0.7.0",
              "@nexo-alpha/context": "^0.7.0",
              "@nexo-alpha/hapi": "^0.7.0",
              "@nexo-alpha/cli": "^0.7.0"
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
        content: `import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";
import { registerGreetingModule } from "./modules/greeting/index.js";
import { registerHealthModule } from "./modules/health/index.js";
import { notesResource } from "./notes/notes.api.js";
import { store } from "./store.js";

export const app = createApplication({
  name: "${projectName}",
  version: "0.1.0",
  description: "Nexo backend service"
});

export const knowledge = createKnowledge();

// 1. Architectural Decisions (ADRs)
knowledge.addDecision({
  title: "Service Architecture",
  reason: "Modular domain structure with pure Nexo service and API definitions.",
  status: "accepted"
});

knowledge.addDecision({
  title: "Decoupled Runtime Protocol",
  reason: "Nexo core remains HTTP-agnostic; network adapters (Hapi) bind to module APIs at startup.",
  status: "accepted"
});

// 2. Constraints & Invariants
knowledge.addConstraint({
  description: "Business domain logic must be encapsulated in Nexo Services, not inside route handlers",
  reason: "Ensures services are independently testable and portable across CLI, HTTP, and background jobs."
});

knowledge.addConstraint({
  description: "All endpoints must expose structured JSON with status codes",
  reason: "Maintains consistent contract consumption for frontend and external clients."
});

// 3. Entity Intents
knowledge.addIntent({
  entityKind: "service",
  entityName: "StorageService",
  purpose: "In-memory key-value data storage and cache service.",
  evidence: { file: "src/modules/greeting/service.ts", line: 5 }
});

knowledge.addIntent({
  entityKind: "module",
  entityName: "greeting",
  purpose: "Greeting domain providing parameterized hello endpoints backed by StorageService.",
  evidence: { file: "src/modules/greeting/index.ts", line: 4 }
});

knowledge.addIntent({
  entityKind: "module",
  entityName: "notes",
  purpose: "Notes CRUD API generated from the Note model.",
  evidence: { file: "src/notes/note.model.ts", line: 4 }
});

knowledge.addIntent({
  entityKind: "module",
  entityName: "health",
  purpose: "System operational health checks and live architecture knowledge introspection.",
  evidence: { file: "src/modules/health/index.ts", line: 4 }
});

// 4. Development Work State
knowledge.setDevelopmentState({
  completed: [
    "Core application initialized",
    "Modular architecture configured",
    "Hapi network adapter integrated",
    "Application knowledge journal configured"
  ],
  inProgress: [
    "Domain resources beyond notes"
  ]
});

// Each module lives in its own folder under src/modules — see that folder
// for the actual app.module({...}) registration and any services it needs.
registerGreetingModule(app);
registerHealthModule(app, knowledge);
app.module(notesResource(store));
`
      },
      {
        path: "src/store.ts",
        content: `import { createFileDocumentStore } from "@nexo-alpha/core";

/**
 * Where records are stored: one JSON file, fine for one process and modest
 * data. For more, use createSqliteDocumentStore (Node.js 22.5 or later).
 */
export const store = createFileDocumentStore(process.env.DATA_FILE ?? "data/app.json");
`
      },
      {
        path: "src/notes/note.model.ts",
        content: `import { field, model, type Infer } from "@nexo-alpha/core/model";

/** A note. Its types, validation and API all follow from this definition. */
export const Note = model("notes", {
  title: field.string({ minLength: 1, maxLength: 200 }),
  body: field.text().optional(),
  pinned: field.boolean().default(false)
});
export type Note = Infer<typeof Note>;
`
      },
      {
        path: "src/notes/notes.api.ts",
        content: `import { resource, type NexoDocumentStore } from "@nexo-alpha/core";
import { Note } from "./note.model.js";

/** CRUD API at /api/notes, e.g. GET /api/notes?pinned=true&search=hello&sort=-createdAt */
export function notesResource(store: NexoDocumentStore) {
  return resource(Note, { store, searchable: ["title", "body"] });
}
`
      },
      {
        path: "src/modules/greeting/service.ts",
        content: `import type { NexoService } from "@nexo-alpha/core";

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
`
      },
      {
        path: "src/modules/greeting/index.ts",
        content: `import type { NexoApplication } from "@nexo-alpha/core";
import { StorageService } from "./service.js";

export function registerGreetingModule(app: NexoApplication): void {
  const storageService = new StorageService();

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
}
`
      },
      {
        path: "src/modules/health/index.ts",
        content: `import type { NexoApplication } from "@nexo-alpha/core";
import type { ApplicationKnowledge } from "@nexo-alpha/context";

export function registerHealthModule(app: NexoApplication, knowledge?: ApplicationKnowledge): void {
  app.module({
    name: "health",
    description: "System health checks and knowledge introspection",

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
      },
      {
        name: "getKnowledge",
        method: "GET",
        path: "/knowledge",
        description: "Application knowledge journal, architectural decisions, and invariants",
        handler: async () => ({
          decisions: knowledge?.getDecisions() ?? [],
          constraints: knowledge?.getConstraints() ?? [],
          intents: knowledge?.getIntents() ?? [],
          developmentState: knowledge?.getDevelopmentState() ?? null
        })
      }
    ]
  });
}
`
      },
      {
        path: "src/index.ts",
        content: `import { serve } from "@nexo-alpha/hapi";
import { app } from "./app.js";

// Serves every module registered in app.ts. Port $PORT or 3000; Ctrl+C stops cleanly.
await serve({ app });
`
      }
    ];
  }
};

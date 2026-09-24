# Nexo User Guide

Welcome to the **Nexo** User Guide! This document will walk you through everything you need to know to scaffold, build, and interact with a Nexo application using `create-nexo-app`.

Nexo is a lightweight Node.js application framework built for the AI era. It introduces a modular structure composed of `Applications`, `Modules`, `APIs`, `Services`, and `Contexts`.

---

## 1. Getting Started

To create a new Nexo project, you don't need to install anything globally. You can use `npx` to fetch and run `create-nexo-app` on the fly.

### Scaffolding a New Application

Open your terminal and run the following command:

```bash
npx create-nexo-app my-new-app
```

This will run an interactive prompt (or immediately generate a project) to scaffold a fullstack React + Nexo application in the `my-new-app` directory.

### Available Templates

`create-nexo-app` supports different starting points depending on your needs. You can specify a template using the `-t` or `--template` flag:

1. **Fullstack React (Default)**
   ```bash
   npx create-nexo-app my-fullstack-app -t fullstack-react
   ```
   Generates a monorepo containing a Nexo backend API and a React (Vite) frontend. Best for building complete web applications.

2. **Backend API**
   ```bash
   npx create-nexo-app my-backend-api -t backend-api
   ```
   Generates a standalone Nexo backend service with modular architecture (Hapi adapter, scheduler, context). Perfect for microservices or headless APIs.

3. **Minimal**
   ```bash
   npx create-nexo-app my-minimal-app -t minimal
   ```
   Generates a single-file Nexo application. Ideal for learning the core framework concepts or creating tiny scripts.

---

## 2. Running Your Application

Once your project is scaffolded, navigate into the directory and install dependencies:

```bash
cd my-new-app
npm install
```

### Development Mode

Start the development server with live-reloading:

```bash
npm run dev
```

- If you used the **fullstack-react** template, this will start both the backend on `http://localhost:4000` and the React frontend on `http://localhost:5173`.
- If you used the **backend-api** template, the server will start on `http://localhost:3000`.

### Production Build

To build your application for production:

```bash
npm run build
npm start
```

For the fullstack and backend templates, a `Dockerfile` is also included, allowing you to instantly containerize your app:

```bash
docker build -t my-new-app .
docker run -p 3000:3000 my-new-app
```

---

## 3. Project Structure

A typical Nexo backend application (e.g., from the `backend-api` template) looks like this:

```text
my-new-app/
├── src/
│   ├── modules/          # Your application modules (greeting, health, etc.)
│   │   ├── greeting/
│   │   │   ├── index.ts  # Module registration & API definitions
│   │   │   └── service.ts# Business logic & state management
│   │   └── health/
│   │       └── index.ts
│   ├── app.ts            # Core Nexo application & knowledge definition
│   └── index.ts          # Server entry point (starts Hapi server)
├── nexo.config.json      # Configuration for the Nexo CLI
├── package.json
└── tsconfig.json
```

If you use the `fullstack-react` template, the project is structured as a monorepo containing `backend/` and `frontend/` workspaces:

```text
my-fullstack-app/
├── backend/              # Nexo backend architecture (same as above)
│   ├── src/index.ts      # Boots up Nexo & Hapi.js server
│   └── package.json
├── frontend/             # React + Vite frontend application
│   ├── src/
│   │   ├── App.tsx       # Main React component, fetches from Hapi.js API
│   │   └── main.tsx      # React DOM root
│   ├── vite.config.ts    # Proxies /api requests to the backend
│   └── package.json
└── package.json          # Root workspace configuration
```

### Core Concepts

- **Modules (`app.module()`)**: Logical boundaries grouping APIs and Services (e.g., `greeting` module, `payments` module).
- **APIs**: Route definitions (`method`, `path`, `handler`) declared directly on a module. Nexo APIs are framework-agnostic but are seamlessly exposed over HTTP via **Hapi.js**.
- **Services (`NexoService`)**: Classes containing business logic, database access, and state. Services are attached to modules.
- **Context (`ApplicationContext`)**: A serialized manifest of your application structure that tooling and AI can read.

### Fullstack React Integration

In the `fullstack-react` template, the frontend is a **React 18** application built with **Vite**. 
It is configured to work harmoniously with the Nexo backend:
- **Vite Proxy**: `vite.config.ts` automatically proxies `/api` requests to the Nexo/Hapi.js backend running on port 4000.
- **React Components**: The frontend calls backend APIs directly (e.g., `fetch('/api/todos')`) while development servers run concurrently.

### Hapi.js Backend Integration

Nexo is completely decoupled from HTTP by default. To actually serve your APIs, the templates use **`@nexo-alpha/hapi`**.
- The HTTP server is booted in `src/index.ts` using `startHapiServer(app, { port: 4000 })`.
- Hapi handles the underlying HTTP routing, parsing, and payload validation based directly on your Nexo module API definitions.

---

## 4. The Nexo CLI

Nexo includes a powerful CLI (`@nexo-alpha/cli`) to inspect and manage your application's architecture. 

In your generated project, you can run these commands via `npx` or npm scripts:

### Inspect Application Architecture
See a high-level overview of your application, modules, APIs, and services.
```bash
npx nexo inspect
```

### Check Development Status
View decisions, constraints, and the development roadmap.
```bash
npx nexo status
```

### Knowledge Graph
Nexo can generate an architectural knowledge graph linking source files, modules, and APIs together.
```bash
npm run graph
```
Once the graph is generated, you can query it. For instance, to see what depends on a specific node:
```bash
npx nexo impact <nodeId>
```
To check which files have changed since the graph was last built:
```bash
npx nexo freshness --source-root src
```

---

## 5. Next Steps

- **Add a new Module**: Create a new folder in `src/modules`, define an `index.ts` that calls `app.module(...)`, and register it in `src/app.ts`.
- **Add a Database**: Implement a new class implementing `NexoService` (e.g., `DatabaseService`) inside a module to connect to Postgres, Mongo, etc.
- **Explore the API**: Nexo is completely decoupled from HTTP out-of-the-box. Your APIs in `app.module()` are adapted to HTTP automatically by `@nexo-alpha/hapi`.

Happy building with Nexo!

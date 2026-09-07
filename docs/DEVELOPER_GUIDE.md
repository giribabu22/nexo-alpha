# Nexo Developer Handbook & Guide

Welcome to **Nexo** — the lightweight, modular application framework built for modern TypeScript engineering and AI-driven software development.

---

## Table of Contents
1. [Core Concepts](#1-core-concepts)
2. [Quick Start](#2-quick-start)
3. [Building APIs & Routing](#3-building-apis--routing)
4. [Services & Database Integration](#4-services--database-integration)
5. [Scheduling Background Jobs](#5-scheduling-background-jobs)
6. [Architectural Knowledge & Decisions](#6-architectural-knowledge--decisions)
7. [AI-Era Tooling & Introspection](#7-ai-era-tooling--introspection)
8. [Production Deployment & Docker](#8-production-deployment--docker)

---

## 1. Core Concepts

Nexo organizes backend applications into a clear, decoupled hierarchy:

- **`NexoApplication`**: Root application container managing lifecycle (`start()`, `stop()`), registered modules, and system state.
- **`NexoModule`**: A domain-driven feature boundary (e.g. `users`, `billing`, `orders`).
- **`NexoService`**: Encapsulates stateful logic, database connections (Prisma, Drizzle, Mongoose), and business rules.
- **`NexoApi`**: Declarative HTTP endpoint definitions (`GET`, `POST`, `PUT`, `DELETE`) with route handlers.
- **`NexoJob`**: Declarative background cron jobs managed by `@nexo-alpha/scheduler`.
- **`Knowledge`**: Captures architectural decisions (`Decisions`) and constraints (`Constraints`) directly in the codebase.

---

## 2. Quick Start

### Create a New Project
```bash
# Full-stack with React + Vite frontend and Nexo backend
npx create-nexo-app my-app --template fullstack-react

# Or standalone backend service
npx create-nexo-app my-service --template backend-api
```

### Project Structure
```
my-app/
├── backend/
│   ├── src/
│   │   ├── app.ts          # Modules, Services, and APIs
│   │   └── index.ts        # Server entrypoint & lifecycle
│   ├── tsconfig.json
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.tsx         # React UI
    │   └── main.tsx
    └── vite.config.ts
```

---

## 3. Building APIs & Routing

Define APIs on any module declaratively:

```typescript
import { createApplication } from "@nexo-alpha/core";

export const app = createApplication({
  name: "order-service",
  version: "1.0.0"
});

app.module({
  name: "orders",
  description: "Customer orders module",
  apis: [
    {
      name: "getOrder",
      method: "GET",
      path: "/api/orders/{id}",
      description: "Retrieve order by ID",
      handler: async (request) => {
        const orderId = request.params.id;
        return { orderId, status: "completed", total: 49.99 };
      }
    },
    {
      name: "createOrder",
      method: "POST",
      path: "/api/orders",
      description: "Place a new order",
      handler: async (request) => {
        const payload = request.payload as { item: string; qty: number };
        return { id: Date.now(), item: payload.item, qty: payload.qty, status: "created" };
      }
    }
  ]
});
```

---

## 4. Services & Database Integration

Encapsulate database connections (e.g. Prisma, Drizzle, MongoDB) inside `NexoService` subclasses:

```typescript
import { NexoService } from "@nexo-alpha/core";

export class DatabaseService extends NexoService {
  constructor() {
    super({ name: "database-service" });
  }

  // Simulated DB connection (or prisma.$connect())
  async onStart() {
    console.log("Connecting to Database...");
  }

  async onStop() {
    console.log("Disconnecting from Database...");
  }

  async findUser(id: string) {
    return { id, name: "Alice", email: "alice@example.com" };
  }
}

const dbService = new DatabaseService();

app.module({
  name: "users",
  services: [dbService],
  apis: [
    {
      name: "getUser",
      method: "GET",
      path: "/users/{id}",
      handler: async (req) => dbService.findUser(req.params.id)
    }
  ]
});
```

---

## 5. Scheduling Background Jobs

Use `@nexo-alpha/scheduler` for cron-based recurring tasks:

```typescript
import { createCronScheduler } from "@nexo-alpha/scheduler";

app.module({
  name: "analytics",
  jobs: [
    {
      name: "dailyRollup",
      cron: "0 0 * * *", // Every midnight
      description: "Calculate daily revenue metrics",
      handler: async () => {
        console.log("Running daily metrics calculation...");
      }
    }
  ]
});

// Start the scheduler
const scheduler = createCronScheduler(app);
await scheduler.start();
```

---

## 6. Architectural Knowledge & Decisions

Record why design decisions were made so human teammates and AI agents understand the codebase context:

```typescript
import { createKnowledge } from "@nexo-alpha/context";

export const knowledge = createKnowledge();

knowledge.addDecision({
  title: "Use Redis for Session Caching",
  reason: "Required sub-millisecond session validation under heavy read traffic.",
  status: "accepted"
});
```

---

## 7. AI-Era Tooling & Introspection

Nexo provides native inspection tools for both humans and AI coding assistants:

```bash
# Human inspection
npx nexo inspect
npx nexo status
npx nexo health

# Dump full architectural JSON context (ideal for piping to AI agents/LLMs)
npx nexo context > .nexo-context.json
```

---

## 8. Production Deployment & Docker

Every generated Nexo application includes a multi-stage `Dockerfile`:

```bash
# Build the container
docker build -t my-nexo-app .

# Run in production
docker run -p 4000:4000 -e NODE_ENV=production my-nexo-app
```

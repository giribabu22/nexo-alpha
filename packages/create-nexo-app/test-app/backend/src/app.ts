import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";
import { createDscCollector, createDscInterceptor } from "@nexo-alpha/behavior";
import { registerTodosModule } from "./modules/todos/index.js";
import { registerSystemModule } from "./modules/system/index.js";

export const app = createApplication({
  name: "test-app-backend",
  version: "0.1.0",
  description: "Nexo backend service"
});

export const knowledge = createKnowledge();

// 1. Architectural Decisions (ADRs)
knowledge.addDecision({
  title: "Fullstack Architecture",
  reason: "Separation of pure Nexo backend business logic and React frontend layer.",
  status: "accepted"
});

knowledge.addDecision({
  title: "Client-Server Contract",
  reason: "Communicate via typed REST API endpoints under /api with unified JSON envelopes.",
  status: "accepted"
});

// 2. Constraints & Invariants
knowledge.addConstraint({
  description: "Frontend must interact with backend purely through documented REST endpoints under /api",
  reason: "Ensures headless decoupling and clear boundaries between client and server."
});

knowledge.addConstraint({
  description: "No secret keys, tokens, or backend credentials may be bundled into client assets",
  reason: "Prevents leaking sensitive infrastructure and credential data into browser bundles."
});

// 3. Component & Entity Intents (Explains the 'why' of UI components)
knowledge.addIntent({
  entityKind: "component",
  entityName: "Header",
  purpose: "Brand banner displaying application metadata and gradient typography.",
  evidence: { file: "frontend/src/components/Header.tsx", line: 3 }
});

knowledge.addIntent({
  entityKind: "component",
  entityName: "ServerStatus",
  purpose: "Real-time heartbeat monitor displaying backend health, active modules, and uptime.",
  evidence: { file: "frontend/src/components/ServerStatus.tsx", line: 3 }
});

knowledge.addIntent({
  entityKind: "component",
  entityName: "TodoApp",
  purpose: "Interactive fullstack task management demonstrating reactive state and Nexo API calls.",
  evidence: { file: "frontend/src/components/TodoApp.tsx", line: 3 }
});

knowledge.addIntent({
  entityKind: "component",
  entityName: "KnowledgeInspector",
  purpose: "Live browser introspection of Nexo architectural decisions, invariants, and component intents.",
  evidence: { file: "frontend/src/components/KnowledgeInspector.tsx", line: 3 }
});

knowledge.addConstraint({
  description: "Modules must explicitly declare dependencies to ensure traceable acyclic DAGs and dependents",
  reason: "Allows Nexo runtime and tooling to validate initialization order and resolve dependents."
});

// 4. Development Work State
knowledge.setDevelopmentState({
  completed: [
    "Core application scaffold",
    "Nexo backend Hapi server integration",
    "React + Vite frontend workspace",
    "Live Nexo Knowledge & Architecture Inspector",
    "Inter-module dependency & dependent resolution"
  ],
  inProgress: [
    "Custom business module implementation"
  ]
});

// DSC (Deterministic State & Computation) Instrumentation Tap
export const dscCollector = createDscCollector();
export const dscInterceptor = createDscInterceptor(dscCollector);

// Each module lives in its own folder under src/modules — see that folder
// for the actual app.module({...}) registration and any services it needs.
registerSystemModule(app, knowledge, dscInterceptor);
registerTodosModule(app, dscInterceptor);



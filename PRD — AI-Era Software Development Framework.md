# Product Requirements Document
## AI-Era Software Development Framework

**Version:** 0.1  
**Status:** Product Definition / Architecture Direction  
**Primary Runtime:** Node.js  
**HTTP Foundation:** Hapi.js  
**AI Dependency:** None in the framework core

---

# 1. Executive Summary

We are building a new generation of lightweight software framework for the AI era.

The goal is **not** to build another AI coding assistant, code generator, IDE, or LLM.

The goal is to build the **software development environment and application framework that allows AI development tools to work effectively with real software projects.**

Modern AI tools are increasingly capable of writing code. However, software development is much larger than writing code.

An AI development tool needs to understand:

- what the project is
- how the application is structured
- what each part does
- why a function or API exists
- what depends on it
- what the developer is currently working on
- what has already been completed
- what is incomplete
- what decisions have been made
- what constraints exist
- what can safely be changed
- how to test a change
- how to verify that the application still works

Most existing frameworks were designed primarily for **human developers**. They provide conventions for building applications, but they do not provide a standardized environment through which AI development tools can reliably understand and operate those applications.

This project addresses that gap.

The framework will provide a lightweight application architecture, structured application context, standardized capabilities, lifecycle management, security, validation, observability, and interfaces that AI development tools can use.

The central philosophy is:

> **We are building the application environment for the AI era—not another AI coding tool.**

---

# 2. The Core Problem

## 2.1 Software development has changed

Traditional software development looked roughly like:

```text
Developer
    ↓
Framework
    ↓
Application
    ↓
Users
```

The developer understood the project and used the framework as a tool.

The AI era introduces another participant:

```text
Developer
    ↓
AI Development Tool
    ↓
Application
    ↓
Users
```

The AI development tool now needs to understand and modify an application.

But most applications expose their knowledge primarily through source code.

That creates a fundamental problem.

---

# 3. Code Is Not the Whole Application

Consider a function:

```text
processPayment()
```

The source code can tell an AI:

- what parameters it accepts
- what it returns
- what functions it calls
- what libraries it uses

But it may not tell the AI:

- why the function exists
- which business requirement created it
- why it was implemented this way
- what alternatives were rejected
- which APIs depend on it
- whether it is safe to modify
- whether another developer is currently working on it
- whether part of its behavior is temporary
- what problem a strange-looking workaround solves

The missing information is **application knowledge**.

Therefore:

> **Our framework must treat application knowledge as a first-class part of software development.**

---

# 4. Product Vision

## Build an environment where software can explain itself to AI development tools.

An application built with the framework should expose structured information about:

```text
Application
│
├── Structure
│   ├── Modules
│   ├── APIs
│   ├── Services
│   ├── Components
│   ├── Data
│   ├── Events
│   └── Jobs
│
├── Knowledge
│   ├── Purpose
│   ├── Requirements
│   ├── Decisions
│   ├── Constraints
│   └── Relationships
│
├── State
│   ├── Current Work
│   ├── Completed Work
│   ├── In Progress
│   ├── Blocked
│   └── Planned
│
├── History
│   ├── Changes
│   ├── Decisions
│   └── Development Context
│
└── Capabilities
    ├── Inspect
    ├── Modify
    ├── Test
    ├── Validate
    └── Operate
```

This information becomes the foundation for AI-assisted development.

---

# 5. Product Thesis

Our fundamental thesis is:

> **The next generation of software frameworks should not only help developers build applications. They should make applications understandable and operable by AI development tools.**

We are therefore designing around three participants:

```text
              Human Developer
                    │
                    ▼
             AI Development Tool
                    │
                    ▼
        ┌─────────────────────────┐
        │ AI-Era Framework        │
        │                         │
        │ Context                 │
        │ Structure               │
        │ Capabilities            │
        │ Security                │
        │ Lifecycle               │
        └────────────┬────────────┘
                     │
                     ▼
                Application
```

The framework sits between the development tool and the application.

---

# 6. What We Are NOT Building

This distinction is critical.

## We are not building:

### 6.1 An AI code generator

The framework itself does not need to generate application code.

### 6.2 A replacement for AI coding assistants

We should support many AI development tools rather than compete with every AI coding assistant.

### 6.3 An LLM runtime

The core framework must not require OpenAI, Anthropic, Google, or another AI provider.

### 6.4 An AI-only framework

Human developers must be able to use the framework normally.

### 6.5 A closed ecosystem

Developers must be free to use other npm packages, databases, AI tools, IDEs, infrastructure, and services.

### 6.6 A framework that locks developers into one technology

The application model should remain more important than individual implementation technologies.

---

# 7. Product Goals

## Primary Goals

### Goal 1 — Make applications understandable

AI tools should be able to discover application structure without blindly reading an entire repository.

### Goal 2 — Preserve development knowledge

The project should be able to preserve:

- intent
- decisions
- constraints
- requirements
- current work
- unfinished work
- important history

### Goal 3 — Give AI tools structured capabilities

AI tools should have standardized ways to:

- inspect
- understand
- plan
- modify
- test
- validate
- operate

applications.

### Goal 4 — Make operations safe

AI should not receive unlimited authority.

The framework should provide permissions, validation, boundaries, and auditable operations.

### Goal 5 — Remain lightweight

The framework should introduce as little unnecessary complexity as possible.

### Goal 6 — Remain developer-friendly

Everything available to AI should also make sense to human developers.

### Goal 7 — Support existing technology

The framework should work with the Node.js ecosystem rather than attempting to replace it.

---

# 8. Target Users

## 8.1 Human Developers

Developers building:

- APIs
- SaaS applications
- websites
- internal systems
- automation systems
- backend services
- AI applications
- business applications

They need a simple and predictable framework.

---

## 8.2 AI Development Tools

Examples include:

- coding agents
- IDE AI assistants
- repository agents
- autonomous development systems
- internal engineering agents
- future AI software engineering tools

They need structured access to application information and capabilities.

---

## 8.3 Engineering Teams

Teams need:

- shared understanding
- architectural consistency
- development history
- safer AI-assisted changes
- easier onboarding
- maintainability

---

# 9. Core Product Model

The framework should define a clear application model.

```text
Application
│
├── Modules
│
├── APIs
│
├── Services
│
├── Components
│
├── Data
│
├── Events
│
├── Jobs
│
├── Policies
│
├── Integrations
│
├── Configuration
│
├── Permissions
│
└── Application Context
```

These are not merely folders.

They are concepts that can be described to humans and machines.

---

# 10. Application Context

Application Context is one of the most important concepts in the project.

It provides structured information about the application.

Conceptually:

```text
Application Context
│
├── Identity
│   ├── Name
│   ├── Description
│   └── Version
│
├── Architecture
│   ├── Modules
│   ├── APIs
│   ├── Services
│   └── Dependencies
│
├── Business Context
│   ├── Domains
│   ├── Requirements
│   └── Rules
│
├── Development Context
│   ├── Current Work
│   ├── TODO
│   ├── Blockers
│   └── Planned Work
│
├── Decisions
│
├── Constraints
│
├── History
│
└── Capabilities
```

The context should be machine-readable.

It may also be rendered into human-readable documentation.

---

# 11. The Application Should Be Self-Describing

A major product principle:

> **An application should be able to describe itself without requiring an AI to infer everything from source code.**

For example:

```text
Application: Commerce Platform

Domain:
E-commerce

Modules:
- Users
- Products
- Orders
- Payments
- Shipping

Current Work:
Payment Recovery

Status:
Retry API complete.
Retry worker incomplete.

Important Decision:
Payment records are immutable.

Constraint:
Failed permanent payment declines must not be retried.

Dependencies:
Payments → Stripe
Jobs → Redis
Database → PostgreSQL
```

This becomes useful to:

- developers
- AI tools
- documentation systems
- debugging tools
- onboarding systems
- future development agents

---

# 12. Development State

The framework should provide a standardized way to record where development currently stands.

For example:

```text
Development State

Current objective:
Implement payment recovery.

Completed:
✓ Payment retry model
✓ Retry API
✓ Retry scheduling

In progress:
○ Retry worker

Blocked:
○ Webhook reconciliation

Known issue:
Webhook may arrive before retry state is persisted.

Next step:
Resolve webhook ordering.
```

This solves a major problem in AI-assisted development:

> **AI should not have to rediscover the project's current state every time it starts working.**

---

# 13. Intent

Code should be associated with purpose where useful.

For example:

```text
API:
POST /payments/retry

Purpose:
Retry transient payment failures.

Business reason:
Customers should not need to manually restart payments
when a temporary provider failure occurs.

Constraint:
Permanent declines must never be retried.
```

The framework does not need to force developers to document every line.

The goal is to capture **important application-level knowledge**, not create documentation bureaucracy.

---

# 14. Architectural Decisions

The project should support lightweight architectural decision records.

Example:

```text
Decision:
Use Redis for job coordination.

Reason:
Multiple application instances require shared job state.

Alternatives considered:
Database-backed queue.

Why rejected:
Higher database contention for this workload.

Status:
Accepted
```

This gives AI development tools historical reasoning.

---

# 15. Application Relationships

The framework should make dependencies discoverable.

Example:

```text
Order API
    ↓
Order Service
    ↓
Payment Service
    ↓
Stripe Integration
```

AI should be able to ask:

> “What will be affected if I change Payment Service?”

The system should be able to provide a dependency graph.

```text
Payment Service
│
├── Order Service
├── Payment API
├── Retry Worker
├── Stripe Integration
└── Payment Events
```

This is critical for safe AI-assisted development.

---

# 16. AI Development Interface

The framework should provide a standardized interface for AI development tools.

Conceptually:

```text
AI Development Tool
        │
        ▼
Application Interface
        │
        ├── Understand
        ├── Inspect
        ├── Plan
        ├── Change
        ├── Test
        ├── Validate
        └── Operate
```

The exact protocol can be decided later.

The important requirement is that AI should interact with the application through **structured capabilities**, not only raw file manipulation.

---

# 17. Understand Capabilities

AI tools should be able to request:

```text
get_application()
get_modules()
get_module()
get_api()
get_service()
get_dependencies()
get_configuration()
get_architecture()
get_decisions()
get_constraints()
get_current_work()
get_history()
```

Example:

```text
AI:
"What is the Payments module?"

Framework:
- Purpose
- APIs
- Services
- Data
- Dependencies
- Events
- Policies
- Current work
- Constraints
```

---

# 18. Development Capabilities

AI tools may eventually be able to perform structured operations such as:

```text
create_module()
create_api()
modify_api()
create_service()
modify_service()
create_test()
update_configuration()
add_dependency()
```

These operations should not bypass normal application rules.

They should pass through:

```text
Request
  ↓
Permission Check
  ↓
Validation
  ↓
Operation
  ↓
Tests / Verification
  ↓
Audit
```

---

# 19. Verification Capabilities

AI development tools should be able to request:

```text
run_tests()
run_typecheck()
run_lint()
run_build()
validate_configuration()
validate_architecture()
inspect_dependencies()
check_application_health()
```

This allows AI to work through a complete development loop:

```text
Understand
    ↓
Plan
    ↓
Change
    ↓
Test
    ↓
Validate
    ↓
Review
    ↓
Record
```

---

# 20. Safe AI Operations

AI must not automatically receive unlimited access.

The framework should support permissions such as:

```text
Read Application Context       ✓
Read Source                    ✓
Modify Source                  Permission Required
Modify Configuration           Permission Required
Install Package                Permission Required
Run Database Migration         Permission Required
Deploy Application             Restricted
Production Operations          Highly Restricted
```

The exact permission system will evolve.

The principle should not.

> **AI capabilities must be explicit, bounded, and auditable.**

---

# 21. Framework Architecture

The initial architecture:

```text
                    AI Development Tools
                            │
                            ▼
                 AI/Application Interface
                            │
                            ▼
                    Application Context
                            │
                            ▼
                  Application Runtime
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
       Modules            APIs             Services
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                       Hapi.js
                            │
                         Node.js
```

Hapi.js is the HTTP/runtime foundation.

Our framework becomes the layer above it.

---

# 22. Why Hapi.js?

Hapi.js can provide the underlying HTTP capabilities while our framework focuses on the larger application-development model.

The framework should use Hapi.js for foundational capabilities such as:

- HTTP server
- routing
- request lifecycle
- server plugins
- request handling
- integration with validation and middleware-like lifecycle concepts

Our framework should not attempt to reinvent HTTP infrastructure unnecessarily.

Architecture:

```text
Our Framework
      ↓
Hapi.js
      ↓
Node.js
```

This keeps the core lightweight while allowing us to focus our engineering effort on the AI-era development model.

---

# 23. Framework Principles

## Lightweight

Minimal dependencies and minimal magic.

## Explicit

The application should be understandable from its structure.

## Modular

Features should be independently usable.

## Secure by default

Common unsafe patterns should be difficult to introduce accidentally.

## AI-compatible

AI development tools should have structured access to application context and capabilities.

## Human-first

AI compatibility must not make normal development unpleasant.

## Tool-independent

The framework should not require a specific AI vendor.

## Technology-flexible

Developers should be able to replace underlying tools where practical.

## Observable

Important application operations should be discoverable and traceable.

## Extensible

Plugins and integrations should be possible without modifying the framework core.

---

# 24. Project Structure

A framework-based application may look like:

```text
my-app/
│
├── src/
│   ├── app.ts
│   │
│   └── modules/
│       ├── users/
│       │   ├── api/
│       │   ├── services/
│       │   ├── data/
│       │   ├── policies/
│       │   └── index.ts
│       │
│       ├── orders/
│       └── payments/
│
├── context/
│   ├── application
│   ├── decisions
│   ├── requirements
│   └── development
│
├── config/
│
├── tests/
│
├── framework.config.ts
│
└── package.json
```

The exact structure is an implementation decision and should remain flexible.

---

# 25. Framework Repository

The framework itself may eventually be organized as:

```text
framework/
│
├── packages/
│   ├── core/
│   ├── cli/
│   ├── hapi/
│   ├── config/
│   ├── validation/
│   ├── errors/
│   ├── logger/
│   ├── context/
│   ├── permissions/
│   ├── testing/
│   └── ai-interface/
│
├── examples/
├── docs/
├── tests/
├── benchmarks/
└── tooling/
```

However, we should avoid creating many packages prematurely.

The initial implementation should remain small.

---

# 26. CLI

The CLI should be the primary developer interface.

Initial commands may include:

```text
framework create <app>
framework dev
framework build
framework start
framework test
framework validate
framework inspect
framework context
framework status
```

Potential future commands:

```text
framework architecture
framework decisions
framework dependencies
framework capabilities
framework ai
```

---

# 27. Example Developer Workflow

A developer starts:

```text
framework create shop
```

Then:

```text
framework dev
```

They build the application normally.

Later they stop working.

The application records:

```text
Current Work:
Checkout redesign

Completed:
- Checkout API
- Cart validation

Incomplete:
- Payment confirmation
- Error handling

Next Step:
Implement payment confirmation.
```

The next day, the developer or AI development tool can inspect:

```text
framework status
```

and immediately understand where development stopped.

---

# 28. AI Development Workflow

An AI development tool connects to the application.

### Step 1 — Understand

```text
"What is this project?"
```

Framework returns:

```text
Application identity
Architecture
Modules
Technologies
Current state
Important constraints
```

### Step 2 — Investigate

```text
"What is the Payments module?"
```

Framework returns structured information.

### Step 3 — Understand impact

```text
"What happens if I change PaymentService?"
```

Framework returns dependency information.

### Step 4 — Plan

AI creates:

```text
Change Plan
1. Modify PaymentService
2. Update retry policy
3. Update affected API
4. Add tests
5. Run validation
```

### Step 5 — Execute

AI performs permitted operations.

### Step 6 — Verify

```text
Tests
Type checking
Lint
Build
Architecture validation
```

### Step 7 — Record

The framework records relevant development state and decisions.

---

# 29. The Development Loop

Our framework should optimize this loop:

```text
┌──────────────┐
│ Understand   │
└──────┬───────┘
       ↓
┌──────────────┐
│ Investigate  │
└──────┬───────┘
       ↓
┌──────────────┐
│ Plan         │
└──────┬───────┘
       ↓
┌──────────────┐
│ Change       │
└──────┬───────┘
       ↓
┌──────────────┐
│ Test         │
└──────┬───────┘
       ↓
┌──────────────┐
│ Validate     │
└──────┬───────┘
       ↓
┌──────────────┐
│ Record       │
└──────┬───────┘
       │
       └──────────────→ Understand
```

This is the **AI-era software development lifecycle** we are designing for.

---

# 30. Existing Projects

A major long-term goal is to avoid making this useful only for applications created by our framework.

Existing applications should eventually be able to adopt the context system.

For example:

```text
Existing Node.js Project
        │
        ▼
Context Discovery
        │
        ├── Detect APIs
        ├── Detect modules
        ├── Detect dependencies
        ├── Detect services
        └── Build application map
        │
        ▼
Application Context
        │
        ▼
AI Development Tools
```

This greatly increases the potential usefulness of the project.

---

# 31. Technology Independence

The framework must separate:

### Application knowledge

from:

### Implementation technology

For example:

```text
Application:

Payment System

Purpose:
Process customer payments.

Provider:
Stripe

Runtime:
Node.js

HTTP:
Hapi

Database:
PostgreSQL
```

If Hapi is later replaced:

```text
HTTP:
Fastify
```

the application's business knowledge remains.

Therefore:

> **Application context should survive technology changes.**

---

# 32. Security Requirements

The framework should establish strong defaults around:

- input validation
- authentication interfaces
- authorization
- permission checks
- request limits
- timeout handling
- error sanitization
- secret management
- safe logging
- dependency management
- auditability

For AI operations specifically:

```text
AI Request
    ↓
Identity
    ↓
Permission
    ↓
Context Boundary
    ↓
Validation
    ↓
Operation
    ↓
Audit
```

---

# 33. Error Model

Errors should be structured.

Instead of only:

```text
Something went wrong.
```

The framework should provide concepts such as:

```text
Error Code
Message
HTTP Status
Category
Context
Safe Details
Debug Details
```

This helps:

- developers
- logs
- monitoring
- tests
- AI tools

---

# 34. Observability

The framework should support:

- structured logging
- request IDs
- application health
- lifecycle events
- error tracking hooks
- metrics integration
- tracing integration

AI tools should eventually be able to inspect operational information safely.

For example:

```text
Why is this API failing?

→ Recent errors
→ affected module
→ dependency
→ configuration
→ recent changes
```

---

# 35. Performance Philosophy

The framework must remain lightweight.

Requirements:

- minimal mandatory dependencies
- avoid unnecessary runtime abstractions
- lazy loading where appropriate
- efficient context loading
- efficient startup
- efficient request processing
- horizontal scalability
- optional features rather than mandatory features

The AI/context layer must not make every application request slower.

Application runtime and development context should be separated where possible.

---

# 36. Core vs Optional AI Layer

This is an important architecture decision.

The framework core should work without AI.

```text
                AI Tools
                   │
             Optional Layer
                   │
        ─────────────────────
                   │
            Framework Core
                   │
                Hapi.js
                   │
                Node.js
```

A developer should be able to build and deploy:

```text
Node.js
+
Framework
+
Hapi
```

without:

- an LLM
- an AI provider
- an AI SDK
- an AI account

This keeps the framework reliable and vendor-neutral.

---

# 37. MVP

The first version should **not attempt to solve everything**.

## MVP objective

Create the minimum viable AI-era application environment.

### MVP includes:

#### Framework runtime

- Node.js runtime
- Hapi integration
- application lifecycle
- module system
- configuration
- errors
- validation
- logging

#### Application structure

- application
- modules
- APIs
- services
- dependencies

#### Context

- application manifest
- module metadata
- API metadata
- dependency information
- development status
- basic decisions
- basic constraints

#### CLI

```text
create
dev
build
start
test
inspect
context
status
```

#### AI interface foundation

Provide a machine-readable interface for:

```text
Understand
Inspect
Status
Dependencies
Capabilities
```

Do not attempt autonomous code generation in MVP.

---

# 38. MVP Success Criteria

The MVP is successful when a developer can:

1. Create an application.
2. Define a module.
3. Define an API.
4. Implement business logic.
5. Run the application.
6. Validate requests.
7. Run tests.
8. Inspect the application's architecture.
9. Record development state.
10. Record important decisions.
11. Give an AI development tool structured access to the application.
12. Allow that AI tool to understand the project without reading the entire repository blindly.

---

# 39. Phase Roadmap

## Phase 1 — Foundation

Build:

- repository
- TypeScript setup
- Node.js runtime
- Hapi integration
- CLI
- application lifecycle
- configuration
- logging
- errors

---

## Phase 2 — Application Model

Build:

- modules
- APIs
- services
- components
- dependencies
- events
- jobs

---

## Phase 3 — Context

Build:

- application manifest
- module metadata
- API metadata
- dependency graph
- decisions
- constraints
- development state

---

## Phase 4 — AI Interface

Build standardized capabilities for:

- application discovery
- architecture inspection
- context retrieval
- status retrieval
- dependency analysis
- capability discovery

---

## Phase 5 — Safe Development Operations

Introduce:

- permissions
- structured modifications
- validation
- testing
- audit
- operation boundaries

---

## Phase 6 — Developer Experience

Improve:

- CLI
- debugging
- documentation
- testing
- local development
- project inspection

---

## Phase 7 — Scalability

Add optional support for:

- queues
- workers
- events
- caching
- distributed applications
- horizontal scaling

---

## Phase 8 — Observability

Add integrations for:

- metrics
- tracing
- monitoring
- health
- diagnostics

---

## Phase 9 — Existing Project Support

Develop tooling to introduce application context into existing projects.

Potential targets:

```text
Node.js
Express
Hapi
Fastify
NestJS
Next.js
```

The exact compatibility list should be evaluated later.

---

## Phase 10 — Ecosystem

Develop:

- plugins
- integrations
- AI tool adapters
- documentation
- community tooling
- production standards

---

# 40. Success Metrics

The project should ultimately measure whether it makes AI-assisted development better.

Potential metrics:

### Understanding

How quickly can an AI tool understand an unfamiliar application?

### Context efficiency

How much less raw source code must an AI tool inspect?

### Development accuracy

How often does an AI make a correct change without unnecessary modifications?

### Change safety

How often do AI-assisted changes pass validation and tests?

### Onboarding

How quickly can a new developer understand an existing project?

### Recovery

How easily can an AI or developer determine where previous development stopped?

### Explainability

Can the system answer:

> Why does this exist?

for important application components?

### Impact analysis

Can the system identify what will be affected by a proposed change?

These metrics should be tested experimentally rather than assuming the framework automatically improves them.

---

# 41. Major Risks

## Risk 1 — Too much metadata

If developers must document everything manually, the framework becomes burdensome.

**Response:** Capture structural information automatically and require explicit human input only for high-value knowledge.

---

## Risk 2 — Framework becomes too complicated

Trying to solve every AI development problem could create a massive framework.

**Response:** Keep the core small and make advanced capabilities optional.

---

## Risk 3 — AI standards change rapidly

Today's AI development interfaces may not be tomorrow's.

**Response:** Separate our application/context model from specific AI providers and protocols.

---

## Risk 4 — Vendor lock-in

Supporting one AI provider too deeply could limit the ecosystem.

**Response:** Build provider-neutral interfaces.

---

## Risk 5 — Developers reject new conventions

Developers may not want another framework with excessive rules.

**Response:** Keep conventions simple, explainable, and valuable even without AI.

---

## Risk 6 — Context becomes stale

If application knowledge is outdated, AI may make dangerous decisions.

**Response:** Distinguish automatically discovered facts from human-authored knowledge and track freshness/change history.

---

# 42. Key Design Principle

We should distinguish between:

```text
FACT
```

and:

```text
INTENT
```

For example:

```text
Fact:
PaymentService calls StripeClient.

Intent:
PaymentService exists to process customer payments.

Decision:
Stripe was selected because it supports required payment methods.

State:
Payment retry is currently being implemented.
```

AI should know which information is discovered from the code and which represents human intent.

---

# 43. Another Critical Principle: Don't Over-Document

We do not want this:

```text
Every function
Every variable
Every line
Every loop
Every condition
```

to require AI-specific metadata.

Instead:

```text
Application-level knowledge
        +
Domain-level knowledge
        +
Important technical decisions
        +
Current development state
```

should be the priority.

The source code remains the implementation.

The context explains the system.

---

# 44. The Framework's Unique Value

Existing frameworks answer:

> **How do I build software?**

Our framework should additionally answer:

> **How can software be structured so that AI development tools can understand and work on it?**

Existing AI coding tools answer:

> **How can AI write code?**

Our framework should answer:

> **What does AI need from the software environment to develop software reliably?**

That distinction is the heart of the product.

---

# 45. North Star

## Primary statement

> **We are building the application environment for the AI era—not another AI coding tool.**

## Product definition

> **A lightweight Node.js application framework designed to make software projects understandable, navigable, testable, and safely operable by AI development tools while remaining simple and powerful for human developers.**

## Core principle

> **Don't build AI that merely reads code. Build software environments that AI can understand and work with.**

---

# 46. Final Architecture Direction

The current high-level architecture is:

```text
                         HUMAN
                           │
                           ▼
                  AI DEVELOPMENT TOOLS
                           │
                           ▼
              ┌─────────────────────────┐
              │ AI / Application API    │
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │ APPLICATION CONTEXT     │
              │                         │
              │ Structure               │
              │ Intent                  │
              │ Decisions               │
              │ Dependencies            │
              │ Constraints             │
              │ Development State       │
              │ Capabilities            │
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │ OUR FRAMEWORK           │
              │                         │
              │ Runtime                 │
              │ Modules                 │
              │ APIs                    │
              │ Services                │
              │ Security                │
              │ Configuration           │
              │ Validation              │
              │ Logging                 │
              │ Lifecycle               │
              └────────────┬────────────┘
                           │
                           ▼
                       HAPI.JS
                           │
                           ▼
                       NODE.JS
```

This architecture deliberately separates:

**AI tools → Application understanding → Framework → Runtime**

rather than putting AI directly inside the framework.

---

# 47. The First Principle We Should Build Around

Everything in the project should ultimately support one question:

> **“What does an AI development tool need in order to safely and effectively work on a software project?”**

Every proposed feature should be evaluated against that question.

If a feature helps answer it, it belongs in the project.

If it does not, we should question whether we need it.

---

# 48. The Project in One Sentence

> **We are building a lightweight Node.js framework and application environment for the AI era, where software exposes the context, structure, intent, state, capabilities, and safety boundaries that AI development tools need to understand and develop real applications.**
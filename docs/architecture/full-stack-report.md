# Full-Stack Simplicity Report

Date: 2026-10-06. Companion to the [audit](./full-stack-audit.md). Reference
docs: [primitives.md](../primitives.md). Measurements:
[benchmarks/code-to-intent/RESULTS.md](../../benchmarks/code-to-intent/RESULTS.md).

## A. Architecture

### Before

Nexo already had every building block a CRUD feature needs: field schemas and
validation, a document store with compare-and-swap, JWT/API-key auth with
scopes, a hapi adapter that validates, authenticates and maps errors, an HTTP
client and React hooks. Nothing connected them, so each feature re-assembled
them by hand:

```text
interface User (server)  +  NexoFieldSchema (validation)  +  interface User (frontend)
        │                          │
handlers: payload casts, ids, timestamps, 404s, 201s, query parsing, paging
        │
useApi + useMutation + useState per field + loading/error/empty markup
```

### Problems found

1. The same entity shape was written three or four times (interface, schema,
   frontend interface, payload casts).
2. Every CRUD endpoint was hand-written, which leaves room for status-code
   bugs. The existing todos example answers "not found" with 200.
3. Every list re-implemented loading, error and refetch. `useApi`,
   `useProjects`, `useWorkflowRuns` and `useAgentMemory` each carry their own copy.
4. A `NexoValidationError` thrown in a handler became a 500.
5. Handlers could not see the authenticated caller.
6. Comments described OpenAPI/client generators that don't exist.

### After

```text
model("users", { … })                      one definition (browser-safe)
   ├── resource(User, { store })            server: CRUD + REST API, a NexoModule
   └── client.resource(User) / useResource  browser: same URLs, validation, types
          └── NexoForm, NexoResourceTable, NexoApp + page()
```

The controller/service/repository layering still exists, but inside the
framework (`resource.ts` and the hapi adapter), not in application code.

### Why each change exists

| Change | Reason |
|---|---|
| `model()` + `field.*` in core | Removes the duplicated shapes. Types, validation, defaults, labels and API schemas come from one declaration. Built on the existing `NexoFieldSchema`/`validateField`, not a new validation library. |
| `@nexo-alpha/core/model` entry | The browser can share model files without bundling Node code |
| `resource()` in core | Removes hand-written CRUD handlers. Reuses `NexoDocumentStore` (so `scopeByProject` tenancy works unchanged), `NexoHttpError`, `httpResponse` and `replaceIf` |
| `resource-contract.ts` | The URL and list-query format are defined once and used by both server and client |
| `api.get/post/…` | One line per custom endpoint instead of a five-key object |
| hapi: `NexoValidationError` → 400 | Validation thrown anywhere is a client error, not a crash |
| hapi: `context.auth` | Ownership rules without parsing the token twice |
| `client.resource`, `useResource`, `useRecord` | Typed data access with loading, error and refresh-after-write built in |
| `NexoForm`, `NexoTable`, `NexoResourceTable` | Forms and tables that follow the model, so adding a field is a one-line change |
| `page()` + `NexoApp` | Routing, provider, layouts and protected pages in one place, on the existing trie router |
| `nexo generate resource/page` | Feature scaffolding that matches the documented layout |

Rejected or deferred on purpose: pluralizing model names at runtime (names
are explicit; only the CLI scaffolder pluralizes, visibly), and unique
constraints (the document store has no unique index, so the guarantee would
not hold across processes).

## B. New primitives

| Primitive | Package | Purpose |
|---|---|---|
| `model`, `field.*`, `Infer`, `InferInput`, `InferPatch` | core (`/model`) | Single definition of a domain object |
| `errorsByField`, `humanize` | core (`/model`) | Map validation messages and labels to fields |
| `resource` | core | CRUD + REST API + server-side data access |
| `resourcePath`, `encodeListQuery`, `decodeListQuery` | core (`/model`) | The shared HTTP contract |
| `api.get/post/put/patch/delete` | core | One-line endpoints |
| `NexoRequestContext.auth` | core + hapi | Authenticated caller in handlers |
| `client.resource`, `NexoResourceClient` | frontend (`/client` too) | Typed CRUD client |
| `useResource`, `useRecord`, `useResourceClient`, `createQuery` | frontend | Data state for React (and without React) |
| `NexoForm`, `useForm` | frontend | Generated or custom forms |
| `NexoTable`, `NexoResourceTable` | frontend | Tables with loading, error, empty, search, paging, delete |
| `NexoStack`, `NexoGrid`, `NexoLoader`, `NexoErrorState`, `NexoEmptyState` | frontend | Layout and feedback |
| `page`, `NexoApp` | frontend | App shell: routes, layouts, protection |
| `nexo generate resource|page` | cli | Scaffolding |
| `createAuth` | core | Accounts, sessions, `/api/auth/*`, `authenticate` |
| `NexoDocumentStore.insert`, `insertDocument` | core | Atomic insert-if-absent (unique keys) |
| `NexoDocumentStore.query` / `.index`, `queryDocuments` | core | Lists computed in the store (SQL on SQLite), with indexes |
| `createFiles`, `field.file`, `NexoApi.rawBody`, blob stores | core + hapi | Uploads and safe downloads |
| `client.files`, file picker in `NexoForm`, links in `NexoTable` | frontend | Uploading from the browser |
| `client.session` (`NexoSession`), `client.auth` | frontend (`/client` too) | Stored session, sign-in calls |
| `useAuth`, `NexoLoginForm`, `safeRedirectPath` | frontend | Sign-in UI; protected pages follow the session |

## C. Before and after

The complete code for each pair is in `benchmarks/code-to-intent/src/<feature>/{before,after}`.

**Model and validation** (`user-crud/before/user.ts`, 17 LOC → `after/user.model.ts`, 7 LOC)

```ts
export const User = model("users", {
  name: field.string({ minLength: 1 }),
  email: field.email(),
  role: field.enum(["member", "admin"]).default("member")
});
export type User = Infer<typeof User>;
```

**CRUD API** (`users.api.ts`, 78 LOC → 5 LOC): `resource(User, { store })`.

**Authenticated, validated endpoint** (46 → 8 LOC):

```ts
resource(Invitation, { store, expose: ["create"], auth: { write: ["invites:write"] } })
```

**Custom GET** (16 → 9 LOC): `api.get("/api/status", () => ({ status: "ok" }))`.

**Page with form and table** (`users.page.tsx`, 89 → 11 LOC):

```tsx
<NexoStack>
  <NexoForm model={User} />
  <NexoResourceTable model={User} columns={["name", "email", "role"]} allowDelete />
</NexoStack>
```

**Search and paging table** (67 → 6 LOC): `<NexoResourceTable model={Product} search pageSize={20} />`.

**Relationship** (77 → 11 LOC): `customerId: field.ref("customers")` plus two `resource()` calls.

**Authentication, full stack** (181 → 10 LOC): `createAuth({ store, secret })` on the
server, `<NexoLoginForm />` on the login page; protected pages need only `{ protect: true }`.

## D. Measurements

Measured by `benchmarks/code-to-intent/measure.mjs`. Both variants of every
backend pass the same 7 conformance tests per variant (`test/conformance.test.js`).

| Feature | LOC | Files | Imports | Concepts | Hand-written shapes |
|---|---|---|---|---|---|
| GET API | 16 → 9 (−44%) | 1 → 1 | 1 → 1 | 1 → 2 | 0 → 0 |
| Authenticated + validated POST | 46 → 8 (−83%) | 1 → 1 | 2 → 1 | 4 → 5 | 2 → 1 |
| User CRUD, full stack | 184 → 23 (−88%) | 3 → 3 | 7 → 6 | 11 → 9 | 2 → 1 |
| Product search + filter + paging, full stack | 150 → 18 (−88%) | 3 → 3 | 7 → 6 | 7 → 7 | 3 → 1 |
| Relationship (orders → customers) | 77 → 11 (−86%) | 1 → 1 | 2 → 1 | 4 → 5 | 4 → 2 |
| Authentication: register/login/logout/me + login page | 181 → 10 (−94%) | 2 → 2 | 4 → 3 | 14 → 5 | 4 → 0 |
| File upload + safe download (backend; *before* sends base64 JSON, see RESULTS.md) | 77 → 11 (−86%) | 1 → 1 | 4 → 1 | 4 → 4 | 2 → 0 |
| **Total** | **731 → 90 (−88%)** | 12 → 12 | 27 → 19 | | 17 → 5 |

**Change cost: "add an optional phone field, shown in the form and table"**,
applied to both user-CRUD variants and compiled:

| | Files touched | Edit sites | Lines |
|---|---|---|---|
| Before | 3 (`user.ts`, `users.api.ts`, `users.page.tsx`) | 11 | +12 −3 |
| After | 2 (`user.model.ts`, `users.page.tsx`) | 2 | +3 −2 |

Without an explicit `columns` list, the after variant needs one edit in one file.

What did **not** improve, stated plainly:
- **Framework concepts per feature stay about the same** (1–11 before, 2–9
  after). The vocabulary changes (`model`, `field`, `resource` instead of
  `NexoFieldSchema`, `httpResponse`, `NexoHttpError`) more than it shrinks.
- **File counts are equal**, because both variants keep the model/api/page split.
- The **after** variants do more than the conformance tests check: full CRUD
  routes, unknown-field rejection, client-side validation, per-field errors,
  and lists refreshing after writes. So the LOC comparison understates the difference.

Not benchmarked, because no primitive exists yet: migrations (the document store is schemaless; `.default()` fields
are filled when read, which is the only migration support).

## E. Test results

Run on 2026-10-06 with Node 22.19, `turbo run build typecheck test --force` (no cache):

| Check | Result |
|---|---|
| Build + typecheck + tests, all workspace packages, examples and the benchmark | **57/57 tasks pass** |
| core unit tests | 167 pass (49 new: `model`, `resource`, `accounts`, `document-query` incl. 400 randomized SQL-vs-memory parity queries, `files`) |
| core type tests (`type-tests/`, run by `pnpm test`) | pass (15 assertions / expected errors) |
| hapi tests | 37 pass (12 new HTTP tests: resources, auth, files) |
| frontend tests | 62 pass (21 new: live-server integration Frontend → API → resource/auth/files → store, components, `NexoApp`, sessions) |
| frontend type tests | pass (9 assertions / expected errors) |
| cli tests | 62 pass (2 new); generated resource/page files compile under the repo's strict tsconfig |
| benchmark conformance | 16 pass (before and after, 8 checks each) |
| Browser environment | `frontend/test/dom.test.js` (jsdom + react-dom): form → API → table refresh, field errors with no request sent, delete confirmation, file upload attached to the saved record, protected page → sign-up → back to the page → sign out |
| Lint | `pnpm lint`: 0 errors (3 warnings in older hooks with deliberate dependency lists) |

**`packages/data`**, a parallel `resource()` implementation that appeared in the working tree
during this work, was reviewed and removed (2026-10-06). Three of its ideas were ported into
core with tests: field descriptions (`.describe()`), change events (`resource({ onChange })`)
and per-operation scopes (`auth: { delete: [...] }`). Its cursor pagination and ULID-style ids
were not ported; cursor pagination is a candidate for a later release.

## F. Migration

All changes are additive except the hapi 400 mapping. Existing modules, APIs,
hooks and components keep working.

1. **Upgrade.** Re-run tests. If a test expected a 500 from a thrown
   `NexoValidationError`, it now gets 400 with `{ error, errors }`.
2. **New features**: `nexo generate resource <name>`, then `app.module(...)`
   and `page(...)`.
3. **Existing CRUD module, one entity at a time:**
   - Write `model("<collection>", …)` with the same collection name the
     handlers use in `store.put(...)`. Existing documents are read as they
     are, with defaults filled for fields they lack.
   - Replace the module with `resource(Model, { store, path })`. Keep `path`
     if the old routes differ from `/api/<name>`.
   - Note the response shape: `GET` list now returns `{ items, total, limit, offset }`
     instead of a bare array. Update callers, or keep the old list route with
     `expose: ["get", "create", "update", "delete"]` plus a custom `api.get`.
   - Unknown request fields are now rejected (400). Clients that send extra
     keys must stop.
   - Move custom handler logic (computed fields, ownership) into `beforeWrite`.
4. **Frontend:** replace `useApi("/api/x")` + `useMutation` + hand-written
   forms with `useResource(Model)`, `NexoForm`, `NexoResourceTable`. Delete the
   duplicated frontend interface and use `Infer<typeof Model>`.
5. **Routing:** replace `NexoRouterProvider` + `NexoRoutes` wiring with
   `<NexoApp pages={[page(...)]} />`. The old components remain available.

## Next steps, in order of value

1. ~~Login/session flow~~: done (`createAuth`, `useAuth`, `NexoLoginForm`).
   Still open: password reset by email, and email verification. Both need an email primitive.
2. ~~Query pushdown~~: done (`store.query`, `store.index`, `resource({ indexes })`).
   Measured on 50,000 SQLite rows: one customer's orders take 3.3 ms instead of 160 ms;
   a broad filter + search + sort takes 110 ms instead of 160 ms, because substring
   search still scans every row. Full-text search (SQLite FTS5) would be the next step there.
3. Unique constraints, backed by a store-level index.
4. ~~File upload~~: done (`createFiles`, `field.file`, disk and memory blob stores).
   Files are cleaned up when records release them (`attachedTo`, `cleanup`).
   Still open: an S3-compatible blob store, image thumbnails, and signed URLs for
   `<img src>` on files behind `auth.read`.
5. Consolidate the older data hooks (`useApi`, `useNexoApi`, `useNexoRpcQuery`)
   onto `createQuery`, and decide whether the RPC client's method guessing stays.
6. Resolve `packages/data` (see E).

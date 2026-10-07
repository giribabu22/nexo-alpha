<p align="center">
  <img src="https://raw.githubusercontent.com/giribabu22/nexo-alpha/main/logo.png" alt="Nexo - The AI Application Framework" width="120">
</p>

# @nexo-alpha/data

Nexo's data layer in one import. Declare a model once and get its TypeScript types, validation, storage, a REST API, list queries and file uploads.

```bash
npm install @nexo-alpha/data
```

> **Same code as `@nexo-alpha/core`.** This package re-exports the data layer from `@nexo-alpha/core` (version-locked to it), so the functions are identical and the two imports can be mixed. Use this one when you want just the data layer, and core when you're also building the application, auth or jobs.

## Quick start

```ts
// tasks/task.model.ts: browser-safe, shared by server and frontend
import { field, model, type Infer } from "@nexo-alpha/data/model";

export const Task = model("tasks", {
  title: field.string({ minLength: 1, maxLength: 200 }),
  done: field.boolean().default(false),
  due: field.date().optional(),
  assigneeId: field.ref("users").optional()
});
export type Task = Infer<typeof Task>;
// { id, createdAt, updatedAt, title: string, done: boolean, due?: string, assigneeId?: string }
```

```ts
// server.ts
import { createSqliteDocumentStore, resource } from "@nexo-alpha/data";
import { createApplication } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { Task } from "./tasks/task.model.js";

const store = await createSqliteDocumentStore("data/app.db");
const tasks = resource(Task, { store, searchable: ["title"] });

const app = createApplication({ name: "todo" });
app.module(tasks);                 // GET/POST /api/tasks, GET/PATCH/DELETE /api/tasks/:id
await startHapiServer(app, { port: 3000, cors: true });

// The same operations from server code:
await tasks.create({ title: "Write the README" });
const { items, total } = await tasks.list({ where: { done: false }, sort: "-createdAt", limit: 20 });
```

In the browser, `@nexo-alpha/frontend` uses the same model: `useResource(Task)`, `<NexoForm model={Task} />`, `<NexoResourceTable model={Task} />`.

## Models

`model(name, fields)`: `name` is lowercase, plural and kebab-case (`"tasks"`, `"order-items"`). It is the collection name and the default API path. Every record also gets `id`, `createdAt` and `updatedAt`.

| Field | Value | Notes |
|---|---|---|
| `field.string({ minLength?, maxLength?, pattern? })` | `string` | |
| `field.text(…)` | `string` | multi-line; a textarea in forms |
| `field.email()` | `string` | |
| `field.number({ min?, max?, integer? })` | `number` | |
| `field.boolean()` | `boolean` | |
| `field.enum(["low", "high"])` | `"low" \| "high"` | |
| `field.date()` | ISO 8601 `string` | |
| `field.ref("users")` | id `string` | must point at an existing record |
| `field.file({ accept? })` | uploaded file id | see [Files](#files) |
| `field.array(field.string())` | list | |

Every field is required unless you call `.optional()` (may be absent) or `.default(value)` (stored when omitted). `.labelled("Text")` sets the form/table label and `.describe("…")` documents the field in the API schema.

- **Types:** `Infer<typeof M>` (a stored record), `InferInput<typeof M>` (what create accepts) and `InferPatch<typeof M>` (what update accepts).
- **Validation:** `M.validate(input)` returns `{ valid, errors }`; `M.parse(input)` throws `NexoValidationError`. Fields that aren't declared are rejected, so a typo like `titel` is an error, not silently stored.
- **Adding a field with a default needs no migration.** Older records get the default when read, in filters and in sorting.

## Resources

`resource(model, options)` returns a `NexoModule` (register it with `app.module(...)`) that is also a data API for server code: `list`, `get`, `create`, `update`, `delete`.

| Option | Default | |
|---|---|---|
| `store` | required | any document store below |
| `searchable` | `[]` | text fields matched by `search` |
| `indexes` | the `ref` and `file` fields | fields filtered on often; SQLite indexes them |
| `auth` | none | `true`, or scopes `{ read, write, list?, get?, create?, update?, delete? }` |
| `expose` | all five | operations served over HTTP |
| `beforeWrite` | | `(record, { operation, existing, request }) => record`: computed fields and rules |
| `onChange` | | `({ operation, record, previous, request }) => …` after each stored change (webhooks, audit) |
| `path` | `/api/<name>` | |
| `defaultLimit` / `maxLimit` | 50 / 200 | |

| Call | HTTP | Success | Errors |
|---|---|---|---|
| `list(query)` | `GET /api/tasks?limit&offset&sort&search&<field>=` | 200 `{ items, total, limit, offset }` | 400 |
| `get(id)` | `GET /api/tasks/:id` | 200 record | 404 |
| `create(input)` | `POST /api/tasks` | 201 record + `Location` | 400 (every problem listed), 409 |
| `update(id, patch)` | `PATCH /api/tasks/:id` | 200 record | 400, 404, 409 |
| `delete(id)` | `DELETE /api/tasks/:id` | 204 | 404 |

**Behavior worth knowing:**
- `null` in a patch clears an optional field.
- Concurrent updates never overwrite each other: compare-and-swap, retried, with a 409 if the record keeps changing.
- `ref` fields must point at existing records.

## List queries

```ts
await tasks.list({
  where: { done: false, assigneeId: "u1" },  // equality, typed per field
  search: "readme",                         // case-insensitive, over `searchable`
  sort: "-due",                             // a field, "-" for descending
  limit: 20,
  offset: 40
});
// HTTP: GET /api/tasks?done=false&assigneeId=u1&search=readme&sort=-due&limit=20&offset=40
```

Results are the same on every store:
- numbers sort numerically and strings case-insensitively
- missing values sort last
- ties keep creation order

## Stores

| Store | Use it for |
|---|---|
| `createInMemoryDocumentStore()` | tests and prototypes |
| `createFileDocumentStore("data/app.json")` | one process, modest data; atomic file writes |
| `await createSqliteDocumentStore("data/app.db")` | production; Node.js ≥ 22.5; safe across processes |

On SQLite, lists are filtered, sorted and paged **in SQL**, and indexed fields stay fast at any size. In a benchmark, one customer's orders out of 50,000 took 3 ms instead of 160 ms for a scan. Substring `search` always scans. The other stores compute lists in memory, which is fine for thousands of records.

**Multi-tenancy:** wrap any store with `scopeByProject(store)` and run requests inside `runInProject(projectId, …)` (`@nexo-alpha/hapi` does this with its `project` option). Each project then sees only its own records.

**Your own store:** implement `NexoDocumentStore` (`get`, `put`, `delete`, `replaceIf`, `list`, `close`). The optional `insert`, `query` and `index` methods make it atomic and fast. Use `queryDocuments(docs, query)` to match the built-in list rules.

## Files

```ts
import { createDiskBlobStore, createFiles, field, model, resource } from "@nexo-alpha/data";

const files = createFiles({ store, blobs: createDiskBlobStore("data/files"), accept: ["image/*", "application/pdf"] });
app.module(files);   // POST /api/files?name=… (raw body), GET /api/files/:id, GET /api/files/:id/info, DELETE /api/files/:id

const Profile = model("profiles", { name: field.string(), photo: field.file({ accept: ["image/*"] }).optional() });
app.module(resource(Profile, { store }));
```

- **Limits:** uploads over `maxBytes` get 413; types outside `accept` get 415.
- **Safe downloads:** only images, PDF, plain text, audio and video display inline. HTML and SVG are always downloaded, so uploaded files can't run scripts on your site.
- **One record per file:** each file belongs to one record. Files a record replaces or deletes are removed an hour later, while the app runs (`cleanup` option, or call `files.sweep()`).

## Browser entry

`@nexo-alpha/data/model` exports `model`, `field`, the types, the list-query helpers and validation, with no Node.js code. Import model files from it so the frontend can bundle them.

## Common mistakes

- Model names must be lowercase plurals: `model("User", …)` is rejected; use `model("users", …)`.
- A field named `limit`, `offset`, `sort` or `search` clashes with list queries, and `resource()` refuses it.
- Importing `@nexo-alpha/data` (not `/model`) in browser code pulls in server code.
- A browser app on another origin needs `startHapiServer(app, { cors: true })`.

## Related

- [Full-stack primitives reference](https://github.com/giribabu22/nexo-alpha/blob/main/docs/primitives.md): every primitive, with options and common mistakes.
- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core): where this code lives, plus applications, auth (`createAuth`) and more.
- [`@nexo-alpha/frontend`](https://www.npmjs.com/package/@nexo-alpha/frontend): `useResource`, `NexoForm`, `NexoResourceTable`.
- [`@nexo-alpha/hapi`](https://www.npmjs.com/package/@nexo-alpha/hapi): serves resources over HTTP.

## License

MIT

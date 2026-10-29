# Nexo full-stack primitives

A reference for building features: one section per primitive, each with
purpose, syntax, return value, an example, common mistakes and extension
points. Written so that a person or an AI agent can make a change after
reading only the section it needs.

## The data flow

```text
user.model.ts   model("users", { … })        ← the only definition of a user
      │
      ├── users.api.ts    resource(User, { store })   → GET/POST /api/users, GET/PATCH/DELETE /api/users/:id
      │                        └── NexoDocumentStore (memory, JSON file, SQLite)
      │
      └── users.page.tsx  <NexoForm model={User} />, <NexoResourceTable model={User} />
                               └── client.resource(User) → same URLs, same validation, same types
```

## A complete feature

```ts
// src/users/user.model.ts — shared by server and browser
import { field, model, type Infer } from "@nexo-alpha/core/model";

export const User = model("users", {
  name: field.string({ minLength: 1 }),
  email: field.email(),
  role: field.enum(["member", "admin"]).default("member"),
  age: field.number({ min: 0 }).optional()
});
export type User = Infer<typeof User>;
```

```ts
// src/users/users.api.ts — server
import { resource, type NexoDocumentStore } from "@nexo-alpha/core";
import { User } from "./user.model.js";

export const usersResource = (store: NexoDocumentStore) => resource(User, { store, searchable: ["name", "email"] });
```

```ts
// src/server.ts
import { serve } from "@nexo-alpha/hapi";
import { usersResource } from "./users/users.api.js";

await serve({ name: "my-app", resources: [usersResource], cors: true });
// SQLite at data/app.db, port 3000 ($PORT), Ctrl+C stops cleanly.
// cors: when the browser app is served from another origin.
```

A model with no options can go in directly: `serve({ resources: [User] })`.
[serve](#serve-server) lists what it sets up and how to replace each part.

```tsx
// src/users/users.page.tsx — browser
import { NexoForm, NexoResourceTable, NexoStack } from "@nexo-alpha/frontend";
import { User } from "./user.model.js";

export function UsersPage() {
  return (
    <NexoStack>
      <NexoForm model={User} />
      <NexoResourceTable model={User} search allowDelete />
    </NexoStack>
  );
}
```

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import { NexoApp, page } from "@nexo-alpha/frontend";
import { UsersPage } from "./users/users.page.js";

createRoot(document.getElementById("root")!).render(
  <NexoApp pages={[page("/users", UsersPage)]} baseUrl="http://localhost:3000" />
);
```

Scaffold the three feature files with `nexo generate resource user`.

### Where to make common changes

| Change | Where |
|---|---|
| Add, remove or constrain a field | the model file only; forms, tables, validation and types follow |
| Computed field, ownership rule, extra check on write | `beforeWrite` in the `resource()` call |
| Who may read or write | `auth` in the `resource()` call |
| An endpoint that isn't CRUD | `api.get/post/…` in a module next to the resource |
| Which columns a table shows | `columns` on `NexoResourceTable` / `NexoTable` |
| A new page | `page("/path", Component)` in the app's page list |
| Sign-in, who gets which scopes | `createAuth({ … })` options; `auth.setScopes(userId, scopes)` |
| Signed-in-only page | `page("/path", Component, { protect: true })` |
| Accept uploads | `field.file({ accept })` in the model, `createFiles({ … })` on the server |

---

## model

**Purpose.** Declares a domain object once. Its TypeScript types, validation,
defaults, API schemas, form inputs and table columns all come from it.

**Syntax.** `model(name, fields)`, from `@nexo-alpha/core/model` (browser-safe) or `@nexo-alpha/core`.

| Argument | Type | Notes |
|---|---|---|
| `name` | `string` | lowercase kebab-case, plural: the collection name and API path (`/api/<name>`) |
| `fields` | `Record<string, NexoField>` | built with `field.*`; `id`, `createdAt`, `updatedAt` are reserved |

**Returns** `NexoModel`:
`name`, `fields`, `schema` (create body), `patchSchema` (update body),
`recordSchema`, `validate(input, { partial? })`, `parse(input)`,
`parsePatch(input)`, `hydrate(document)`, `label(field)`.

**Types.** `Infer<typeof M>` is a stored record (with `id`, `createdAt`,
`updatedAt`). `InferInput<typeof M>` is what create accepts. `InferPatch<typeof M>`
is what update accepts.

**Fields** (`field.*`): every field is required unless you call `.optional()`
(may be absent) or `.default(value)` (omitted → stored default). Use
`.labelled("Text")` to set the form/table label.

| Builder | Value | Form input |
|---|---|---|
| `string({ minLength?, maxLength?, pattern? })` | string | text |
| `text(…)` | string | textarea (hidden from default table columns) |
| `email()` | string | email |
| `number({ min?, max?, integer? })` | number | number |
| `boolean()` | boolean | checkbox |
| `enum(["a", "b"])` | `"a" \| "b"` | select |
| `date()` | ISO 8601 string | date |
| `ref("customers")` | id string | text; must reference an existing record |
| `file({ accept? })` | uploaded file id | file picker that uploads on selection; tables show a download link |
| `array(field.string())` | list | none (set it from code) |

**Common mistakes**
- `model("User", …)` or `model("order_items", …)`: names are lowercase kebab-case plurals (`"users"`, `"order-items"`).
- Declaring `id`, `createdAt` or `updatedAt`: every record already has them.
- Naming a field `limit`, `offset`, `sort` or `search`: these are reserved for list queries, and `resource()` refuses them.
- Importing the model file from `@nexo-alpha/core` in browser code: use `@nexo-alpha/core/model`, which has no Node.js imports.

**Behavior worth knowing.** Unknown fields are rejected (a typo such as
`emial` is an error, not silently stored). Adding a field with `.default()`
needs no migration: `hydrate` fills it in when older records are read.

---

## resource

**Purpose.** Stores a model's records and serves them over HTTP, with no
controller, service, repository or DTO code.

**Syntax.** `resource(model, options)` from `@nexo-alpha/core`. The result is a
`NexoModule`: register it with `app.module(users)`.

| Option | Default | Notes |
|---|---|---|
| `store` | required | any `NexoDocumentStore`; wrap with `scopeByProject()` for per-tenant data |
| `searchable` | `[]` | text fields matched by `search` (case-insensitive substring) |
| `indexes` | the `ref` fields | fields filtered on often; SQLite gets an index for each |
| `auth` | none | `true` (signed in), or `{ read?: scopes, write?: scopes }`; needs `createHapiServer({ authenticate })` |
| `expose` | all five | which operations get HTTP routes: `"list" "get" "create" "update" "delete"` |
| `beforeWrite` | — | `(record, { operation, existing, request }) => record`: computed fields and rules; throw `NexoHttpError(403, …)` to refuse |
| `path` | `/api/<name>` | the frontend must then pass the same `path` |
| `defaultLimit` / `maxLimit` | 50 / 200 | page sizes |

**Returns** `NexoResource`: `list(query)`, `get(id)`, `create(input)`,
`update(id, patch)`, `delete(id)`, plus `model`, `path`, `apis`.

**HTTP contract**

| Call | Route | Success | Errors |
|---|---|---|---|
| `list` | `GET /api/users?limit&offset&sort&search&<field>=` | 200 `{ items, total, limit, offset }` | 400 bad query |
| `get` | `GET /api/users/:id` | 200 record | 404 |
| `create` | `POST /api/users` | 201 record + `Location` | 400 `{ error, errors[] }` |
| `update` | `PATCH /api/users/:id` | 200 record | 400, 404, 409 |
| `delete` | `DELETE /api/users/:id` | 204 | 404 |

Sort with `sort=name` or `sort=-createdAt`. `null` in a PATCH clears an optional field.

**Sorting and matching rules** are the same on every store:
- numbers sort numerically and strings case-insensitively
- missing values sort last in both directions
- ties keep creation order
- case folding covers ASCII letters only, so "É" and "é" differ

**Performance.** On SQLite, filtering, search, sorting and paging run in SQL.
Indexed fields stay fast at any size: in a benchmark, one customer's orders out
of 50,000 took 3 ms, against 160 ms for an unindexed scan. Substring `search`
always scans. On the in-memory and JSON-file stores, lists are computed in memory,
which is fine for thousands of records.

**Example: ownership**

```ts
// Note = model("notes", { text: field.text(), owner: field.string().optional() })
resource(Note, {
  store,
  auth: { read: ["notes:read"], write: ["notes:write"] },
  beforeWrite: (note, { operation, existing, request }) => {
    const user = (request?.auth?.identity as { sub?: string } | undefined)?.sub;
    if (operation === "update" && existing?.owner !== user) throw new NexoHttpError(403, "FORBIDDEN", "Not your note.");
    return operation === "create" && user ? { ...note, owner: user } : note;
  }
});
```

**Common mistakes**
- Browser app served from another origin (e.g. a Vite dev server) and every request fails: start the server with `startHapiServer(app, { cors: true })`.
- Expecting `auth` on direct server calls: `users.create()` from server code is not checked. Only HTTP routes are.
- Giving the server a custom `path` without passing the same `path` to `client.resource(User, { path })`.
- Large collections on the memory or JSON-file stores: those compute lists in memory. Use SQLite, and add `indexes` for fields you filter on.

**Extension points.** `beforeWrite`; `indexes`; `expose` to drop routes; extra endpoints
with `api.*` in another module; `scopeByProject(store)` for multi-tenancy.

---

## serve (server)

**Purpose.** Starts an app from its models: opens the store, serves each
resource, optionally sign-in and uploads, and runs the HTTP server. It only
wires the primitives on this page, so each part can be replaced.

**Syntax.** `await serve(options)` from `@nexo-alpha/hapi`.

```ts
const app = await serve({
  resources: [Task, (store) => resource(Note, { store, auth: true })],  // a model, or a function given the store
  auth: true,                                                          // accounts at /api/auth; secret from AUTH_SECRET
  files: true                                                          // uploads at /api/files, stored in data/files
});
await app.resource(Task).create({ title: "Seed data" });               // typed, same as resource()
```

| Option | Default | Notes |
|---|---|---|
| `resources` | `[]` | models (default `resource()` options) or `(store) => module` |
| `store` | `"data/app.db"` | a path (`.json` → JSON file store, anything else → SQLite) or any `NexoDocumentStore`; in memory when there are no `resources`, `auth` or `files` |
| `auth` | off | `true` or `createAuth` options; `secret` defaults to `process.env.AUTH_SECRET` |
| `files` | off | `true` or `createFiles` options plus `directory` (default `data/files`) or `blobs` |
| `modules` | `[]` | any other modules: `api.*` endpoints, jobs, integrations |
| `app` | a new one named `name` | an application you built yourself (plugins, middleware); not started yet |
| `port` | `$PORT`, else 3000 | every `createHapiServer` option works: `cors`, `rateLimit`, `logger`, … |
| `handleSignals` | `true` | stop cleanly and exit on SIGINT/SIGTERM |

**Returns** `{ app, server, store, auth, files, url, resource(model), stop() }`.
`stop()` closes the store only if `serve()` opened it.

**By hand.** The same thing without `serve()`, when you need control over the order:

```ts
const store = await createSqliteDocumentStore("data/app.db");
const app = createApplication({ name: "my-app" });
app.module(resource(Task, { store }));
await app.start();
await startHapiServer(app, { port: 3000 });
```

**Common mistakes**
- `auth: true` with no `AUTH_SECRET` set: `serve()` refuses to start. Use at least 32 random bytes.
- `store` left at its default on Node.js older than 22.5: SQLite is unavailable; pass `store: "data/app.json"`.
- Passing an `app` that is already started: modules can't be added to a running application.

---

## api.get / api.post / api.put / api.patch / api.delete

**Purpose.** One-line custom endpoints.

**Syntax.** `api.get(path, handler, options?)` returns a `NexoApi`. The `name`
defaults to `"GET /path"`. `options` accepts any other `NexoApi` field
(`auth`, `schema`, `description`, `name`).

```ts
app.module({
  name: "reports",
  apis: [
    api.get("/api/reports/revenue", () => revenueByMonth()),
    api.post("/api/reports/rebuild", (ctx) => rebuild(ctx.payload), {
      auth: { required: true, scopes: ["reports:write"] },
      schema: { body: { type: "object", required: ["month"], properties: { month: { type: "string" } } } }
    })
  ]
});
```

Handlers get `{ params, query, payload, headers, auth }`. `auth` is the
authenticated caller on routes with `auth.required`. Return a value (200), `undefined` (204) or
`httpResponse(status, body, headers)`. Throw `NexoHttpError(4xx, code, message)`
or `NexoValidationError(message, errors)` (400) for client errors.

---

## client.resource (browser and Node)

**Purpose.** A typed client for a server resource, driven by the same model.

```ts
const users = createNexoClient({ baseUrl }).resource(User);
const { items, total } = await users.list({ where: { role: "admin" }, sort: "-createdAt", limit: 20 });
const ann = await users.create({ name: "Ann", email: "ann@example.com" });
await users.update(ann.id, { age: null });
```

Input is validated with the model before sending. Failures throw
`NexoApiError` (status 400, `payload.errors`), the same as a server rejection.
Successful writes call `onChange` listeners. The operations are arrow functions,
so `onSubmit={users.create}` works.

---

## useResource / useRecord

**Purpose.** React state for a model's records: data, loading, error, and
mutations. Lists refresh automatically after any write made through the same
client.

```tsx
const users = useResource(User, { where: { role: "admin" }, sort: "name" });
// users.items, users.total, users.loading, users.error, users.refetch, users.create/update/delete

const user = useRecord(User, params.id);
// user.data, user.loading, user.error, user.update(patch), user.delete()
```

**Common mistakes.** Building a query object that changes every render is
fine (it's compared by value), but a `Date` or a function inside it isn't
serializable. Use plain values.

---

## NexoForm / useForm

**Purpose.** Forms generated from a model.

```tsx
<NexoForm model={User} />                                   // create through the API
<NexoForm model={User} id={params.id} onSaved={() => navigate("/users")} />   // load + edit
<NexoForm model={User} fields={["name", "email"]} onSubmit={invite} submitLabel="Invite" />
```

`useForm(model, { initial, onSubmit, partial })` gives the same behavior
(`values`, `errors`, `formError`, `submitting`, `setValue`, `submit`, `reset`)
for custom markup. Errors from the server are shown next to the field they name.

**Common mistakes.** `array` fields have no generated input. Set them through
`initial`, or write a custom form with `useForm`.

---

## NexoTable / NexoResourceTable

```tsx
<NexoResourceTable model={Product} search pageSize={20} allowDelete columns={["name", "price"]} />
<NexoTable model={Product} rows={products.items} loading={products.loading} error={products.error}
           columns={["name", { key: "price", render: (p) => `$${p.price}` }]} rowActions={(p) => …} />
```

`NexoResourceTable` fetches, searches (server `searchable` required), pages and
deletes. `NexoTable` renders rows you pass in. Both show loading, error (with
retry) and empty states.

---

## Layout and feedback

`NexoStack` (`direction`, `gap`, `align`, `justify`, `wrap`), `NexoGrid`
(`columns`, or responsive `minColumnWidth`), `NexoPage` (header, navbar,
sidebar, footer), `NexoCard`. For feedback: `NexoLoader`, `NexoErrorState`
(`error`, `onRetry`), `NexoEmptyState` (`title`, `action`).

---

## createAuth (server)

**Purpose.** Email and password accounts, sessions and the sign-in API.

```ts
const auth = createAuth({ store, secret: process.env.AUTH_SECRET!, defaultScopes: ["notes:read"] });
app.module(auth);                                                // POST /api/auth/register, /login, /logout; GET /api/auth/me
await startHapiServer(app, { authenticate: auth.authenticate }); // checks auth on every auth-required API
```

| Option | Default | Notes |
|---|---|---|
| `store`, `secret` | required | secret ≥ 32 bytes, from the environment |
| `defaultScopes` | `[]` | scopes new accounts get; the HTTP register API cannot choose scopes |
| `allowRegistration` | `true` | `false` when accounts are created by server code (`auth.register(...)`) |
| `sessionSeconds` | 7 days | |
| `resolveScopes` | account scopes | map roles to scopes per request |
| `maxFailedLogins` | 10 | per email per 15 minutes, then 429 |
| `path` | `/api/auth` | the client then needs `authPath` |
| `sendEmail`, `appUrl` | off | turn on password reset and email verification (see below) |
| `verifyEmailOnRegister` | `true` with `sendEmail` | email a verification link after sign-up |

**Returns** a `NexoModule` plus `authenticate`, `register`, `login`, `logout(sessionId)`,
`getUser`, `findUserByEmail`, `setScopes(userId, scopes)` and
`setPassword(userId, password)`, which signs the user out everywhere.

On requests it authenticates, `context.auth.identity` is `{ sub, email, name?, emailVerified, sessionId }`;
use `sub` (the user id) for ownership in `beforeWrite`.

**Password reset and email verification.** Give `createAuth` a way to send email and your
app's address:

```ts
createAuth({
  store,
  secret,
  appUrl: "https://app.example.com",
  sendEmail: ({ to, subject, text }) => mailer.send({ to, subject, text })   // any provider
});
```

This adds `POST /api/auth/password-reset` (always 204, so it doesn't reveal which emails
have accounts), `/password-reset/confirm`, `/verify-email` (signed in) and `/verify-email/confirm`.

- Links open `appUrl` + `/reset-password?token=…` or `/verify-email?token=…`.
- Tokens work once and expire after 1 hour (reset) or 7 days (verification). Only their hash is stored.
- A reset ends every session, then signs in with the new password.
- `user.emailVerified` lets the app decide what unverified users may do.

**Behavior worth knowing.**
- Passwords are scrypt-hashed. One account per email, claimed atomically through the store's `insert`.
- Logout really revokes the token, because sessions are stored on the server.
- Scope changes apply on the next request.

**Common mistakes**
- Forgetting `authenticate: auth.authenticate` in `createHapiServer`: the server refuses to start if any API requires auth.
- Using several authenticators: combine them with `anyAuthenticator(auth.authenticate, apiKeyAuthenticator(...))`.

---

## createFiles (server) / client.files (browser)

**Purpose.** File uploads and downloads, with safe defaults.

```ts
const files = createFiles({ store, blobs: createDiskBlobStore("data/files"), accept: ["image/*", "application/pdf"] });
app.module(files);   // POST /api/files?name=…  (raw body), GET /api/files/:id, GET /api/files/:id/info, DELETE /api/files/:id

const Profile = model("profiles", { name: field.string(), photo: field.file({ accept: ["image/*"] }) });
// <NexoForm model={Profile} /> uploads the photo when it's picked, then saves its id.
```

| Option | Default | Notes |
|---|---|---|
| `store`, `blobs` | required | `createDiskBlobStore(dir)` or `createInMemoryBlobStore()`; implement `NexoBlobStore` for S3 and similar |
| `maxBytes` | 10 MB | larger uploads get 413 before the handler runs |
| `accept` | any | MIME patterns; others get 415 |
| `auth` | none | like `resource()`: `true` or `{ read, write }` scopes |
| `cleanup` | on | `{ removeDetachedAfterMs: 1h, removeUnattachedAfterMs: never, everyMs: 15 min }`, or `false` |

**Cleanup.**
- `resource()` records which record uses each file (`attachedTo`). A file belongs to one record; using it in a second record answers 409.
- When a record replaces or deletes a file, the file is released and removed an hour later. The timer runs between `app.start()` and `app.stop()`, and `files.sweep()` runs it by hand.
- Uploads no record ever used are kept by default. Set `removeUnattachedAfterMs` (e.g. 24 hours) once every reference goes through `resource()`. If your own code stores file ids, call `files.attach(id, "invoices/42")` and `files.detach(id)`.

Browser: `client.files.upload(file)` returns a `NexoFile` (`id`, `name`, `type`, `size`,
`sha256`, `url`); `client.files.url(id)` gives a link or `<img src>`;
`client.files.download(id)` returns a Blob, sent with credentials.

**Safety.**
- Downloads carry `nosniff` and a sandboxing CSP.
- Only images, PDF, plain text, audio and video display inline. Everything else, including HTML and SVG, is downloaded.
- Names are reduced to a plain file name.
- Blob keys can't escape the storage directory.

**Common mistakes**
- Using a different `store` for `createFiles` than for the resources whose `field.file()` points at the files. The existence check looks in the resource's store.
- Expecting `<img src>` to work with `auth.read`. Browsers don't send the token there; use `client.files.download(id)` and `URL.createObjectURL`. File ids are random UUIDs, so public reads work like unguessable links.

---

## useAuth / NexoLoginForm / client.auth (browser)

```tsx
page("/login", () => <NexoLoginForm forgotPassword />, { layout: null })   // sign in, sign up, or ask for a reset link
page("/reset-password", () => <NexoResetPasswordForm />, { layout: null })   // the reset email's link
page("/verify-email", () => <NexoVerifyEmail />)                              // the verification email's link

function Header() {
  const { user, signedIn, logout, hasScope } = useAuth();
  return signedIn ? <button onClick={logout}>Sign out {user!.email}</button> : <NexoLink to="/login">Sign in</NexoLink>;
}
```

`client.auth.login/register/logout/me` (plus `requestPasswordReset`, `resetPassword`,
`verifyEmail`, `resendVerification`) underlie these. The session
(`client.session`) is kept in localStorage in browsers (`new NexoSession({ storage: null })`
keeps it in memory only). Every request sends its token, and any 401 for that token
signs the client out.

**Common mistakes.** Storing the token yourself. The session already does that,
and an explicit `auth: { token }` on the client overrides it.

---

## page / NexoApp

**Purpose.** The app shell: API client, routing, layouts and protected pages
in one place.

```tsx
const pages = [
  page("/", Home),
  page("/users", UsersPage),
  page("/users/:id", UserPage),                  // UserPage receives { params: { id } }
  page("/admin", AdminPage, { protect: true }),
  page("/login", LoginPage, { layout: null })
];

<NexoApp pages={pages} layout={MainLayout} baseUrl="/" />
```

Protected pages follow the client's session (see `useAuth`). Signed-out
visitors are sent to `loginPath?next=<path>` (default `/login`), and
`NexoLoginForm` sends them back after signing in. On start, a stored session is
checked with the server once. Pass `isAuthenticated` only to replace the check
with your own.
Navigate with `useNexoNavigate()` or `<NexoLink to="/users">`.

---

## CLI

```bash
nexo generate resource invoice   # src/invoices/{invoice.model.ts, invoices.api.ts, invoices.page.tsx}
nexo generate page settings      # src/pages/settings.page.tsx
```

Existing files are never overwritten without `--force`.

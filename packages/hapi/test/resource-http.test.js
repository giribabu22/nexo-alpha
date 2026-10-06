/**
 * resource() served over HTTP: status codes, error bodies, query decoding,
 * auth scopes, and the caller's identity reaching beforeWrite.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createApplication,
  createInMemoryDocumentStore,
  field,
  jwtAuthenticator,
  model,
  resource,
  signToken,
  NexoValidationError
} from "@nexo-alpha/core";
import { createHapiServer } from "../dist/index.js";

const SECRET = "resource-http-test-secret-0123456789abcdef";

const Note = model("notes", {
  title: field.string({ minLength: 1 }),
  pinned: field.boolean().default(false),
  priority: field.number({ min: 1, max: 5 }).optional(),
  author: field.string().optional()
});

async function serve(options = {}) {
  const app = createApplication({ name: "notes-app" });
  const notes = resource(Note, {
    store: createInMemoryDocumentStore(),
    searchable: ["title"],
    beforeWrite: (record, { operation, request }) =>
      operation === "create" && request?.auth?.identity?.sub ? { ...record, author: request.auth.identity.sub } : record,
    ...options
  });
  app.module(notes);
  const server = await createHapiServer(app, {
    logging: false,
    authenticate: jwtAuthenticator({ secret: SECRET })
  });
  return { server, notes };
}

const json = (response) => JSON.parse(response.payload);
const bearer = (claims) => ({ authorization: `Bearer ${signToken(claims, SECRET, { expiresInSeconds: 60 })}` });

test("CRUD round trip with REST status codes", async () => {
  const { server } = await serve();

  const created = await server.inject({ method: "POST", url: "/api/notes", payload: { title: "First" } });
  assert.equal(created.statusCode, 201);
  const note = json(created);
  assert.equal(created.headers.location, `/api/notes/${note.id}`);
  assert.equal(note.pinned, false);

  const fetched = await server.inject(`/api/notes/${note.id}`);
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(json(fetched), note);

  const patched = await server.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { pinned: true } });
  assert.equal(patched.statusCode, 200);
  assert.equal(json(patched).pinned, true);

  const deleted = await server.inject({ method: "DELETE", url: `/api/notes/${note.id}` });
  assert.equal(deleted.statusCode, 204);

  const missing = await server.inject(`/api/notes/${note.id}`);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(json(missing), { error: `notes "${note.id}" not found.`, code: "NOT_FOUND" });
});

test("invalid bodies answer 400 with every validation message", async () => {
  const { server } = await serve();

  const missing = await server.inject({ method: "POST", url: "/api/notes", payload: { priority: 9 } });
  assert.equal(missing.statusCode, 400);
  assert.deepEqual(json(missing), {
    error: "Validation failed",
    errors: ['Field "body.title" is required.', 'Field "body.priority" must be <= 5, got 9.']
  });

  // Unknown fields pass the route's schema check but are rejected by the model: still 400, not 500.
  const unknown = await server.inject({ method: "POST", url: "/api/notes", payload: { title: "x", titel: "typo" } });
  assert.equal(unknown.statusCode, 400);
  assert.deepEqual(json(unknown).errors, ['Field "body.titel" is not a field of model "notes".']);

  // Every problem in one answer: unknown fields and field errors together.
  const both = await server.inject({ method: "POST", url: "/api/notes", payload: { titel: "typo", priority: 9 } });
  assert.deepEqual(json(both).errors, [
    'Field "body.titel" is not a field of model "notes".',
    'Field "body.title" is required.',
    'Field "body.priority" must be <= 5, got 9.'
  ]);
});

test("list decodes paging, sorting, search and typed filters from the query string", async () => {
  const { server, notes } = await serve();
  for (const [title, pinned, priority] of [["Alpha", true, 3], ["Beta", false, 1], ["Alphabet", false, 2]]) {
    await notes.create({ title, pinned, priority });
  }

  const pinned = json(await server.inject("/api/notes?pinned=true"));
  assert.deepEqual(pinned.items.map((n) => n.title), ["Alpha"]);

  const page = json(await server.inject("/api/notes?search=alpha&sort=-priority&limit=1&offset=1"));
  assert.deepEqual({ ...page, items: page.items.map((n) => n.title) }, { items: ["Alphabet"], total: 2, limit: 1, offset: 1 });

  const bad = await server.inject("/api/notes?priority=high&color=red");
  assert.equal(bad.statusCode, 400);
  assert.equal(json(bad).errors.length, 2);
});

test("auth scopes protect writes; the caller's identity reaches beforeWrite", async () => {
  const { server } = await serve({ auth: { write: ["notes:write"] } });

  assert.equal((await server.inject("/api/notes")).statusCode, 200);
  assert.equal((await server.inject({ method: "POST", url: "/api/notes", payload: { title: "x" } })).statusCode, 401);

  const forbidden = await server.inject({
    method: "POST",
    url: "/api/notes",
    payload: { title: "x" },
    headers: bearer({ sub: "ann", scopes: ["notes:read"] })
  });
  assert.equal(forbidden.statusCode, 403);
  assert.deepEqual(json(forbidden).missingScopes, ["notes:write"]);

  const allowed = await server.inject({
    method: "POST",
    url: "/api/notes",
    payload: { title: "x" },
    headers: bearer({ sub: "ann", scopes: ["notes:write"] })
  });
  assert.equal(allowed.statusCode, 201);
  assert.equal(json(allowed).author, "ann");
});

test("a NexoValidationError thrown by any handler answers 400", async () => {
  const app = createApplication({ name: "plain" });
  app.module({
    name: "plain",
    apis: [{ name: "check", method: "POST", path: "/check", handler: () => { throw new NexoValidationError("Bad input."); } }]
  });
  const server = await createHapiServer(app, { logging: false });
  const response = await server.inject({ method: "POST", url: "/check" });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(json(response), { error: "Validation failed", errors: ["Bad input."] });
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  api,
  model,
  field,
  resource,
  createApplication,
  createInMemoryDocumentStore,
  createRequestContext,
  NexoHttpError,
  NexoValidationError,
  NexoConfigurationError,
  isHttpResponse
} from "../dist/index.js";

const Customer = model("customers", {
  name: field.string({ minLength: 1 }),
  tier: field.enum(["free", "pro"]).default("free")
});

const Order = model("orders", {
  customerId: field.ref("customers"),
  total: field.number({ min: 0 }),
  note: field.string().optional()
});

function setup(options = {}) {
  const store = createInMemoryDocumentStore();
  const customers = resource(Customer, { store, searchable: ["name"], ...options });
  const orders = resource(Order, { store });
  return { store, customers, orders };
}

test("create stamps id and timestamps and stores the record", async () => {
  const { customers, store } = setup();
  const ann = await customers.create({ name: "Ann" });
  assert.match(ann.id, /^[0-9a-f-]{36}$/);
  assert.equal(ann.tier, "free");
  assert.equal(ann.createdAt, ann.updatedAt);
  assert.deepEqual(await store.get("customers", ann.id), ann);
  assert.deepEqual(await customers.get(ann.id), ann);
});

test("get, update and delete answer 404 for a missing record", async () => {
  const { customers } = setup();
  for (const call of [() => customers.get("nope"), () => customers.update("nope", {}), () => customers.delete("nope")]) {
    await assert.rejects(call, (error) => error instanceof NexoHttpError && error.statusCode === 404);
  }
});

test("update merges fields, clears with null and bumps updatedAt", async () => {
  const { customers, orders } = setup();
  const ann = await customers.create({ name: "Ann" });
  const order = await orders.create({ customerId: ann.id, total: 10, note: "gift" });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const updated = await orders.update(order.id, { total: 12, note: null });
  assert.equal(updated.total, 12);
  assert.equal("note" in updated, false);
  assert.equal(updated.createdAt, order.createdAt);
  assert.ok(updated.updatedAt > order.updatedAt);
});

test("refs must point at existing records; updates only check refs they change", async () => {
  const { customers, orders } = setup();
  await assert.rejects(
    () => orders.create({ customerId: "ghost", total: 1 }),
    (error) => error instanceof NexoValidationError && /missing customers record "ghost"/.test(error.errors[0])
  );
  const ann = await customers.create({ name: "Ann" });
  const order = await orders.create({ customerId: ann.id, total: 1 });
  await customers.delete(ann.id);
  await assert.doesNotReject(() => orders.update(order.id, { total: 2 }));
  await assert.rejects(() => orders.update(order.id, { customerId: "ghost" }), NexoValidationError);
});

test("list filters, searches, sorts and pages", async () => {
  const { customers } = setup();
  for (const [name, tier] of [["Ann", "pro"], ["Bob", "free"], ["Annabel", "free"], ["Cy", "pro"]]) {
    await customers.create({ name, tier });
  }
  const all = await customers.list();
  assert.equal(all.total, 4);
  assert.deepEqual(all.items.map((c) => c.name), ["Ann", "Bob", "Annabel", "Cy"]);
  assert.equal(all.limit, 50);

  assert.deepEqual((await customers.list({ where: { tier: "pro" } })).items.map((c) => c.name), ["Ann", "Cy"]);
  assert.deepEqual((await customers.list({ search: "ANN" })).items.map((c) => c.name), ["Ann", "Annabel"]);
  assert.deepEqual((await customers.list({ sort: "-name" })).items.map((c) => c.name), ["Cy", "Bob", "Annabel", "Ann"]);

  const page = await customers.list({ sort: "name", limit: 2, offset: 2 });
  assert.deepEqual(page, { items: page.items, total: 4, limit: 2, offset: 2 });
  assert.deepEqual(page.items.map((c) => c.name), ["Bob", "Cy"]);
});

test("list caps the page size at maxLimit", async () => {
  const { customers } = setup({ maxLimit: 3 });
  assert.equal((await customers.list({ limit: 1000 })).limit, 3);
});

test("search on a resource without searchable fields is a validation error", async () => {
  const { orders } = setup();
  await assert.rejects(() => orders.list({ search: "x" }), NexoValidationError);
});

test("beforeWrite can compute fields and refuse writes; its result is re-validated", async () => {
  const store = createInMemoryDocumentStore();
  const customers = resource(Customer, {
    store,
    beforeWrite: (record, { operation, request }) => {
      if (record.name === "blocked") throw new NexoHttpError(403, "FORBIDDEN", "Not allowed.");
      if (record.name === "bad") return { ...record, tier: "platinum" };
      return { ...record, name: record.name.trim(), id: "hijack", tier: operation === "create" && request ? "pro" : record.tier };
    }
  });
  const direct = await customers.create({ name: "  Ann  " });
  assert.equal(direct.name, "Ann");
  assert.notEqual(direct.id, "hijack");
  assert.equal(direct.tier, "free");
  await assert.rejects(() => customers.create({ name: "blocked" }), (e) => e.statusCode === 403);
  await assert.rejects(() => customers.create({ name: "bad" }), /beforeWrite produced an invalid customers/);
});

test("concurrent updates to one record are all applied", async () => {
  const store = createInMemoryDocumentStore();
  const Counter = model("counters", { n: field.number() });
  const counters = resource(Counter, {
    store,
    // Read-modify-write inside beforeWrite would lose updates without compare-and-swap.
    beforeWrite: async (record, { existing }) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return existing ? { ...record, n: existing.n + 1 } : record;
    }
  });
  const counter = await counters.create({ n: 0 });
  await Promise.all([1, 2, 3].map(() => counters.update(counter.id, {})));
  assert.equal((await counters.get(counter.id)).n, 3);
});

test("resource is a NexoModule serving five REST APIs", async () => {
  const { customers } = setup();
  const app = createApplication({ name: "shop" });
  app.module(customers);
  assert.deepEqual(
    app.getApis().map((a) => `${a.name} ${a.method} ${a.path}`),
    [
      "customers.list GET /api/customers",
      "customers.get GET /api/customers/:id",
      "customers.create POST /api/customers",
      "customers.update PATCH /api/customers/:id",
      "customers.delete DELETE /api/customers/:id"
    ]
  );

  const create = app.getApis().find((a) => a.name === "customers.create");
  const created = await create.handler(createRequestContext({ payload: { name: "Ann" } }));
  assert.ok(isHttpResponse(created));
  assert.equal(created.statusCode, 201);
  assert.equal(created.headers.location, `/api/customers/${created.body.id}`);

  const list = app.getApis().find((a) => a.name === "customers.list");
  const listed = await list.handler(createRequestContext({ query: { tier: "free", limit: "5" } }));
  assert.equal(listed.total, 1);
  assert.equal(listed.limit, 5);
});

test("expose, path and auth options shape the APIs", () => {
  const store = createInMemoryDocumentStore();
  const readOnly = resource(Customer, { store, expose: ["list", "get"], path: "/v2/clients/" });
  assert.deepEqual(readOnly.apis.map((a) => `${a.method} ${a.path}`), ["GET /v2/clients", "GET /v2/clients/:id"]);

  const all = resource(Customer, { store, auth: true });
  assert.ok(all.apis.every((a) => a.auth?.required === true && a.auth.scopes === undefined));

  const scoped = resource(Customer, { store, auth: { write: ["customers:write"] } });
  assert.deepEqual(scoped.apis.map((a) => a.auth?.scopes ?? null), [null, null, ["customers:write"], ["customers:write"], ["customers:write"]]);
});

test("resource() rejects fields that collide with list parameters and unknown searchable fields", () => {
  const store = createInMemoryDocumentStore();
  assert.throws(() => resource(model("posts", { sort: field.number() }), { store }), NexoConfigurationError);
  assert.throws(() => resource(Customer, { store, searchable: ["email"] }), /searchable field "email"/);
});

test("api.get/post/... build NexoApi declarations", () => {
  const handler = () => "ok";
  assert.deepEqual(api.get("/api/ping", handler), { name: "GET /api/ping", method: "GET", path: "/api/ping", handler });
  const post = api.post("/api/jobs", handler, { name: "startJob", auth: { required: true } });
  assert.equal(post.name, "startJob");
  assert.equal(post.method, "POST");
  assert.deepEqual(post.auth, { required: true });
  assert.equal(api.delete("/x", handler).method, "DELETE");
});

test("per-operation scopes override their read/write group", () => {
  const store = createInMemoryDocumentStore();
  const notes = resource(Customer, { store, auth: { read: ["c:read"], write: ["c:write"], delete: ["c:admin"] } });
  assert.deepEqual(
    Object.fromEntries(notes.apis.map((a) => [a.name.split(".")[1], a.auth.scopes])),
    { list: ["c:read"], get: ["c:read"], create: ["c:write"], update: ["c:write"], delete: ["c:admin"] }
  );
  const onlyDelete = resource(Customer, { store, auth: { delete: ["c:admin"] } });
  assert.deepEqual(onlyDelete.apis.map((a) => a.auth?.scopes ?? null), [null, null, null, null, ["c:admin"]]);
});

test("onChange receives every stored change, with the previous record and the request", async () => {
  const changes = [];
  const store = createInMemoryDocumentStore();
  const customers = resource(Customer, { store, onChange: (change) => void changes.push(change) });
  const ann = await customers.create({ name: "Ann" });
  const pro = await customers.update(ann.id, { tier: "pro" });
  const del = customers.apis.find((a) => a.name === "customers.delete");
  const request = createRequestContext({ params: { id: ann.id } });
  await del.handler(request);

  assert.deepEqual(changes.map((c) => [c.operation, c.record.tier, c.previous?.tier ?? null]), [
    ["create", "free", null],
    ["update", "pro", "free"],
    ["delete", "pro", null]
  ]);
  assert.deepEqual(changes[1].record, pro);
  assert.equal(changes[0].request, undefined);
  assert.equal(changes[2].request, request);
});

test("an onChange failure reaches the caller, but the change stays stored", async () => {
  const store = createInMemoryDocumentStore();
  const customers = resource(Customer, { store, onChange: () => { throw new Error("webhook down"); } });
  await assert.rejects(() => customers.create({ name: "Ann" }), /webhook down/);
  assert.equal((await store.list("customers")).length, 1);
});

test("field descriptions appear in the API schema", () => {
  const Thing = model("things", { sku: field.string().describe("Stock keeping unit, e.g. ABC-123") });
  assert.equal(Thing.schema.properties.sku.description, "Stock keeping unit, e.g. ABC-123");
  assert.equal(resource(Thing, { store: createInMemoryDocumentStore() }).apis[2].schema.body.properties.sku.description, "Stock keeping unit, e.g. ABC-123");
});

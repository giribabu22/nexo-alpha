import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  queryDocuments,
  runInProject,
  scopeByProject,
  model,
  field,
  resource
} from "../dist/index.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);
const SQLITE = { skip: !HAS_SQLITE && "node:sqlite not available" };

const NAMES = ["ann", "Ann", "ANNA", "bob", "Bobby", "cy", "Zoe", "zed", "Éva", "éva", "o'brien", "100%_sure"];
const CATEGORIES = ["tools", "toys", "books"];

/** Deterministic pseudo-random numbers, so a failure can be reproduced. */
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function dataset(next) {
  return Array.from({ length: 300 }, (_, index) => {
    const doc = { id: `d${index}`, name: NAMES[Math.floor(next() * NAMES.length)] };
    if (next() < 0.85) doc.price = Math.floor(next() * 50) / 2;
    if (next() < 0.7) doc.category = CATEGORIES[Math.floor(next() * CATEGORIES.length)]; // else: falls back to the default
    if (next() < 0.9) doc.active = next() < 0.5;
    if (next() < 0.5) doc.note = `${NAMES[Math.floor(next() * NAMES.length)]} note`;
    return doc;
  });
}

function randomQuery(next) {
  const query = { defaults: { category: "tools" } };
  const roll = () => next();
  if (roll() < 0.4) query.where = { category: CATEGORIES[Math.floor(roll() * 3)] };
  if (roll() < 0.3) query.where = { ...query.where, active: roll() < 0.5 };
  if (roll() < 0.2) query.where = { ...query.where, price: Math.floor(roll() * 10) };
  if (roll() < 0.4) query.search = { text: ["AN", "an", "ob", "é", "%", "_", "'", "note", "zz"][Math.floor(roll() * 9)], fields: ["name", "note"] };
  if (roll() < 0.8) query.sort = { field: ["name", "price", "category", "active", "note", "id"][Math.floor(roll() * 6)], descending: roll() < 0.5 };
  if (roll() < 0.7) query.limit = Math.floor(roll() * 40);
  if (roll() < 0.5) query.offset = Math.floor(roll() * 60);
  return query;
}

test("SQLite query() gives exactly the in-memory results for random queries", SQLITE, async () => {
  const next = random(42);
  const docs = dataset(next);
  const sqlite = await createSqliteDocumentStore(":memory:");
  for (const doc of docs) await sqlite.put("items", doc.id, doc);
  // Indexes must not change results.
  await sqlite.index("items", "category", { default: "tools" });
  await sqlite.index("items", "active");

  for (let i = 0; i < 400; i++) {
    const query = randomQuery(next);
    const expected = queryDocuments(docs, query);
    const actual = await sqlite.query("items", query);
    assert.deepEqual(
      { total: actual.total, ids: actual.items.map((d) => d.id) },
      { total: expected.total, ids: expected.items.map((d) => d.id) },
      JSON.stringify(query)
    );
  }
  await sqlite.close();
});

test("queryDocuments rules: missing values last both ways, ASCII-only case folding, stable ties", () => {
  const docs = [
    { id: "1", name: "b" },
    { id: "2" },
    { id: "3", name: "A" },
    { id: "4", name: "a" },
    { id: "5", name: "É" }
  ];
  const ids = (query) => queryDocuments(docs, query).items.map((d) => d.id);
  assert.deepEqual(ids({ sort: { field: "name" } }), ["3", "4", "1", "5", "2"]);
  assert.deepEqual(ids({ sort: { field: "name", descending: true } }), ["5", "1", "3", "4", "2"]);
  assert.deepEqual(ids({ search: { text: "A", fields: ["name"] } }), ["3", "4"]);
  assert.deepEqual(ids({ search: { text: "é", fields: ["name"] } }), []);
  assert.deepEqual(ids({ where: { name: "x" }, defaults: { name: "x" } }), ["2"]);
  assert.throws(() => queryDocuments(docs, { sort: { field: "a') OR 1=1 --" } }), /Invalid query field/);
});

test("SQLite query() rejects field names that are not plain identifiers", SQLITE, async () => {
  const sqlite = await createSqliteDocumentStore(":memory:");
  await sqlite.put("items", "a", { name: "x" });
  for (const field of ["name') OR 1=1 --", "a.b", "$", ""]) {
    await assert.rejects(() => sqlite.query("items", { where: { [field]: "x" } }), /Invalid query field/);
  }
  await sqlite.close();
});

test("scopeByProject forwards query() and keeps projects apart", SQLITE, async () => {
  const scoped = scopeByProject(await createSqliteDocumentStore(":memory:"));
  await runInProject("p1", () => scoped.put("items", "a", { name: "one" }));
  await runInProject("p2", () => scoped.put("items", "b", { name: "two" }));
  const result = await runInProject("p1", () => scoped.query("items", {}));
  assert.deepEqual(result, { items: [{ name: "one" }], total: 1 });
  assert.equal(scopeByProject(createInMemoryDocumentStore()).query, undefined);
});

test("resource() lists the same way on SQLite and in memory, including old records missing a defaulted field", SQLITE, async () => {
  const Product = model("products", {
    name: field.string(),
    price: field.number(),
    category: field.enum(["tools", "toys"]).default("tools")
  });
  const memory = createInMemoryDocumentStore();
  const sqlite = await createSqliteDocumentStore(":memory:");
  for (const store of [memory, sqlite]) {
    // Written before `category` existed.
    await store.put("products", "old", { id: "old", name: "Old saw", price: 5, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" });
  }
  const lists = [];
  for (const store of [memory, sqlite]) {
    const products = resource(Product, { store, searchable: ["name"] });
    await products.create({ name: "Hammer", price: 12 });
    await products.create({ name: "kite", price: 30, category: "toys" });
    lists.push(await products.list({ where: { category: "tools" }, sort: "-price", search: "a" }));
  }
  assert.deepEqual(lists[0].items.map((p) => p.name), ["Hammer", "Old saw"]);
  assert.equal(lists[0].items[1].category, "tools", "defaults are filled in on the way out");
  assert.deepEqual(lists[1].items.map((p) => [p.name, p.category]), lists[0].items.map((p) => [p.name, p.category]));
  assert.equal(lists[1].total, lists[0].total);
  await sqlite.close();
});

test("resource() only allows text fields as searchable", () => {
  const Thing = model("things", { title: field.string(), count: field.number() });
  assert.throws(() => resource(Thing, { store: createInMemoryDocumentStore(), searchable: ["count"] }), /must hold text/);
});

test("index() makes filters use an index, including fields with defaults", SQLITE, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-index-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "data.db");
  const store = await createSqliteDocumentStore(file);
  const Order = model("orders", {
    customerId: field.ref("customers"),
    status: field.enum(["open", "paid"]).default("open")
  });
  const orders = resource(Order, { store, indexes: ["customerId", "status"] });
  await store.put("customers", "c1", { id: "c1" });
  await orders.create({ customerId: "c1" });
  await orders.list({ where: { status: "open" } }); // first list creates the indexes

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("orders", "x").map((row) => row.detail).join(" | ");
  const byCustomer = plan("SELECT data FROM nexo_documents WHERE collection = ? AND json_extract(data, '$.customerId') = ?");
  const byStatus = plan("SELECT data FROM nexo_documents WHERE collection = ? AND COALESCE(json_extract(data, '$.status'), 'open') = ?");
  assert.match(byCustomer, /USING INDEX nexo_documents_field_/);
  assert.match(byStatus, /USING INDEX nexo_documents_field_/);
  db.close();
  await store.close();
});

test("resource() indexes ref fields by default and checks index field names", async () => {
  const calls = [];
  const base = createInMemoryDocumentStore();
  const store = { ...base, query: undefined, index: async (collection, name, options) => void calls.push([collection, name, options]) };
  delete store.query;
  const Order = model("orders", { customerId: field.ref("customers"), tags: field.array(field.ref("tags")), total: field.number() });
  const orders = resource(Order, { store });
  await orders.list();
  await orders.list();
  assert.deepEqual(calls, [["orders", "customerId", {}]], "once, and only plain ref fields");
  assert.throws(() => resource(Order, { store, indexes: ["nope"] }), /indexed field "nope"/);
});

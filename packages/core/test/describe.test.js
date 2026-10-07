import test from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryDocumentStore,
  describeModel,
  describeResource,
  field,
  isResource,
  model,
  resource,
  toJsonSchema
} from "../dist/index.js";
import * as browser from "../dist/model-entry.js";

const Order = model("orders", {
  customerId: field.ref("customers").describe("Who placed the order"),
  qty: field.number({ min: 1, integer: true }),
  status: field.enum(["open", "paid"]).default("open"),
  note: field.text({ maxLength: 500 }).optional(),
  tags: field.array(field.string())
});

test("describeModel describes every field as plain JSON", () => {
  const described = describeModel(Order);
  assert.equal(described.name, "orders");
  assert.deepEqual(described.fields.customerId, {
    kind: "ref", presence: "required", label: "Customer id", description: "Who placed the order", ref: "customers", minLength: 1
  });
  assert.deepEqual(described.fields.qty, { kind: "number", presence: "required", label: "Qty", min: 1, integer: true });
  assert.deepEqual(described.fields.status, { kind: "enum", presence: "defaulted", label: "Status", default: "open", values: ["open", "paid"] });
  assert.equal(described.fields.note.presence, "optional");
  assert.equal(described.fields.tags.item.kind, "string");
  assert.deepEqual(JSON.parse(JSON.stringify(described)), described);
});

test("toJsonSchema turns a model's create schema into JSON Schema", () => {
  const schema = toJsonSchema(Order.schema);
  assert.equal(schema.type, "object");
  assert.deepEqual([...schema.required].sort(), ["customerId", "qty", "tags"]);
  assert.deepEqual(schema.properties.qty, { type: "integer", minimum: 1 });
  assert.deepEqual(schema.properties.status, { type: "string", enum: ["open", "paid"] });
  assert.deepEqual(schema.properties.note, { type: "string", maxLength: 500 });
  assert.deepEqual(schema.properties.tags, { type: "array", items: { type: "string" } });
});

test("toJsonSchema maps array lengths, patterns and both required forms", () => {
  const schema = toJsonSchema({
    type: "object",
    required: ["a"],
    properties: {
      a: { type: "string", pattern: /^\d+$/ },
      b: { type: "array", minLength: 1, maxLength: 3, items: { type: "number" }, required: true }
    }
  });
  assert.deepEqual(schema.required, ["a", "b"]);
  assert.equal(schema.properties.a.pattern, "^\\d+$");
  assert.deepEqual(schema.properties.b, { type: "array", minItems: 1, maxItems: 3, items: { type: "number" } });
});

test("describeResource lists the operations served, with their auth", async () => {
  const orders = resource(Order, {
    store: createInMemoryDocumentStore(),
    searchable: ["note"],
    auth: { write: ["orders:write"], delete: ["orders:admin"] },
    expose: ["list", "get", "create", "delete"]
  });

  assert.equal(isResource(orders), true);
  assert.equal(isResource({ name: "plain", apis: [] }), false);

  const described = describeResource(orders);
  assert.equal(described.path, "/api/orders");
  assert.deepEqual(described.searchable, ["note"]);
  assert.equal(described.model.name, "orders");
  assert.deepEqual(described.operations, [
    { operation: "list", method: "GET", path: "/api/orders", authenticated: false, scopes: [] },
    { operation: "get", method: "GET", path: "/api/orders/:id", authenticated: false, scopes: [] },
    { operation: "create", method: "POST", path: "/api/orders", authenticated: true, scopes: ["orders:write"] },
    { operation: "delete", method: "DELETE", path: "/api/orders/:id", authenticated: true, scopes: ["orders:admin"] }
  ]);
});

test("describeModel and toJsonSchema are in the browser-safe entry", () => {
  assert.equal(browser.describeModel, describeModel);
  assert.equal(browser.toJsonSchema, toJsonSchema);
});

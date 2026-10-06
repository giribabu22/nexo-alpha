import test from "node:test";
import assert from "node:assert/strict";

import {
  model,
  field,
  errorsByField,
  humanize,
  encodeListQuery,
  decodeListQuery,
  NexoValidationError,
  NexoConfigurationError,
  validateSchema
} from "../dist/index.js";
import * as browserEntry from "../dist/model-entry.js";

const User = model("users", {
  name: field.string({ minLength: 1, maxLength: 50 }),
  email: field.email(),
  role: field.enum(["member", "admin"]).default("member"),
  age: field.number({ min: 0, integer: true }).optional(),
  active: field.boolean().default(true),
  bio: field.text().optional().labelled("About"),
  birthday: field.date().optional(),
  tags: field.array(field.string()).default([])
});

test("parse applies defaults and keeps only declared fields", () => {
  const values = User.parse({ name: "Ann", email: "ann@example.com", id: "ignored", createdAt: "ignored" });
  assert.deepEqual(values, { name: "Ann", email: "ann@example.com", role: "member", active: true, tags: [] });
});

test("parse rejects missing, invalid and unknown fields with every message at once", () => {
  assert.throws(
    () => User.parse({ email: "nope", role: "owner", emial: "typo" }),
    (error) => {
      assert.ok(error instanceof NexoValidationError);
      assert.deepEqual(error.errors, [
        'Field "body.emial" is not a field of model "users".',
        'Field "body.name" is required.',
        'Field "body.email" does not match required pattern.',
        'Field "body.role" must be one of: [member, admin], got "owner".'
      ]);
      return true;
    }
  );
});

test("defaults are copied, not shared between records", () => {
  const a = User.parse({ name: "A", email: "a@example.com" });
  a.tags.push("x");
  const b = User.parse({ name: "B", email: "b@example.com" });
  assert.deepEqual(b.tags, []);
});

test("dates must be ISO 8601 and real", () => {
  assert.equal(User.validate({ name: "A", email: "a@example.com", birthday: "2026-10-06" }).valid, true);
  assert.equal(User.validate({ name: "A", email: "a@example.com", birthday: "2026-10-06T10:00:00Z" }).valid, true);
  assert.equal(User.validate({ name: "A", email: "a@example.com", birthday: "06/10/2026" }).valid, false);
  assert.deepEqual(User.validate({ name: "A", email: "a@example.com", birthday: "2026-13-45" }).errors, [
    'Field "body.birthday" is not a valid date.'
  ]);
});

test("parsePatch returns only sent fields; null clears optional fields only", () => {
  assert.deepEqual(User.parsePatch({ age: 30 }), { age: 30 });
  assert.deepEqual(User.parsePatch({ age: null }), { age: null });
  assert.throws(() => User.parsePatch({ name: null }), /cannot be cleared/);
  assert.throws(() => User.parsePatch({ role: null }), /cannot be cleared/);
  assert.deepEqual(User.parsePatch({}), {});
});

test("hydrate fills defaults for fields added after a record was stored", () => {
  const stored = { id: "u1", name: "Old", email: "old@example.com", createdAt: "t", updatedAt: "t" };
  assert.deepEqual(User.hydrate(stored), { ...stored, role: "member", active: true, tags: [] });
});

test("schemas are plain NexoFieldSchema, usable by the existing validateSchema", () => {
  assert.deepEqual(User.schema.required, ["name", "email"]);
  assert.equal(User.patchSchema.required, undefined);
  assert.deepEqual(User.recordSchema.required, ["id", "name", "email", "role", "active", "tags", "createdAt", "updatedAt"]);
  const outcome = validateSchema({ body: User.schema }, { payload: { email: "a@example.com" } });
  assert.deepEqual(outcome.errors, ['Field "body.name" is required.']);
});

test("labels come from labelled() or the field key", () => {
  assert.equal(User.label("bio"), "About");
  assert.equal(User.label("email"), "Email");
  assert.equal(humanize("createdAt"), "Created at");
  assert.equal(humanize("customer_id"), "Customer id");
});

test("model() rejects bad names and system field names", () => {
  assert.throws(() => model("User", {}), NexoConfigurationError);
  assert.throws(() => model("order_items", {}), NexoConfigurationError);
  assert.doesNotThrow(() => model("order-items", {}));
  assert.throws(() => model("users", { id: field.string() }), /already has/);
  assert.throws(() => model("users", { "bad-key": field.string() }), /invalid field name/);
});

test("errorsByField groups messages by the field they name", () => {
  const outcome = User.validate({ email: "x" });
  assert.deepEqual(Object.keys(errorsByField(outcome.errors)), ["name", "email"]);
  assert.deepEqual(errorsByField(["Something else broke."]), { "": ["Something else broke."] });
});

test("list query round-trips through the query string with typed filters", () => {
  const encoded = encodeListQuery({ limit: 10, offset: 20, sort: "-age", search: "an", where: { age: 30, active: false } });
  assert.deepEqual(encoded, { limit: "10", offset: "20", sort: "-age", search: "an", age: "30", active: "false" });
  assert.deepEqual(decodeListQuery(User, encoded), {
    limit: 10,
    offset: 20,
    sort: "-age",
    search: "an",
    where: { age: 30, active: false }
  });
});

test("decodeListQuery reports every bad parameter", () => {
  assert.throws(
    () => decodeListQuery(User, { limit: "-1", sort: "password", age: "old", active: "yes", tags: "a", nope: "1" }),
    (error) => {
      assert.ok(error instanceof NexoValidationError);
      assert.equal(error.errors.length, 6);
      assert.match(error.errors[5], /query\.nope.*is not a list parameter/);
      return true;
    }
  );
});

test("the browser entry exposes model building without Node-only code", () => {
  assert.equal(browserEntry.model, model);
  assert.equal(browserEntry.field, field);
  assert.equal(typeof browserEntry.encodeListQuery, "function");
  assert.equal(browserEntry.resource, undefined);
  assert.equal(browserEntry.createFileDocumentStore, undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateField,
  validateSchema,
  createSchemaValidator,
  assertValid,
  isApiSchema,
  NexoValidationError
} from "../dist/index.js";

test("validateField: primitive string validation (required, length, pattern, enum)", () => {
  // Required check
  assert.equal(validateField({ type: "string", required: true }, undefined).valid, false);
  assert.equal(validateField({ type: "string", required: false }, undefined).valid, true);

  // Type check
  assert.equal(validateField({ type: "string" }, 123).valid, false);
  assert.equal(validateField({ type: "string" }, "hello").valid, true);

  // Min and Max length
  const boundedStr = { type: "string", minLength: 3, maxLength: 8 };
  assert.equal(validateField(boundedStr, "hi").valid, false);
  assert.equal(validateField(boundedStr, "toolongstring").valid, false);
  assert.equal(validateField(boundedStr, "valid").valid, true);

  // Pattern
  const patterned = { type: "string", pattern: "^[a-z]+$" };
  assert.equal(validateField(patterned, "abc").valid, true);
  assert.equal(validateField(patterned, "abc123").valid, false);

  // Enum
  const enumerated = { type: "string", enum: ["active", "suspended", "pending"] };
  assert.equal(validateField(enumerated, "active").valid, true);
  assert.equal(validateField(enumerated, "deleted").valid, false);
});

test("validateField: primitive number validation (integer, bounds, enum)", () => {
  assert.equal(validateField({ type: "number", required: true }, null).valid, false);
  assert.equal(validateField({ type: "number" }, "not a number").valid, false);
  assert.equal(validateField({ type: "number" }, NaN).valid, false);
  assert.equal(validateField({ type: "number" }, 42).valid, true);

  // Integer
  const intSchema = { type: "number", integer: true };
  assert.equal(validateField(intSchema, 10).valid, true);
  assert.equal(validateField(intSchema, 10.5).valid, false);

  // Min and Max bounds
  const rangeSchema = { type: "number", min: 1, max: 100 };
  assert.equal(validateField(rangeSchema, 0).valid, false);
  assert.equal(validateField(rangeSchema, 101).valid, false);
  assert.equal(validateField(rangeSchema, 50).valid, true);
  assert.equal(validateField(rangeSchema, 1).valid, true);
  assert.equal(validateField(rangeSchema, 100).valid, true);
});

test("validateField: boolean validation", () => {
  assert.equal(validateField({ type: "boolean" }, true).valid, true);
  assert.equal(validateField({ type: "boolean" }, false).valid, true);
  assert.equal(validateField({ type: "boolean" }, "true").valid, false);
});

test("validateField: recursive array and item validation", () => {
  const arraySchema = {
    type: "array",
    minLength: 1,
    maxLength: 3,
    items: { type: "number", min: 0 }
  };

  assert.equal(validateField(arraySchema, "not array").valid, false);
  assert.equal(validateField(arraySchema, []).valid, false); // minLength 1
  assert.equal(validateField(arraySchema, [1, 2, 3, 4]).valid, false); // maxLength 3
  assert.equal(validateField(arraySchema, [10, 20]).valid, true);
  assert.equal(validateField(arraySchema, [10, -5]).valid, false); // negative rejected
});

test("validateField: recursive nested object validation", () => {
  const userSchema = {
    type: "object",
    properties: {
      id: { type: "number", required: true, integer: true },
      name: { type: "string", required: true, minLength: 2 },
      address: {
        type: "object",
        properties: {
          city: { type: "string", required: true },
          zip: { type: "string", pattern: "^\\d{5}$" }
        }
      }
    }
  };

  // Valid object
  const validUser = {
    id: 1,
    name: "Alice",
    address: { city: "New York", zip: "10001" }
  };
  const resValid = validateField(userSchema, validUser);
  assert.equal(resValid.valid, true);

  // Missing required property in nested object
  const invalidUser = {
    id: 1,
    name: "Alice",
    address: { zip: "10001" } // city missing
  };
  const resInvalid = validateField(userSchema, invalidUser);
  assert.equal(resInvalid.valid, false);
  assert.match(resInvalid.errors[0], /city/);
});

test("validateSchema: full NexoApiSchema validation (params, query, body)", () => {
  const apiSchema = {
    params: {
      userId: { type: "string", required: true, minLength: 3 }
    },
    query: {
      limit: { type: "number", min: 1, max: 50 }
    },
    body: {
      type: "object",
      required: true,
      properties: {
        title: { type: "string", required: true },
        amount: { type: "number", required: true, min: 0.01 }
      }
    }
  };

  assert.equal(isApiSchema(apiSchema), true);

  // Valid request context
  const validContext = {
    params: { userId: "usr_123" },
    query: { limit: 20 },
    payload: { title: "Payment", amount: 99.95 }
  };
  assert.equal(validateSchema(apiSchema, validContext).valid, true);

  // Invalid params and body
  const invalidContext = {
    params: { userId: "u" }, // too short
    query: { limit: 100 }, // exceeds max 50
    payload: { title: "Payment", amount: -5 } // negative amount
  };
  const result = validateSchema(apiSchema, invalidContext);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
});

test("createSchemaValidator & assertValid integration", () => {
  const schema = {
    body: {
      type: "object",
      required: true,
      properties: {
        email: { type: "string", required: true, pattern: "@" }
      }
    }
  };

  const validator = createSchemaValidator(schema);

  const goodOutcome = validator({ params: {}, query: {}, payload: { email: "test@nexo.dev" }, headers: {} });
  assert.equal(goodOutcome.valid, true);
  assert.doesNotThrow(() => assertValid(goodOutcome));

  const badOutcome = validator({ params: {}, query: {}, payload: { email: "invalid" }, headers: {} });
  assert.equal(badOutcome.valid, false);
  assert.throws(() => assertValid(badOutcome), (err) => {
    return err instanceof NexoValidationError && err.errors.length > 0;
  });
});

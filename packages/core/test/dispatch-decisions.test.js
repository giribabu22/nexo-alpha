import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../dist/application.js";
import {
  NexoValidationError,
  NexoAuthenticationError,
  NexoConfigurationError
} from "../dist/errors.js";
import { NexoEvent } from "../dist/events.js";

test("records architectural decisions and constraints", () => {
  const app = createApplication({ name: "arch-test" });

  app.addDecision({
    title: "Inventory updates are synchronized in memory",
    reason: "Required sub-millisecond stock validation before checkout.",
    status: "accepted"
  });

  app.addConstraint({
    description: "Do not expose internal warehouse location IDs via public APIs.",
    reason: "Security and vendor privacy policy."
  });

  assert.equal(app.getDecisions().length, 1);
  assert.equal(app.getDecisions()[0].title, "Inventory updates are synchronized in memory");
  assert.equal(app.getConstraints().length, 1);
  assert.equal(app.getConstraints()[0].description, "Do not expose internal warehouse location IDs via public APIs.");
});

test("dispatches API calls through validation, auth, middleware, and handler", async () => {
  const app = createApplication({ name: "dispatch-test" });

  let calledEvent = null;
  app.events.on(NexoEvent.API_CALLED, (e) => {
    calledEvent = e;
  });

  app.setAuthenticator(async (req) => {
    if (req.headers["authorization"] === "Bearer valid-token") {
      return { authenticated: true, scopes: ["orders:write"] };
    }
    return { authenticated: false };
  });

  app.useMiddleware(async (req, next) => {
    const result = await next();
    return { wrapped: result };
  });

  app.module({
    name: "orders",
    apis: [
      {
        name: "createOrder",
        method: "POST",
        path: "/orders",
        auth: { required: true, scopes: ["orders:write"] },
        validate(req) {
          if (!req.payload || typeof req.payload !== "object" || !("item" in req.payload)) {
            return { valid: false, errors: ["Missing 'item' field in payload"] };
          }
          return { valid: true };
        },
        handler(req) {
          return { id: "ord-123", item: req.payload.item };
        }
      }
    ]
  });

  // 1. Success dispatch
  const result = await app.dispatch("createOrder", {
    headers: { authorization: "Bearer valid-token" },
    params: {},
    query: {},
    payload: { item: "Laptop" }
  });

  assert.deepEqual(result, { wrapped: { id: "ord-123", item: "Laptop" } });
  assert.ok(calledEvent);
  assert.equal(calledEvent.api, "createOrder");

  // 2. Auth failure
  await assert.rejects(
    async () => {
      await app.dispatch("createOrder", {
        headers: { authorization: "Bearer wrong-token" },
        params: {},
        query: {},
        payload: { item: "Laptop" }
      });
    },
    (err) => err instanceof NexoAuthenticationError
  );

  // 3. Validation failure
  await assert.rejects(
    async () => {
      await app.dispatch("createOrder", {
        headers: { authorization: "Bearer valid-token" },
        params: {},
        query: {},
        payload: {}
      });
    },
    (err) => err instanceof NexoValidationError && err.errors.includes("Missing 'item' field in payload")
  );

  // 4. Missing API failure
  await assert.rejects(
    async () => {
      await app.dispatch("unknownApi", {
        headers: {},
        params: {},
        query: {},
        payload: null
      });
    },
    (err) => err instanceof NexoConfigurationError
  );
});

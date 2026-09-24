# @nexo-alpha/hapi

> Production-grade Hapi.js HTTP adapter for the Nexo application framework.

`@nexo-alpha/hapi` bridges the gap between [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core)'s declarative `NexoApi` definitions and a live, running [Hapi.js](https://hapi.dev) HTTP server.

---

## Installation

```bash
npm install @nexo-alpha/hapi @nexo-alpha/core @hapi/hapi
```

Or using pnpm:

```bash
pnpm add @nexo-alpha/hapi @nexo-alpha/core @hapi/hapi
```

---

## How to Use

### 1. Basic Server Setup

Declare route handlers on your modules and start the Hapi server:

```ts
import { createApplication } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";

const app = createApplication({ name: "hello-api" });

app.module({
  name: "greeter",
  apis: [
    {
      name: "sayHello",
      method: "GET",
      path: "/hello/:name",
      handler: async (ctx) => {
        const name = ctx.params.name ?? "World";
        return { message: `Hello, ${name}!` };
      }
    }
  ]
});

// Start the Hapi server
const server = await startHapiServer(app, { port: 3000 });
console.log(`Server listening at ${server.info.uri}`);
```

```bash
curl http://localhost:3000/hello/Alice
# {"message":"Hello, Alice!"}
```

---

### 2. Request Context (`NexoRequestContext`)

Every handler receives a normalized request context object completely decoupled from Hapi internals:

```ts
handler: async (ctx) => {
  const { params, query, payload, headers } = ctx;

  const id = params.id;
  const filter = query.filter;
  const body = payload as { title: string };
  const authHeader = headers["authorization"];

  return { id, filter, received: body };
}
```

- Returning an object serializes it as JSON with HTTP `200`.
- Returning `undefined` sends an HTTP `204 No Content`.

---

### 3. Authentication & Scopes Pipeline

Enforce authentication and permission scopes declaratively:

```ts
app.module({
  name: "billing",
  apis: [
    {
      name: "createInvoice",
      method: "POST",
      path: "/invoices",
      auth: {
        required: true,
        scopes: ["invoices:write"]
      },
      handler: async (ctx) => {
        return { invoiceId: "inv_123", status: "created" };
      }
    }
  ]
});

// Provide an authenticator function to verify incoming requests
const server = await startHapiServer(app, {
  port: 3000,
  authenticate: async (ctx) => {
    const authHeader = ctx.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return { authenticated: false };
    }

    const token = authHeader.replace("Bearer ", "");
    if (token === "super-secret-token") {
      return {
        authenticated: true,
        actor: "admin_user",
        scopes: ["invoices:write", "invoices:read"]
      };
    }

    return { authenticated: false };
  }
});
```

The pipeline automatically handles errors:
- Missing / invalid authentication returns `401 Unauthorized`.
- Missing required scope returns `403 Forbidden`.

---

### 4. Payload Validation

Add lightweight request validation without introducing large schema dependencies:

```ts
app.module({
  name: "products",
  apis: [
    {
      name: "createProduct",
      method: "POST",
      path: "/products",
      validate: (ctx) => {
        const body = ctx.payload as { name?: string; price?: number };
        const errors: string[] = [];

        if (!body?.name) errors.push("Product 'name' is required.");
        if (typeof body?.price !== "number" || body.price <= 0) {
          errors.push("Product 'price' must be a positive number.");
        }

        return errors.length > 0
          ? { valid: false, errors }
          : { valid: true };
      },
      handler: async (ctx) => {
        return { created: ctx.payload };
      }
    }
  ]
});
```

Failed validation returns `400 Bad Request` with `{ errors: [...] }`.

---

### 5. Observability & Telemetry Events

Monitor API traffic via `app.events`:

```ts
// Fires on every completed request (including 400, 401, 403, and 500)
app.events.on("api.called", ({ api, method, path, statusCode, durationMs }) => {
  console.log(`${method} ${path} (${api}) -> ${statusCode} in ${durationMs}ms`);
});

// Fires when an unhandled exception is thrown in a handler
app.events.on("api.error", ({ api, error }) => {
  console.error(`Error in API handler ${api}:`, error);
});
```

---

## Related Packages

- [`@nexo-alpha/core`](https://www.npmjs.com/package/@nexo-alpha/core) — Defines `NexoApi`, `NexoRequestContext`, and application lifecycle.
- [`@nexo-alpha/tools`](https://www.npmjs.com/package/@nexo-alpha/tools) — Aggregates metrics from `api.called` events into latency and error reports.

---

## License

MIT © Nexo Contributors

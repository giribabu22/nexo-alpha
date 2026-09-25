# @nexo-alpha/webhooks

> Signed, retried webhook delivery for the Nexo framework.

Subscriptions are stored in a `@nexo-alpha/core` document store. Each matching event becomes a job on a `@nexo-alpha/scheduler` job queue, so deliveries are retried with backoff and survive restarts.

## Installation

```bash
pnpm add @nexo-alpha/webhooks @nexo-alpha/scheduler @nexo-alpha/core
```

## Sending

```ts
import { createSqliteDocumentStore } from "@nexo-alpha/core";
import { createJobQueue } from "@nexo-alpha/scheduler";
import { createWebhookDispatcher } from "@nexo-alpha/webhooks";

const store = await createSqliteDocumentStore("data/nexo.sqlite");
const queue = createJobQueue({ store });
const webhooks = createWebhookDispatcher({
  store,
  queue,
  maxAttempts: 5,
  // Recommended: block internal addresses so subscribers can't target your network.
  allowUrl: (url) => url.protocol === "https:"
});
await queue.start();

// The secret is returned only here. Give it to the receiver.
const { id, secret } = await webhooks.subscribe({
  url: "https://example.com/hooks",
  events: ["workflow.completed", "workflow.failed"]
});

// Send events yourself...
await webhooks.dispatch("invoice.paid", { invoiceId: "inv_1" });

// ...or forward workflow / job queue events.
createWorkflow({ name: "refund", agent, onEvent: webhooks.forward });
```

Event patterns can be an exact name (`"workflow.completed"`), `"*"`, or a prefix pattern (`"workflow.*"`).

Each delivery is a `POST` with this JSON body:

```json
{ "id": "<delivery id>", "event": "workflow.completed", "createdAt": "2026-09-25T10:00:00.000Z", "data": { } }
```

It carries these headers:

- `X-Nexo-Event`
- `X-Nexo-Delivery`: the same value across retries, so receivers can drop duplicates.
- `X-Nexo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`

Any 2xx response counts as delivered. Anything else is retried.

## Receiving

Verify the signature against the raw body, before parsing it:

```ts
import { verifyWebhookSignature } from "@nexo-alpha/webhooks";

const ok = verifyWebhookSignature({
  body: rawBody,
  signature: request.headers["x-nexo-signature"],
  secret: process.env.NEXO_WEBHOOK_SECRET,
  toleranceSeconds: 300 // rejects replays of old deliveries
});
```

## Notes

- Delivery is at-least-once. Use `X-Nexo-Delivery` to ignore repeats.
- Signing secrets are stored in the document store in plain text, because they're needed for signing. Protect that store.
- Several worker processes can share one SQLite queue store; each delivery is claimed by exactly one worker. See `@nexo-alpha/scheduler`.

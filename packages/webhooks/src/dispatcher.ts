/**
 * Webhook subscriptions and delivery.
 *
 * Subscriptions live in a `@nexo-alpha/core` {@link NexoDocumentStore};
 * each matching event becomes a job on a `@nexo-alpha/scheduler`
 * {@link NexoJobQueue}, so deliveries are retried with backoff and survive
 * restarts. A delivery counts as successful on any 2xx response.
 *
 * ```ts
 * const webhooks = createWebhookDispatcher({ store, queue });
 * const { secret } = await webhooks.subscribe({ url: "https://example.com/hooks", events: ["workflow.*"] });
 *
 * createWorkflow({ name: "refund", agent, onEvent: webhooks.forward });
 * ```
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { NexoDocumentStore } from "@nexo-alpha/core";
import type { NexoJobQueue } from "@nexo-alpha/scheduler";
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, signWebhookPayload } from "./signature.js";

export interface WebhookSubscription {
  readonly id: string;
  readonly url: string;
  /** Event names or patterns: exact (`"workflow.completed"`), `"*"`, or `"prefix.*"`. */
  readonly events: readonly string[];
  readonly active: boolean;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Returned once, by `subscribe()`: the only time the signing secret is exposed. */
export interface CreatedWebhookSubscription extends WebhookSubscription {
  readonly secret: string;
}

export interface SubscribeOptions {
  readonly url: string;
  readonly events: readonly string[];
  /** Signing secret. Default: 32 random bytes, hex-encoded. */
  readonly secret?: string;
  readonly description?: string;
  readonly active?: boolean;
}

export interface UpdateSubscriptionOptions {
  readonly url?: string;
  readonly events?: readonly string[];
  readonly active?: boolean;
  readonly description?: string;
}

/** The JSON body POSTed to subscribers. */
export interface WebhookDelivery {
  /** Unique delivery ID; the same across retries, so receivers can de-duplicate. */
  readonly id: string;
  readonly event: string;
  readonly createdAt: string;
  readonly data: unknown;
}

export interface WebhookDispatcherOptions {
  readonly store: NexoDocumentStore;
  readonly queue: NexoJobQueue;
  /** Collection holding subscriptions. Default: "webhook_subscriptions" */
  readonly collection?: string;
  /** Job type used for deliveries. Default: "nexo.webhook.deliver" */
  readonly jobType?: string;
  /** Attempts per delivery. Default: the queue's default */
  readonly maxAttempts?: number;
  /** Per-request timeout. Default: 10000 */
  readonly timeoutMs?: number;
  /** Custom fetch implementation (defaults to the global `fetch`). */
  readonly fetch?: typeof fetch;
  /**
   * Approves subscription URLs at subscribe/update time. Use it to block
   * internal addresses (SSRF). Default: any http(s) URL.
   */
  readonly allowUrl?: (url: URL) => boolean;
}

export interface WebhookDispatcher {
  subscribe(options: SubscribeOptions): Promise<CreatedWebhookSubscription>;
  update(id: string, changes: UpdateSubscriptionOptions): Promise<WebhookSubscription | undefined>;
  unsubscribe(id: string): Promise<boolean>;
  get(id: string): Promise<WebhookSubscription | undefined>;
  list(): Promise<WebhookSubscription[]>;
  /** Enqueues one delivery per active subscription matching `event`. Returns the delivery IDs. */
  dispatch(event: string, data: unknown): Promise<string[]>;
  /**
   * Event listener that dispatches `event.type` with the event as data —
   * plug into `createWorkflow({ onEvent })` or `createJobQueue({ onEvent })`.
   * Never throws.
   */
  readonly forward: (event: { readonly type: string }) => Promise<void>;
}

interface StoredSubscription extends WebhookSubscription {
  readonly secret: string;
}

interface DeliveryJob {
  readonly subscriptionId: string;
  readonly delivery: WebhookDelivery;
}

/** Whether a subscription pattern covers an event name. */
export function eventMatches(pattern: string, event: string): boolean {
  if (pattern === "*" || pattern === event) return true;
  return pattern.endsWith(".*") && event.startsWith(pattern.slice(0, -1));
}

function publicView(subscription: StoredSubscription): WebhookSubscription {
  const { secret: _secret, ...rest } = subscription;
  return rest;
}

export function createWebhookDispatcher(options: WebhookDispatcherOptions): WebhookDispatcher {
  const { store, queue } = options;
  const collection = options.collection ?? "webhook_subscriptions";
  const jobType = options.jobType ?? "nexo.webhook.deliver";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  function validate(url: string, events: readonly string[]): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid webhook URL "${url}".`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Webhook URL must use http or https (got "${parsed.protocol}").`);
    }
    if (options.allowUrl !== undefined && !options.allowUrl(parsed)) {
      throw new Error(`Webhook URL "${url}" is not allowed.`);
    }
    if (events.length === 0) {
      throw new Error("A webhook subscription needs at least one event.");
    }
  }

  queue.define<DeliveryJob>(jobType, async ({ subscriptionId, delivery }) => {
    const subscription = await store.get<StoredSubscription>(collection, subscriptionId);
    if (subscription === undefined || !subscription.active) return { skipped: true };

    const body = JSON.stringify(delivery);
    const response = await fetchImpl(subscription.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "nexo-webhooks",
        [EVENT_HEADER]: delivery.event,
        [DELIVERY_HEADER]: delivery.id,
        [SIGNATURE_HEADER]: signWebhookPayload(body, subscription.secret)
      },
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });
    // Drain the body so the connection can be reused.
    await response.arrayBuffer().catch(() => undefined);

    if (!response.ok) {
      throw new Error(`Webhook ${subscription.url} responded ${response.status}.`);
    }
    return { status: response.status };
  });

  const dispatcher: WebhookDispatcher = {
    async subscribe(subscribeOptions) {
      validate(subscribeOptions.url, subscribeOptions.events);
      const now = new Date().toISOString();
      const subscription: StoredSubscription = {
        id: randomUUID(),
        url: subscribeOptions.url,
        events: [...subscribeOptions.events],
        active: subscribeOptions.active ?? true,
        ...(subscribeOptions.description !== undefined ? { description: subscribeOptions.description } : {}),
        secret: subscribeOptions.secret ?? randomBytes(32).toString("hex"),
        createdAt: now,
        updatedAt: now
      };
      await store.put(collection, subscription.id, subscription);
      return subscription;
    },

    async update(id, changes) {
      const current = await store.get<StoredSubscription>(collection, id);
      if (current === undefined) return undefined;
      const next: StoredSubscription = {
        ...current,
        ...(changes.url !== undefined ? { url: changes.url } : {}),
        ...(changes.events !== undefined ? { events: [...changes.events] } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        updatedAt: new Date().toISOString()
      };
      validate(next.url, next.events);
      await store.put(collection, id, next);
      return publicView(next);
    },

    unsubscribe(id) {
      return store.delete(collection, id);
    },

    async get(id) {
      const subscription = await store.get<StoredSubscription>(collection, id);
      return subscription === undefined ? undefined : publicView(subscription);
    },

    async list() {
      return (await store.list<StoredSubscription>(collection)).map(publicView);
    },

    async dispatch(event, data) {
      const subscriptions = (await store.list<StoredSubscription>(collection)).filter(
        (subscription) => subscription.active && subscription.events.some((pattern) => eventMatches(pattern, event))
      );
      const createdAt = new Date().toISOString();
      const ids: string[] = [];
      for (const subscription of subscriptions) {
        const delivery: WebhookDelivery = { id: randomUUID(), event, createdAt, data };
        await queue.enqueue<DeliveryJob>(
          jobType,
          { subscriptionId: subscription.id, delivery },
          options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}
        );
        ids.push(delivery.id);
      }
      return ids;
    },

    forward: async (event) => {
      try {
        await dispatcher.dispatch(event.type, event);
      } catch {
        // Forwarding is best-effort: it must never break the emitter.
      }
    }
  };

  return dispatcher;
}

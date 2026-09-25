/**
 * Webhook signatures.
 *
 * Every delivery carries `X-Nexo-Signature: t=<unix seconds>,v1=<hex>`, where
 * `v1` is HMAC-SHA256(secret, `${t}.${rawBody}`). Signing the timestamp lets
 * receivers reject replays of old deliveries.
 *
 * Receivers verify with {@link verifyWebhookSignature}, passing the raw
 * request body exactly as received (before JSON parsing).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-nexo-signature";
export const EVENT_HEADER = "x-nexo-event";
export const DELIVERY_HEADER = "x-nexo-delivery";

function hmacHex(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Builds the `X-Nexo-Signature` header value for `body`. */
export function signWebhookPayload(body: string, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacHex(secret, timestamp, body)}`;
}

export interface VerifyWebhookSignatureOptions {
  /** The raw request body, exactly as received. */
  readonly body: string;
  /** The `X-Nexo-Signature` header value. */
  readonly signature: string | undefined;
  readonly secret: string;
  /** Maximum accepted age of the signed timestamp. Default: 300 */
  readonly toleranceSeconds?: number;
  /** Clock override, milliseconds since epoch. */
  readonly now?: number;
}

/**
 * Checks a delivery's signature in constant time and rejects timestamps
 * outside `toleranceSeconds` (in either direction).
 */
export function verifyWebhookSignature(options: VerifyWebhookSignatureOptions): boolean {
  if (options.signature === undefined) return false;

  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of options.signature.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value !== undefined && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value !== undefined) candidates.push(value);
  }
  if (timestamp === undefined || candidates.length === 0) return false;

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > (options.toleranceSeconds ?? 300)) return false;

  const expected = Buffer.from(hmacHex(options.secret, timestamp, options.body), "hex");
  return candidates.some((candidate) => {
    const actual = Buffer.from(candidate, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

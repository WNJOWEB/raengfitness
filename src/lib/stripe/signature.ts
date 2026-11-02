import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signature: the Stripe-Signature header is
 * `t=<unix seconds>,v1=<hex>[,v1=<hex>…]`, where each v1 is
 * HMAC-SHA256(signing secret, `${t}.${raw body}`) in hex. More than one v1
 * appears while an endpoint secret is being rolled. Other schemes (v0, sent
 * for test events) are ignored, to prevent downgrade. The timestamp must be
 * within a tolerance of now, so a captured request can't be replayed later.
 * The body must be the exact bytes received, before parsing.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function stripeSignature(rawBody: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  let timestamp: number | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (name === "v1" && /^[0-9a-f]{64}$/.test(value)) candidates.push(value);
  }
  if (timestamp === null || candidates.length === 0 || candidates.length > 5) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(stripeSignature(rawBody, secret, timestamp));
  return candidates.some((c) => {
    const given = Buffer.from(c);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

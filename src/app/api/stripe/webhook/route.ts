import { NextResponse } from "next/server";
import { coachDb } from "@/lib/coach/db";
import { stripeConfig, stripeWebhookConfig } from "@/lib/stripe/config";
import { handleStripeWebhook, MAX_WEBHOOK_BYTES } from "@/lib/stripe/sync";

/**
 * Stripe webhook endpoint (checkout.session.completed / async_payment_succeeded /
 * expired, refund.created / updated / failed). Signature checked on the raw body
 * first; then the session or refund is re-read from Stripe and recorded once.
 * Off (404) unless Stripe is configured.
 */
export async function POST(request: Request) {
  const db = coachDb();
  const stripe = stripeConfig();
  const webhook = stripeWebhookConfig();
  const noStore = { "Cache-Control": "no-store" };
  if (!db || !stripe || !webhook || stripe.environment !== webhook.environment) {
    return NextResponse.json({ error: "not-configured" }, { status: 404, headers: noStore });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "too-large" }, { status: 413, headers: noStore });
  const raw = await request.text();
  const result = await handleStripeWebhook(db, stripe, webhook, raw, request.headers.get("stripe-signature"));
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}

import { NextResponse } from "next/server";
import { notifyChargePayments } from "@/lib/stripe/receipts";
import { coachDb } from "@/lib/coach/db";
import { stripeConfig, stripeWebhookConfig } from "@/lib/stripe/config";
import { handleStripeWebhook, MAX_WEBHOOK_BYTES } from "@/lib/stripe/sync";
import { publishedClasses } from "@/lib/class-sessions";
import { notifyNewMembers } from "@/lib/membership-checkout";
import { notifyClassBookings } from "@/lib/class-checkout";
import { notifyDirectDebitFailures } from "@/lib/stripe/direct-debit";

/**
 * Stripe webhook endpoint (checkout.session.*, refund.*, charge.refunded).
 * Signature checked on the raw body first; then the checkout session or refund
 * is re-read from Stripe and recorded once. Off (404) unless Stripe is
 * configured. After a recorded payment, emails Alex and the member about any
 * online sign-up it started or class booking it confirmed (best effort; never
 * changes the response to Stripe).
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
  if (result.status === 200) {
    await notifyNewMembers(db, publishedClasses()).catch(() => 0);
    await notifyClassBookings(db, publishedClasses()).catch(() => 0);
    await notifyDirectDebitFailures(db).catch(() => 0);
    await notifyChargePayments(db).catch(() => 0);
  }
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}

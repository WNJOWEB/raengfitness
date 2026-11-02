import { NextResponse } from "next/server";
import { notifyChargePayments } from "@/lib/stripe/receipts";
import { coachDb } from "@/lib/coach/db";
import { cronAuthorized } from "@/lib/cron-auth";
import { stripeConfig } from "@/lib/stripe/config";
import { reconcileOpenLinks } from "@/lib/stripe/sync";
import { publishedClasses } from "@/lib/class-sessions";
import { notifyNewMembers } from "@/lib/membership-checkout";
import { notifyClassBookings } from "@/lib/class-checkout";
import { notifyDirectDebitFailures, notifyRenewalPayments } from "@/lib/stripe/direct-debit";

/** Daily safety net for missed Stripe webhooks (vercel.json "crons"). Same CRON_SECRET check as request alerts. */
export async function GET(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const db = coachDb();
  const stripe = stripeConfig();
  if (!db || !stripe) return NextResponse.json({ skipped: "not-configured" }, { headers: noStore });
  const summary = await reconcileOpenLinks(db, stripe);
  // Also catches sign-ups started by a payment the webhook missed (or recorded in the portal).
  const welcomed = await notifyNewMembers(db, publishedClasses()).catch(() => 0);
  const classBookings = await notifyClassBookings(db, publishedClasses()).catch(() => 0);
  const receipts = await notifyChargePayments(db).catch(() => 0);
  const renewed = await notifyRenewalPayments(db).catch(() => 0);
  const failures = await notifyDirectDebitFailures(db).catch(() => 0);
  return NextResponse.json({ ...summary, welcomed, classBookings, receipts, renewed, failures }, { status: summary.ok ? 200 : 503, headers: noStore });
}

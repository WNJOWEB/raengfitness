import { NextResponse } from "next/server";
import { coachDb } from "@/lib/coach/db";
import { cronAuthorized } from "@/lib/cron-auth";
import { stripeConfig } from "@/lib/stripe/config";
import { reconcileOpenLinks } from "@/lib/stripe/sync";

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
  return NextResponse.json(summary, { status: summary.ok ? 200 : 503, headers: noStore });
}

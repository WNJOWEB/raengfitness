import { NextResponse } from "next/server";
import { coachDb, isUuid } from "@/lib/coach/db";
import { beginSignupDirectDebit } from "@/lib/membership-checkout";
import { stripeConfig } from "@/lib/stripe/config";

/**
 * Where the page after paying forwards to a few seconds later: opens Stripe's
 * Direct Debit page for that paid sign-up (like the button on that page). Never
 * cached, and kept out of search results (robots.ts). An unknown or unpaid
 * sign-up goes back to the done page, which explains.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("signup") ?? "";
  const noStore = { "Cache-Control": "no-store" };
  if (!isUuid(id)) return NextResponse.redirect(new URL("/memberships", request.url), { status: 303, headers: noStore });
  const next = await beginSignupDirectDebit(coachDb(), stripeConfig(), id);
  return NextResponse.redirect(next.url, { status: 303, headers: noStore });
}

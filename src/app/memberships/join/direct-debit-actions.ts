"use server";

import { redirect } from "next/navigation";
import { text } from "@/lib/booking-request";
import { coachDb, isUuid } from "@/lib/coach/db";
import { beginSignupDirectDebit } from "@/lib/membership-checkout";
import { stripeConfig } from "@/lib/stripe/config";

/**
 * "Set up Direct Debit" on the page after a member's first payment: opens
 * Stripe's Direct Debit page for them (their bank details go to Stripe, never
 * to this site) and brings them back to the done page. The sign-up id in the
 * form is only a pointer: see beginSignupDirectDebit.
 */
export async function startSignupDirectDebit(formData: FormData): Promise<void> {
  const id = text(formData, "signup");
  if (!isUuid(id)) redirect("/memberships");
  const next = await beginSignupDirectDebit(coachDb(), stripeConfig(), id);
  redirect(next.url);
}

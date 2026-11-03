"use server";

import { redirect } from "next/navigation";
import { bookingMode } from "@/lib/booking";
import { BOOKING_EXPERIENCE, labelFor } from "@/lib/booking-options";
import { describePlan, isBookingFormEnabled, type FormState } from "@/lib/booking-request";
import { publishedClasses } from "@/lib/class-sessions";
import { fullClasses, fullKey } from "@/lib/class-capacity";
import { londonToday } from "@/lib/coach/time";
import { deliverRequest } from "@/lib/deliver-request";
import { referenceFor } from "@/lib/reference";
import { MEMBERSHIP_SERVICE, membershipEmail, membershipSummary, parseMembershipRequest, type MembershipField } from "@/lib/membership-request";
import { idempotencyKey } from "@/lib/send-email";
import { coachDb } from "@/lib/coach/db";
import { onlineJoinEnabled, recordJoinWaiver, startCheckout } from "@/lib/membership-checkout";
import { stripeConfig } from "@/lib/stripe/config";

/**
 * Validates a membership join on the server. Where online joining is on
 * (Stripe configured: lib/membership-checkout.ts), it creates the sign-up and
 * its first charge and sends the visitor to Stripe's payment page; the
 * membership starts only when Stripe's verified webhook records the payment
 * (owner, 2026-10-26: no confirmation by Alex). Otherwise it's a request to
 * Alex as before (stored for the coach area and/or emailed), reporting
 * success only once a route accepted it. Never runs on demonstration previews.
 */
export async function submitMembershipRequest(
  _previous: FormState<MembershipField>,
  formData: FormData,
): Promise<FormState<MembershipField>> {
  if (!isBookingFormEnabled() || bookingMode() !== "request") {
    return {
      status: "error",
      message: "Membership requests can't be sent online right now. Please message Alex on Instagram to join.",
      errors: {},
    };
  }

  const parsed = parseMembershipRequest(formData, { classes: publishedClasses() });
  if (parsed.kind === "spam" || parsed.kind === "demo") {
    // Never pretend a request was sent; a real person can simply resend.
    return { status: "error", message: "We couldn't send your request. Please wait a few seconds and send it again.", errors: {} };
  }
  if (parsed.kind === "invalid") {
    return { status: "error", message: "Please check the highlighted answers.", errors: parsed.errors };
  }

  const { data } = parsed;
  // Never trust the calendar: a first class that is full or cancelled can't be requested.
  const slot = publishedClasses().find((c) => c.label === data.session);
  if (data.classDate && slot) {
    const full = await fullClasses(londonToday());
    const key = fullKey(slot.id, data.classDate);
    if (full.known && full.keys.includes(key)) {
      return { status: "error", message: "Please check the highlighted answers.", errors: { when: "That class is now full. Choose another date, or book your first class later." } };
    }
    if (full.known && full.cancelled.includes(key)) {
      return { status: "error", message: "Please check the highlighted answers.", errors: { when: "That class has been cancelled. Choose another date, or book your first class later." } };
    }
  }

  const agreedAt = new Date().toISOString();
  const key = await idempotencyKey([data.submissionId, "membership", data.plan, data.email, data.name, data.session, data.classDate, data.message]);

  const db = coachDb();
  const stripe = stripeConfig();
  if (onlineJoinEnabled() && db && stripe) {
    const checkout = await startCheckout(db, stripe, data, data.classDate && slot ? slot : null, { agreedAt, idempotencyKey: key });
    if (checkout.ok) {
      // As a class booking does: which health and risk wording was ticked, and when (nothing about health).
      await recordJoinWaiver(db, checkout.signupId, data.waiver).catch(() => undefined);
      redirect(checkout.url);
    }
    if (checkout.reason === "already_member") {
      return { status: "error", message: "You're already a member. Sign in to your account to book classes, or reply to Alex to change plan.", errors: { email: "This email already has a membership." } };
    }
    if (checkout.reason === "payment_in_progress") {
      return { status: "error", message: "A payment for an earlier sign-up of yours is part-way through. Alex will be in touch to finish it.", errors: {} };
    }
    return { status: "error", message: "Sorry, payment couldn't be opened just now. Please try again in a minute, or message Alex on Instagram.", errors: {} };
  }
  const details: Record<string, string> = {
    experience: labelFor(BOOKING_EXPERIENCE, data.experience),
    // The plan id lets the coach area start this membership from the request.
    plan: data.plan,
    membership: describePlan(data.plan),
    terms: `Agreed to the membership terms and class cancellation policy (${agreedAt})`,
    waiver: `Agreed to the participation and risk terms (version ${data.waiver.version}) at ${data.waiver.at}`,
  };
  if (data.classDate && slot) {
    details.classDate = data.classDate;
    details.classSlot = slot.id;
  }

  const delivered = await deliverRequest(
    {
      idempotencyKey: key,
      kind: "booking",
      service: MEMBERSHIP_SERVICE,
      summary: membershipSummary(data),
      name: data.name,
      email: data.email,
      phone: data.phone,
      message: data.message,
      details,
    },
    { ...membershipEmail(data, agreedAt), replyTo: data.email },
  );

  if (!delivered) {
    return { status: "error", message: "Sorry, your request couldn't be sent. Please try again, or message Alex on Instagram.", errors: {} };
  }
  return { status: "success", message: data.email, errors: {}, reference: referenceFor(key) };
}

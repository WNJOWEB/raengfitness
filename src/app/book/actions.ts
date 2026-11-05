"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { bookingMode } from "@/lib/booking";
import { BOOKABLE_SERVICES, BOOKING_EXPERIENCE, ONE_TO_ONE_OPTIONS, PREFERRED_DAYS, PREFERRED_TIMES, labelFor, listLabels } from "@/lib/booking-options";
import {
  bookingEmail,
  describePlan,
  describeWhen,
  isBookingFormEnabled,
  parseBookingRequest,
  type BookingField,
  type BookingRequest,
  type FormState,
} from "@/lib/booking-request";
import { publishedClasses } from "@/lib/class-sessions";
import { fullClasses, fullKey } from "@/lib/class-capacity";
import { londonToday } from "@/lib/coach/time";
import { deliverRequest } from "@/lib/deliver-request";
import { referenceFor } from "@/lib/reference";
import { idempotencyKey } from "@/lib/send-email";
import { notifyClassBookings, recordWaiver, startClassCheckout } from "@/lib/class-checkout";
import { coachDb } from "@/lib/coach/db";
import { onlineJoinEnabled } from "@/lib/membership-checkout";
import { stripeConfig } from "@/lib/stripe/config";
import { firstClassFree } from "@/content/offers";
import { getService } from "@/content/services";
import { publishable } from "@/lib/publish";

/**
 * Validates a booking request on the server and gets it to Alex: stored in
 * Supabase for the coach area and/or emailed. Reports success only once one
 * of those has accepted it. Never runs for demonstration availability.
 * Where online payment is on, a group class (without a membership plan) is
 * booked instead: the place is held and the visitor sent to Stripe to pay
 * (lib/class-checkout.ts), or booked straight away with a class credit link.
 * One-to-one always stays a request (owner, 2026-10-27).
 */
export async function submitBookingRequest(
  _previous: FormState<BookingField>,
  formData: FormData,
): Promise<FormState<BookingField>> {
  if (!isBookingFormEnabled() || bookingMode() !== "request") {
    return {
      status: "error",
      message: "Online booking requests aren't available right now. Please message Alex on Instagram to book.",
      errors: {},
    };
  }

  const parsed = parseBookingRequest(formData, { classes: publishedClasses() });
  if (parsed.kind === "demo") {
    return { status: "error", message: "Demonstration times can't be booked.", errors: {} };
  }
  if (parsed.kind === "spam") {
    // Never pretend a request was sent; a real person can simply resend.
    return { status: "error", message: "We couldn't send your request. Please wait a few seconds and send it again.", errors: {} };
  }
  if (parsed.kind === "invalid") {
    return { status: "error", message: "Please check the highlighted fields.", errors: parsed.errors };
  }

  const { data } = parsed;
  // Never trust the calendar: a class that is full or cancelled can't be requested.
  const slot = publishedClasses().find((c) => c.label === data.session);
  if (data.service === "group-class" && data.classDate && slot) {
    const full = await fullClasses(londonToday());
    if (full.known && full.keys.includes(fullKey(slot.id, data.classDate))) {
      return { status: "error", message: "Please check the highlighted fields.", errors: { when: "That class is now full. Choose another date." } };
    }
    if (full.known && full.cancelled.includes(fullKey(slot.id, data.classDate))) {
      return { status: "error", message: "Please check the highlighted fields.", errors: { when: "That class has been cancelled. Choose another date." } };
    }
  }
  const key = await idempotencyKey([
    data.submissionId,
    data.service,
    data.email,
    data.name,
    data.session,
    data.classDate,
    data.option,
    data.days.join(","),
    data.times.join(","),
    data.message,
    data.plan,
  ]);

  const db = coachDb();
  const stripe = stripeConfig();
  if (onlineJoinEnabled() && db && stripe && data.service === "group-class" && data.classDate && slot && !data.plan) {
    const credit = formData.get("credit");
    const checkout = await startClassCheckout(db, stripe, { name: data.name, email: data.email, phone: data.phone }, slot, data.classDate, {
      idempotencyKey: key,
      creditToken: typeof credit === "string" && credit ? credit : null,
      confirmPaid: formData.get("confirmPaid") === "yes",
    });
    if (checkout.ok) {
      // Keep the record of the ticked terms with the booking (best effort: the booking itself is already made).
      await recordWaiver(db, checkout.bookingId, data.waiver).catch(() => undefined);
      // Booked straight away (free first class or a class credit): send the confirmation now, after the reply.
      if (checkout.confirmed) after(() => notifyClassBookings(db, publishedClasses()).then(() => undefined).catch(() => undefined));
      redirect(checkout.url);
    }
    // Not their first class: the form says so and they continue to pay (nothing is booked yet).
    if (checkout.reason === "returning") {
      return { status: "idle", message: returningMessage(), errors: {}, returning: data.email.trim().toLowerCase() };
    }
    const whenError: Partial<Record<typeof checkout.reason, string>> = {
      class_full: "That class is now full. Choose another date.",
      class_cancelled: "That class has been cancelled. Choose another date.",
      class_started: "That class has already started. Choose another date.",
      already_booked: "You're already booked on that class. Choose another date.",
    };
    const message = whenError[checkout.reason];
    if (message) return { status: "error", message: "Please check the highlighted fields.", errors: { when: message } };
    if (checkout.reason === "credit_invalid") {
      return { status: "error", message: "Please check the highlighted fields.", errors: { credit: "This class credit has been used or has expired. You can still pay for the class." } };
    }
    return { status: "error", message: "Sorry, payment couldn't be opened just now. Please try again in a minute, or message Alex on Instagram.", errors: {} };
  }

  const delivered = await deliverRequest(
    {
      idempotencyKey: key,
      kind: "booking",
      service: labelFor(BOOKABLE_SERVICES, data.service),
      summary: data.plan ? `${describeWhen(data)} · ${describePlan(data.plan).split(" (")[0]}`.slice(0, 300) : describeWhen(data),
      name: data.name,
      email: data.email,
      phone: data.phone,
      message: data.message,
      details: requestDetails(data),
    },
    { ...bookingEmail(data), replyTo: data.email },
  );

  if (!delivered) {
    return {
      status: "error",
      message: "Sorry, your request couldn't be sent. Please try again, or message Alex on Instagram.",
      errors: {},
    };
  }

  return { status: "success", message: data.email, errors: {}, reference: referenceFor(key) };
}

/**
 * What the coach portal needs besides the summary line: the class date and
 * timetable slot (so a confirmed request becomes a place on that class), or
 * the preferred days and times for one-to-one.
 */
function requestDetails(data: BookingRequest): Record<string, string> {
  const details: Record<string, string> = {
    experience: labelFor(BOOKING_EXPERIENCE, data.experience),
    ...(data.option ? { option: labelFor(ONE_TO_ONE_OPTIONS, data.option) } : {}),
    waiver: `Agreed to the participation and risk terms (version ${data.waiver.version}) at ${data.waiver.at}`,
  };
  const slot = publishedClasses().find((c) => c.label === data.session);
  if (data.session && data.classDate && slot) {
    details.classDate = data.classDate;
    details.classSlot = slot.id;
  }
  // The plan id lets the coach portal start that membership from the request.
  if (data.plan) {
    details.plan = data.plan;
    details.membership = describePlan(data.plan);
  }
  if (data.days.length) details.days = listLabels(data.days.map((d) => labelFor(PREFERRED_DAYS, d)));
  if (data.times.length) details.times = listLabels(data.times.map((t) => labelFor(PREFERRED_TIMES, t)));
  return details;
}

/** "You've trained with RAENG before, so this class is £12." (price from content). */
function returningMessage(): string {
  const price = publishable(getService("group-classes").prices)[0];
  return firstClassFree.returning.replace("{price}", price ? `£${price.amountGbp}` : "paid");
}

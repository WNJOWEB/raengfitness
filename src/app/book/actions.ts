"use server";

import { bookingMode } from "@/lib/booking";
import { BOOKABLE_SERVICES, BOOKING_EXPERIENCE, ONE_TO_ONE_OPTIONS, PREFERRED_DAYS, PREFERRED_TIMES, labelFor, listLabels } from "@/lib/booking-options";
import {
  bookingDeliveryConfig,
  bookingEmail,
  clientAcknowledgementEmail,
  describeWhen,
  isBookingFormEnabled,
  parseBookingRequest,
  type BookingField,
  type BookingRequest,
  type FormState,
} from "@/lib/booking-request";
import { publishedClasses } from "@/lib/class-sessions";
import { formatSpaces, isFull } from "@/lib/class-spaces";
import { loadClassPlaces } from "@/lib/class-spaces-server";
import { deliverRequest } from "@/lib/deliver-request";
import { idempotencyKey, sendEmailWithRetry } from "@/lib/send-email";

/**
 * Validates a booking request on the server and gets it to Alex: stored in
 * Supabase for the coach area and/or emailed. Reports success only once one
 * of those has accepted it. Never runs for demonstration availability.
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

  // A class that has filled up since the page loaded can't be requested.
  const chosen = data.session && data.classDate ? publishedClasses().find((c) => c.label === data.session) : undefined;
  if (chosen && data.classDate) {
    const places = await loadClassPlaces(data.classDate, chosen.id);
    if (places && isFull(places)) {
      return {
        status: "error",
        message: `That class is full (${formatSpaces(places)}). Please choose another date.`,
        errors: { when: "That class is full. Please choose another date." },
      };
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
  ]);
  const delivered = await deliverRequest(
    {
      idempotencyKey: key,
      kind: "booking",
      service: labelFor(BOOKABLE_SERVICES, data.service),
      summary: describeWhen(data),
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

  await acknowledgeToClient(data, key);
  return { status: "success", message: data.email, errors: {} };
}

/**
 * Best-effort "we've received your request" email to the visitor. Never
 * affects the outcome: the request is already with Alex. Reply-To is Alex's
 * inbox. The idempotency key derives from the request's, so a resubmission
 * does not send a second copy. Logs hold no personal data.
 */
async function acknowledgeToClient(data: BookingRequest, requestKey: string): Promise<void> {
  const mail = bookingDeliveryConfig();
  if (!mail) return;
  const result = await sendEmailWithRetry(mail, {
    ...clientAcknowledgementEmail(data),
    to: data.email,
    replyTo: mail.to,
    idempotencyKey: `${requestKey}/client`,
  });
  if (!result.ok) console.error("Emailing a booking acknowledgement to the visitor failed");
}

/**
 * What the coach portal needs besides the summary line: the class date and
 * timetable slot (so a confirmed request becomes a place on that class), or
 * the preferred days and times for one-to-one.
 */
function requestDetails(data: BookingRequest): Record<string, string> {
  const details: Record<string, string> = { experience: labelFor(BOOKING_EXPERIENCE, data.experience) };
  if (data.option) details.option = labelFor(ONE_TO_ONE_OPTIONS, data.option);
  const slot = publishedClasses().find((c) => c.label === data.session);
  if (data.session && data.classDate && slot) {
    details.classDate = data.classDate;
    details.classSlot = slot.id;
  }
  if (data.days.length) details.days = listLabels(data.days.map((d) => labelFor(PREFERRED_DAYS, d)));
  if (data.times.length) details.times = listLabels(data.times.map((t) => labelFor(PREFERRED_TIMES, t)));
  return details;
}

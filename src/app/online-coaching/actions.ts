"use server";

import { onlineEnquiryMode } from "@/lib/booking";
import { CONTACT_METHODS, ONLINE_EXPERIENCE, ONLINE_GOALS, TRAINING_PLACES, labelFor } from "@/lib/booking-options";
import { isBookingFormEnabled, type FormState } from "@/lib/booking-request";
import { deliverRequest } from "@/lib/deliver-request";
import { referenceFor } from "@/lib/reference";
import { onlineEnquiryEmail, parseOnlineEnquiry, type OnlineField } from "@/lib/online-enquiry";
import { idempotencyKey } from "@/lib/send-email";

/** Validates an online coaching enquiry and gets it to Alex (stored and/or emailed). */
export async function submitOnlineEnquiry(
  _previous: FormState<OnlineField>,
  formData: FormData,
): Promise<FormState<OnlineField>> {
  if (!isBookingFormEnabled() || onlineEnquiryMode() !== "send") {
    return {
      status: "error",
      message: "Online enquiries aren't available right now. Please message Alex on Instagram.",
      errors: {},
    };
  }

  const parsed = parseOnlineEnquiry(formData);
  if (parsed.kind === "spam" || parsed.kind === "demo") {
    return { status: "error", message: "We couldn't send your enquiry. Please wait a few seconds and send it again.", errors: {} };
  }
  if (parsed.kind === "invalid") {
    return { status: "error", message: "Please check the highlighted answers.", errors: parsed.errors };
  }

  const { data } = parsed;
  const goal = data.goal === "other" && data.goalOther ? data.goalOther : labelFor(ONLINE_GOALS, data.goal);
  const key = await idempotencyKey([data.submissionId, "online", data.email, data.name, data.goal, data.message]);
  const delivered = await deliverRequest(
    {
      idempotencyKey: key,
      kind: "online",
      service: "Online coaching",
      summary: goal,
      name: data.name,
      email: data.email,
      phone: data.phone,
      message: data.message,
      details: {
        experience: labelFor(ONLINE_EXPERIENCE, data.experience),
        ...(data.trainingPlace ? { trains: labelFor(TRAINING_PLACES, data.trainingPlace) } : {}),
        contact: labelFor(CONTACT_METHODS, data.contactMethod),
        ...(data.instagram ? { instagram: data.instagram } : {}),
      },
    },
    { ...onlineEnquiryEmail(data), replyTo: data.email },
  );

  if (!delivered) {
    return {
      status: "error",
      message: "Sorry, your enquiry couldn't be sent. Please try again, or message Alex on Instagram.",
      errors: {},
    };
  }

  return { status: "success", message: data.email, errors: {}, reference: referenceFor(key) };
}

"use server";

import { redirect } from "next/navigation";
import { bookingDeliveryConfig, text, type FormState } from "@/lib/booking-request";
import { select } from "@/lib/coach/db";
import { sendEmailWithRetry } from "@/lib/send-email";
import { stripeConfig } from "@/lib/stripe/config";
import { updateCustomerEmail } from "@/lib/stripe/api";
import { isUuid } from "@/lib/coach/db";
import { emailError, nameError, phoneError, singleLine } from "@/lib/form-validation";
import { normaliseCode, randomCode, randomToken, sha256Hex } from "@/lib/member-auth";
import { requireMember } from "@/lib/member-session";
import {
  CALENDAR_SYNC_PATH,
  calendarFeedUrl,
  endOtherSession,
  NOTIFICATIONS_PATH,
  PROFILE_PATH,
  SECURITY_PATH,
  setCalendarFeed,
  confirmEmailChange,
  emailChangedNotice,
  emailChangeCodeEmail,
  setDayBefore,
  startEmailChange,
  setReminders,
  turnOffCalendarFeed,
  updateProfile,
} from "@/lib/member-settings";

/** Saves the member's own name and phone. The email changes only through Alex. */
export async function saveProfile(formData: FormData): Promise<void> {
  const member = await requireMember();
  const name = singleLine(text(formData, "name"));
  const phone = singleLine(text(formData, "phone"));
  if (nameError(name)) redirect(`${PROFILE_PATH}?error=invalid_name`);
  if (phoneError(phone)) redirect(`${PROFILE_PATH}?error=invalid_phone`);
  const result = await updateProfile(member.db, member.clientId, name, phone);
  if (!result.ok) {
    const rule = result.error.kind === "rule" ? result.error.rule : null;
    redirect(`${PROFILE_PATH}?error=${rule === "invalid_name" || rule === "invalid_phone" ? rule : "failed"}`);
  }
  redirect(`${PROFILE_PATH}?done=profile_saved`);
}

/** Switches class reminder emails on or off (off until they choose). */
export async function saveReminders(formData: FormData): Promise<void> {
  const member = await requireMember();
  const on = text(formData, "reminders") === "on";
  const result = await setReminders(member.db, member.clientId, on);
  if (!result.ok) redirect(`${NOTIFICATIONS_PATH}?error=failed`);
  redirect(`${NOTIFICATIONS_PATH}?done=${on ? "reminders_on" : "reminders_off"}`);
}

/** The day-before reminder, on or off (owner, 2026-11-03). */
export async function saveDayBefore(formData: FormData): Promise<void> {
  const member = await requireMember();
  const on = text(formData, "day_before") === "on";
  const result = await setDayBefore(member.db, member.clientId, on);
  if (!result.ok) redirect(`${NOTIFICATIONS_PATH}?error=failed`);
  redirect(`${NOTIFICATIONS_PATH}?done=${on ? "day_before_on" : "day_before_off"}`);
}

/** Signs out one of the member's other devices (never the one they're using: that is "Sign out"). */
export async function signOutDevice(formData: FormData): Promise<void> {
  const member = await requireMember();
  const id = text(formData, "device");
  if (!isUuid(id)) redirect(`${SECURITY_PATH}?error=device_gone`);
  const result = await endOtherSession(member.db, member.clientId, id, member.sessionHash);
  if (!result.ok) redirect(`${SECURITY_PATH}?error=failed`);
  redirect(`${SECURITY_PATH}?${result.data ? "done=device_out" : "error=device_gone"}`);
}

export interface CalendarLinkState {
  status: "idle" | "ready" | "error";
  /** The private link: shown once, only its hash is kept. */
  url: string;
  message: string;
}

/**
 * Makes the member's private calendar link (replacing any earlier one, which
 * stops working). The link is returned to the page once; the database keeps
 * only its SHA-256 hash, as it does for sign-in links.
 */
export async function createCalendarLink(): Promise<CalendarLinkState> {
  const member = await requireMember();
  const token = randomToken();
  const result = await setCalendarFeed(member.db, member.clientId, await sha256Hex(token));
  if (!result.ok) return { status: "error", url: "", message: "Sorry, we couldn't make the link. Please try again." };
  return { status: "ready", url: calendarFeedUrl(token), message: "" };
}

/** Turns the calendar link off: calendars still using it stop getting classes. */
export async function turnOffCalendarLink(): Promise<void> {
  const member = await requireMember();
  const result = await turnOffCalendarFeed(member.db, member.clientId);
  if (!result.ok) redirect(`${CALENDAR_SYNC_PATH}?error=failed`);
  redirect(`${CALENDAR_SYNC_PATH}?done=calendar_off`);
}

export type EmailChangeField = "email" | "code";

/**
 * Step 1 of changing the email (owner, 2026-11-03): a 6-digit code to the new
 * address. The address must be free; 5 asks an hour.
 */
export async function requestEmailChange(_previous: FormState<EmailChangeField>, formData: FormData): Promise<FormState<EmailChangeField>> {
  const member = await requireMember();
  const mail = bookingDeliveryConfig();
  if (!mail) return { status: "error", message: "Email isn't switched on for the site yet. Please message Alex to change it.", errors: {} };
  const email = singleLine(text(formData, "email")).toLowerCase();
  const invalid = emailError(email);
  if (invalid) return { status: "error", message: "Please check the new email address.", errors: { email: invalid } };
  const code = randomCode();
  const started = await startEmailChange(member.db, member.clientId, email, await sha256Hex(code));
  if (!started.ok) {
    const rule = started.error.kind === "rule" ? started.error.rule : null;
    const message =
      rule === "same_email" ? "That's already your email." : rule === "email_taken" ? "That email belongs to another account. Message Alex if it's yours." : rule === "too_many" ? "Too many tries for now. Please try again in an hour." : "Sorry, something went wrong. Please try again in a minute.";
    return { status: "error", message, errors: { email: message } };
  }
  const sent = await sendEmailWithRetry(mail, { ...emailChangeCodeEmail(code), to: email, replyTo: mail.to, idempotencyKey: `email-change/${await sha256Hex(code + email)}` });
  if (!sent.ok) return { status: "error", message: "The code couldn't be sent just now. Please try again in a minute.", errors: {} };
  return { status: "success", message: email, errors: {} };
}

/**
 * Step 2: the code from the new address. The account's email changes, the old
 * address is told, and Stripe's copy follows (best effort). Signed-in devices
 * stay signed in.
 */
export async function confirmEmailChangeCode(_previous: FormState<EmailChangeField>, formData: FormData): Promise<FormState<EmailChangeField>> {
  const member = await requireMember();
  const code = normaliseCode(text(formData, "code"));
  if (!code) return { status: "error", message: "Enter the 6 digits from the email.", errors: { code: "Enter the 6 digits from the email." } };
  const done = await confirmEmailChange(member.db, member.clientId, await sha256Hex(code));
  if (!done.ok) {
    const taken = done.error.kind === "rule" && done.error.rule === "email_taken";
    const message = taken ? "That email has just been taken by another account. Message Alex if it's yours." : "Sorry, something went wrong. Please try again in a minute.";
    return { status: "error", message, errors: { code: message } };
  }
  if (!done.data) {
    const wrong = "That code isn't right, or it has expired. Check it against the newest email, or ask for a new one.";
    return { status: "error", message: wrong, errors: { code: wrong } };
  }
  const { old_email: oldEmail, new_email: newEmail } = done.data;
  const mail = bookingDeliveryConfig();
  if (mail && oldEmail) {
    await sendEmailWithRetry(mail, { ...emailChangedNotice(newEmail), to: oldEmail, replyTo: mail.to, idempotencyKey: `email-changed/${member.clientId}/${await sha256Hex(newEmail)}` }).catch(() => undefined);
  }
  const stripe = stripeConfig();
  if (stripe) {
    const rows = await select<{ customer_id: string; environment: string }>(member.db, "akb_stripe_customers", [["select", "customer_id,environment"], ["client_id", `eq.${member.clientId}`]]);
    const customer = rows.ok ? rows.data[0] : undefined;
    if (customer && customer.environment === stripe.environment) await updateCustomerEmail(stripe, customer.customer_id, newEmail).catch(() => undefined);
  }
  redirect(`${PROFILE_PATH}?done=email_changed`);
}

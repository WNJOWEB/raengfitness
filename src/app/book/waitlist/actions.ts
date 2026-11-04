"use server";

import { redirect } from "next/navigation";
import { isBookingFormEnabled, isSpam, text, type FormState } from "@/lib/booking-request";

import { isClassDate } from "@/lib/availability/timetable";
import { publishedClasses } from "@/lib/class-sessions";
import { coachDb } from "@/lib/coach/db";
import { londonToday } from "@/lib/coach/time";
import { emailError, nameError, phoneError, singleLine } from "@/lib/form-validation";
import { isToken } from "@/lib/member-auth";
import { joinWaitlistPublic, leaveWaitlistByToken, WAITLIST_MESSAGES, WAITLIST_PATH, whenFor } from "@/lib/waitlist";

export type WaitlistField = "name" | "email" | "phone";

/**
 * A visitor joins the waitlist of a full class (owner, 2026-11-04): name,
 * email and phone, as when booking. The class comes from the address and is
 * checked against the real timetable; the database refuses a class that
 * isn't full. They're emailed a confirmation with a private link to leave.
 * The same message whether or not the email already has an account.
 */
export async function joinWaitlistAction(_previous: FormState<WaitlistField>, formData: FormData): Promise<FormState<WaitlistField>> {
  const db = coachDb();
  if (!isBookingFormEnabled() || !db) return { status: "error", message: "The waitlist isn't available online right now. Please message Alex on Instagram.", errors: {} };
  if (isSpam(formData)) return { status: "error", message: "Please wait a few seconds and try again.", errors: {} };
  const slot = publishedClasses().find((c) => c.id === text(formData, "class"));
  const date = text(formData, "date");
  if (!slot || !isClassDate(date, slot, londonToday())) return { status: "error", message: WAITLIST_MESSAGES.class_not_found, errors: {} };

  const name = singleLine(text(formData, "name"));
  const email = singleLine(text(formData, "email")).toLowerCase();
  const phone = singleLine(text(formData, "phone"));
  const errors: FormState<WaitlistField>["errors"] = {};
  const checks = { name: nameError(name), email: emailError(email), phone: phoneError(phone, true) };
  for (const [field, error] of Object.entries(checks)) if (error) errors[field as WaitlistField] = error;
  if (Object.keys(errors).length > 0) return { status: "error", message: "Please check the highlighted answers.", errors };

  const joined = await joinWaitlistPublic(db, { name, email, phone }, slot.id, date);
  if (!joined.ok) return { status: "error", message: WAITLIST_MESSAGES[joined.reason], errors: {} };
  return { status: "success", message: `${joined.data.position}|${whenFor(slot.id, date)}|${email}`, errors: {} };
}

/** Leaves with the private link: only from the button (a POST), so an email scanner opening the link changes nothing. */
export async function leaveWaitlistAction(formData: FormData): Promise<void> {
  const token = text(formData, "token");
  const db = coachDb();
  if (!db || !isToken(token)) redirect(`${WAITLIST_PATH}?left=invalid`);
  const result = await leaveWaitlistByToken(db, token);
  if (!result.ok || !result.data) redirect(`${WAITLIST_PATH}?left=invalid`);
  redirect(`${WAITLIST_PATH}?left=1`);
}


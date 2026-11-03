import { BOOKING_EXPERIENCE, labelFor, type BookingExperience } from "./booking-options";
import { describeClass, describePlan, isSpam, submissionId, text, type FieldErrors, type FieldSource, type ParseResult } from "./booking-request";
import { emailError, messageError, nameError, phoneError, singleLine } from "./form-validation";
import { toDateKey, type DateKey } from "./availability/dates";
import { isClassDate } from "./availability/timetable";
import type { PublishedClass } from "./class-sessions";
import { membershipPlans, type MembershipPlan } from "../content/memberships";
import { classWaiver } from "../content/policy";

/**
 * Membership join requests from /memberships/join (owner, 2026-10-26):
 * the plan, an optional first class, the member's details and their
 * agreement to the membership terms and cancellation policy. Like a
 * booking request it is a request, not a sign-up: Alex confirms, starts the
 * membership in the coach area (the request carries the plan) and tells
 * them how to pay. Nothing is charged online. Pure functions, unit-tested.
 */

export interface MembershipRequest {
  plan: MembershipPlan["id"];
  /** The first class's timetable label, e.g. "Saturday 9:00 am", or "" for "I'll book later". */
  session: string;
  classDate: DateKey | "";
  experience: BookingExperience;
  name: string;
  email: string;
  phone: string;
  message: string;
  submissionId: string;
  /** The participation and risk terms ticked (content/policy.ts classWaiver), as on a class booking: the wording's version and when. */
  waiver: { version: string; at: string };
}

export type MembershipField = "plan" | "when" | "experience" | "name" | "email" | "phone" | "message" | "agree" | "waiver";

export interface MembershipParseOptions {
  now?: number;
  /** Confirmed classes a first class can be chosen from. */
  classes?: readonly PublishedClass[];
}

/** The service name stored on the request and shown in Alex's inbox. */
export const MEMBERSHIP_SERVICE = "Membership";

export function parseMembershipRequest(
  source: FieldSource,
  { now = Date.now(), classes = [] }: MembershipParseOptions = {},
): ParseResult<MembershipRequest, MembershipField> {
  if (isSpam(source, now)) return { kind: "spam" };

  const errors: FieldErrors<MembershipField> = {};
  const plan = membershipPlans.find((p) => p.id === text(source, "plan"))?.id;
  const session = singleLine(text(source, "session"));
  const classDate = text(source, "classDate");
  const experience = text(source, "experience");
  const name = singleLine(text(source, "name"));
  const email = singleLine(text(source, "email")).toLowerCase();
  const phone = singleLine(text(source, "phone"));
  const message = text(source, "message").replace(/\r\n?/g, "\n");

  if (!plan) errors.plan = "Choose a membership plan.";
  // The first class is optional, but if one is sent it must be a real upcoming class.
  if (session || classDate) {
    const chosen = classes.find((c) => c.label === session);
    if (!chosen || !isClassDate(classDate, chosen, toDateKey(new Date(now)))) errors.when = "Choose a class date and time, or book your first class later.";
  }
  if (!BOOKING_EXPERIENCE.some((o) => o.value === experience)) errors.experience = "Choose the option that best describes you.";
  const fieldErrors = { name: nameError(name), email: emailError(email), phone: phoneError(phone, true), message: messageError(message) };
  for (const [field, error] of Object.entries(fieldErrors)) if (error) errors[field as MembershipField] = error;
  if (text(source, "agree") !== "yes") errors.agree = "Please confirm you've read and agree to the membership terms and cancellation policy.";
  if (text(source, "waiver") !== "yes") errors.waiver = classWaiver.error;

  if (Object.keys(errors).length > 0 || !plan) return { kind: "invalid", errors };
  const hasClass = Boolean(session && classDate);
  return {
    kind: "valid",
    data: {
      plan,
      session: hasClass ? session : "",
      classDate: hasClass ? classDate : "",
      experience: experience as BookingExperience,
      name,
      email,
      phone,
      message,
      submissionId: submissionId(source),
      waiver: { version: classWaiver.version, at: new Date(now).toISOString() },
    },
  };
}

/** "Saturday 31 October 2026, 9:00 am", or "Book later" when none was chosen. */
export function describeFirstClass(data: Pick<MembershipRequest, "session" | "classDate">): string {
  return data.session && data.classDate ? describeClass(data) : "Book later";
}

/** One line for the inbox: "Regular membership · first class Saturday 31 October 2026, 9:00 am". */
export function membershipSummary(data: MembershipRequest): string {
  const plan = membershipPlans.find((p) => p.id === data.plan)!;
  const first = data.session ? `first class ${describeFirstClass(data)}` : "first class to book later";
  return `${plan.name} membership · ${first}`.slice(0, 300);
}

/** The email Alex receives. Plain text: nothing from the visitor is rendered as HTML. */
export function membershipEmail(data: MembershipRequest, agreedAt: string): { subject: string; text: string } {
  const plan = membershipPlans.find((p) => p.id === data.plan)!;
  const lines = [
    "New membership request from the website.",
    "",
    `Plan: ${describePlan(data.plan)}`,
    `First class: ${describeFirstClass(data)}`,
    `Experience: ${labelFor(BOOKING_EXPERIENCE, data.experience)}`,
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone || "not given"}`,
    `Agreed to the membership terms and class cancellation policy: ${agreedAt}`,
    `Agreed to the participation and risk terms (version ${data.waiver.version}): ${data.waiver.at}`,
    "",
    "Message:",
    data.message || "(none)",
    "",
    "Nothing has been paid. Confirm the membership in the coach area (Start this membership), then tell them how to pay for the first four weeks.",
  ];
  return { subject: `${plan.name} membership request: ${data.name}`.slice(0, 150), text: lines.join("\n") };
}

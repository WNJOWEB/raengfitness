import { supabaseConfig, type Env } from "./env";
import {
  BOOKABLE_SERVICES,
  BOOKING_EXPERIENCE,
  ONE_TO_ONE_OPTIONS,
  PREFERRED_DAYS,
  PREFERRED_TIMES,
  labelFor,
  listLabels,
  type BookableService,
  type BookingExperience,
  type OneToOneOption,
  type PreferredDay,
  type PreferredTime,
} from "./booking-options";
import { emailError, isValidEmail, messageError, nameError, phoneError, singleLine } from "./form-validation";
import { formatLongDate, fromDateKey, toDateKey, type DateKey } from "./availability/dates";
import { isClassDate } from "./availability/timetable";
import type { PublishedClass } from "./class-sessions";

/**
 * Booking requests from /book: server-side validation, spam checks, the
 * email Alex receives, and whether delivery is configured. Pure functions so
 * they can be unit-tested without a server.
 *
 * A request is not a confirmed booking: visitors choose a real class date
 * from the timetable (group classes) or their preferred days and times
 * (1:1 coaching, which also needs the option chosen: single session or
 * monthly package; and small group coaching, which is an enquiry), and Alex
 * confirms. Success is only reported once the request has been stored or
 * emailed.
 */

/** Anything with FormData's `get`/`getAll` — keeps the parsers testable. */
export interface FieldSource {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

export const MIN_FILL_MS = 3000;

export function text(source: FieldSource, name: string): string {
  const value = source.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function values(source: FieldSource, name: string): string[] {
  return source.getAll(name).filter((v): v is string => typeof v === "string");
}

/**
 * A filled honeypot, or a form submitted faster than a person could fill it
 * in. The start time is set by the browser after load; when it is absent
 * only the honeypot applies.
 */
export function isSpam(source: FieldSource, now: number = Date.now()): boolean {
  if (text(source, "website") !== "") return true;
  const startedAt = Number(text(source, "startedAt"));
  return Number.isFinite(startedAt) && startedAt > 0 && now - startedAt < MIN_FILL_MS;
}

export function submissionId(source: FieldSource): string {
  return singleLine(text(source, "submissionId")).slice(0, 64);
}

export interface BookingRequest {
  service: BookableService;
  /** A confirmed class time, e.g. "Saturday 10:15 am", when the timetable is published. */
  session: string;
  /** The class date chosen for that session, e.g. "2026-10-24". */
  classDate: DateKey | "";
  days: PreferredDay[];
  times: PreferredTime[];
  /** 1:1 coaching only: a single session or the monthly package. "" for other services. */
  option: OneToOneOption | "";
  experience: BookingExperience;
  name: string;
  email: string;
  phone: string;
  message: string;
  submissionId: string;
}

export type BookingField = "service" | "when" | "option" | "experience" | "name" | "email" | "phone" | "message";
export type FieldErrors<F extends string = BookingField> = Partial<Record<F, string>>;

export type ParseResult<T, F extends string> =
  | { kind: "valid"; data: T }
  | { kind: "invalid"; errors: FieldErrors<F> }
  | { kind: "spam" }
  /** A selection from demonstration availability: never accepted. */
  | { kind: "demo" };

export interface BookingParseOptions {
  now?: number;
  /** Confirmed classes offered for group classes; empty → preferences. */
  classes?: readonly PublishedClass[];
}

export function parseBookingRequest(
  source: FieldSource,
  { now = Date.now(), classes = [] }: BookingParseOptions = {},
): ParseResult<BookingRequest, BookingField> {
  if (isSpam(source, now)) return { kind: "spam" };
  if (text(source, "slot") !== "") return { kind: "demo" };

  const errors: FieldErrors = {};
  const service = text(source, "service");
  const session = singleLine(text(source, "session"));
  const classDate = text(source, "classDate");
  const days = values(source, "days").filter((d): d is PreferredDay => PREFERRED_DAYS.some((o) => o.value === d));
  const times = values(source, "times").filter((t): t is PreferredTime => PREFERRED_TIMES.some((o) => o.value === t));
  const experience = text(source, "experience");
  const option = text(source, "option");
  const name = singleLine(text(source, "name"));
  const email = singleLine(text(source, "email")).toLowerCase();
  const phone = singleLine(text(source, "phone"));
  const message = text(source, "message").replace(/\r\n?/g, "\n");

  if (!BOOKABLE_SERVICES.some((s) => s.value === service)) errors.service = "Choose group classes, 1:1 coaching or a small group coaching enquiry.";
  if (service === "one-to-one" && !ONE_TO_ONE_OPTIONS.some((o) => o.value === option)) errors.option = "Choose a single session or the monthly package.";
  const usesSessions = service === "group-class" && classes.length > 0;
  if (usesSessions) {
    const chosen = classes.find((c) => c.label === session);
    if (!chosen || !isClassDate(classDate, chosen, toDateKey(new Date(now)))) errors.when = "Choose a class date and time.";
  } else if (days.length === 0) {
    errors.when = "Choose at least one day that suits you.";
  }
  if (!BOOKING_EXPERIENCE.some((o) => o.value === experience)) errors.experience = "Choose the option that best describes you.";

  const fieldErrors = { name: nameError(name), email: emailError(email), phone: phoneError(phone), message: messageError(message) };
  for (const [field, error] of Object.entries(fieldErrors)) if (error) errors[field as BookingField] = error;

  if (Object.keys(errors).length > 0) return { kind: "invalid", errors };
  return {
    kind: "valid",
    data: {
      service: service as BookableService,
      session: usesSessions ? session : "",
      classDate: usesSessions ? classDate : "",
      days: usesSessions ? [] : days,
      times: usesSessions ? [] : times,
      option: service === "one-to-one" ? (option as OneToOneOption) : "",
      experience: experience as BookingExperience,
      name,
      email,
      phone,
      message,
      submissionId: submissionId(source),
    },
  };
}

/** "Single 1:1 session" for a 1:1 request; "" otherwise. */
export function describeOption(option: string): string {
  return option ? labelFor(ONE_TO_ONE_OPTIONS, option) : "";
}

/** "Mon and Wed · Evening" */
export function describePreferences(days: readonly string[], times: readonly string[]): string {
  const dayText = listLabels(days.map((d) => labelFor(PREFERRED_DAYS, d)));
  const timeText = times.length > 0 ? listLabels(times.map((t) => labelFor(PREFERRED_TIMES, t))) : "Any time";
  return `${dayText} · ${timeText}`;
}

/** "Saturday 24 October 2026, 10:15 am" for a class request; "" otherwise. */
export function describeClass(data: Pick<BookingRequest, "session" | "classDate">): string {
  if (!data.session || !data.classDate) return data.session;
  const year = fromDateKey(data.classDate).getFullYear();
  const time = data.session.split(" ").slice(1).join(" ");
  return `${formatLongDate(data.classDate)} ${year}, ${time}`;
}

/** What the visitor asked for, in one line. */
export function describeWhen(data: Pick<BookingRequest, "session" | "classDate" | "days" | "times">): string {
  return data.session ? describeClass(data) : describePreferences(data.days, data.times);
}

/** The email Alex receives. Plain text: nothing from the visitor is rendered as HTML. */
export function bookingEmail(data: BookingRequest): { subject: string; text: string } {
  const service = labelFor(BOOKABLE_SERVICES, data.service);
  const enquiry = data.service === "small-group";
  const lines = [
    `New ${service.toLowerCase()} ${enquiry ? "from the website" : "booking request from the website"}.`,
    "",
    `Service: ${service}`,
    ...(data.option ? [`Option: ${describeOption(data.option)}`] : []),
    data.session ? `Class: ${describeClass(data)}` : `Preferred: ${describePreferences(data.days, data.times)}`,
    `Experience: ${labelFor(BOOKING_EXPERIENCE, data.experience)}`,
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone || "not given"}`,
    "",
    "Message:",
    data.message || "(none)",
    "",
    "Reply to this email to answer them directly. This is a request, not a confirmed booking.",
  ];
  return { subject: `${service} ${enquiry ? "from" : "booking request:"} ${data.name}`.slice(0, 150), text: lines.join("\n") };
}

export interface BookingDeliveryConfig {
  apiKey: string;
  to: string;
  from: string;
  endpoint: string;
}

const DEFAULT_ENDPOINT = "https://api.resend.com/emails";

/** Accepts `bookings@example.com` or `Alex K Bells <bookings@example.com>`. */
function isValidFrom(value: string): boolean {
  const match = /^(?:[^<>\n]{1,80}<([^<>\s]+)>|([^<>\s]+))$/.exec(value.trim());
  return Boolean(match && isValidEmail(match[1] ?? match[2]));
}

function parseEndpoint(raw: string | undefined): string | null {
  if (!raw) return DEFAULT_ENDPOINT;
  try {
    const url = new URL(raw);
    // Overrides exist for local testing only: https anywhere, http only on localhost.
    if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")) {
      return url.toString();
    }
  } catch {
    // fall through
  }
  return null;
}

/** Null unless every setting needed to deliver requests is present and valid. */
export function bookingDeliveryConfig(env: Env = process.env): BookingDeliveryConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const to = env.BOOKING_NOTIFY_EMAIL?.trim();
  const from = env.BOOKING_FROM_EMAIL?.trim();
  const endpoint = parseEndpoint(env.RESEND_API_URL?.trim());
  if (!apiKey || !to || !from || !endpoint) return null;
  if (!isValidEmail(to) || !isValidFrom(from)) return null;
  return { apiKey, to, from, endpoint };
}

/** Requests can reach Alex: stored in Supabase, emailed via Resend, or both. */
export function isBookingFormEnabled(env: Env = process.env): boolean {
  return supabaseConfig(env) !== null || bookingDeliveryConfig(env) !== null;
}

/** State shared between a server action and its form (useActionState). */
export interface FormState<F extends string = string> {
  status: "idle" | "error" | "success";
  message: string;
  errors: FieldErrors<F>;
}

export const initialFormState: FormState = { status: "idle", message: "", errors: {} };

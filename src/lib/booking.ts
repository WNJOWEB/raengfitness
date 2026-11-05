/**
 * Booking integration boundary. Pages ask for a `CallToAction` and a mode;
 * they never know the provider.
 *
 * Booking modes, in order of preference:
 * 1. "external": a real booking page (BOOKING_URL), e.g. Setmore or Stripe.
 * 2. "demo": the guided booking interface with labelled demonstration
 *    availability, for showing Alex. Never on Vercel production, never sends
 *    or books anything.
 * 3. "request": the guided interface without a calendar: visitors choose a
 *    confirmed class time or their preferred days, and the request is
 *    emailed to Alex, who confirms by reply.
 * 4. "unavailable": honest "Enquire" buttons → /contact. Never a contact page
 *    dressed up as booking, and never a fake booking flow.
 */

import { isPreviewDeployment, isProductionDeployment, type Env } from "./env";
import { isBookingFormEnabled } from "./booking-request";
import type { BookableService } from "./booking-options";

export interface CallToAction {
  kind: "booking" | "enquiry";
  label: string;
  href: string;
  external: boolean;
}

export type BookingMode = "external" | "demo" | "request" | "unavailable";
export type EnquiryMode = "send" | "demo" | "unavailable";

export const ENQUIRY_HREF = "/contact";
export const BOOK_PAGE_HREF = "/book";
/** The online coaching enquiry form. The page /online-coaching describes the service and links here. */
export const ONLINE_COACHING_HREF = "/online-coaching/enquire";

const LABELS: Record<BookableService | "any", string> = {
  any: "Book your session",
  "group-class": "Book your class",
  "one-to-one": "Book a one-to-one",
  "small-group": "Enquire about small group coaching",
};

const PATHS: Record<BookableService | "any", string> = {
  any: BOOK_PAGE_HREF,
  "group-class": "/book/group-class",
  "one-to-one": "/book/one-to-one",
  "small-group": "/book/small-group",
};

/**
 * The one primary call to action used across the public site: always "Book
 * now" (owner's rule, 2026-10-22: never "Get in touch"). Where nothing can
 * take a booking it opens /book, which says so plainly and offers Instagram;
 * it never shows a fake confirmation.
 */
export const PRIMARY_CTA: CallToAction = {
  kind: "enquiry",
  label: "Book now",
  href: BOOK_PAGE_HREF,
  external: false,
};

/**
 * What pages render for the primary call to action. Since 2026-10-18 the
 * button opens the booking page (/book) wherever booking works (a booking
 * URL, the request flow, or the labelled demo), production included, and on
 * every Vercel Preview so the flow can be tried. The label is always "Book now".
 * Where nothing can be booked it is PRIMARY_CTA, still "Book now", still /book.
 */
export const BOOK_NOW_LABEL = "Book now";

export function getPrimaryCta(env: Env = process.env): CallToAction {
  return bookingMode(env) !== "unavailable" || isPreviewDeployment(env)
    ? { ...PRIMARY_CTA, kind: "booking", label: BOOK_NOW_LABEL, href: BOOK_PAGE_HREF }
    : PRIMARY_CTA;
}

/**
 * The same "Book now" button on a service's own page: straight
 * into that service's booking step when /book is open, else the contact
 * page. Online coaching is an enquiry, not a booking: see
 * getOnlineCoachingAction.
 */
export function getPrimaryCtaFor(service: BookableService | "any", env: Env = process.env): CallToAction {
  const cta = getPrimaryCta(env);
  if (cta.kind !== "booking") return cta;
  return { ...cta, href: PATHS[service] };
}

/** Demonstration availability: opt-in, and impossible on Vercel production. */
export function isBookingDemoEnabled(env: Env = process.env): boolean {
  return env.BOOKING_DEMO === "true" && !isProductionDeployment(env);
}

export function parseBookingUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function bookingMode(env: Env = process.env): BookingMode {
  if (parseBookingUrl(env.BOOKING_URL)) return "external";
  if (isBookingDemoEnabled(env)) return "demo";
  if (isBookingFormEnabled(env)) return "request";
  return "unavailable";
}

/** Online coaching never uses availability, so a real send always wins over demo. */
export function onlineEnquiryMode(env: Env = process.env): EnquiryMode {
  if (isBookingFormEnabled(env)) return "send";
  if (isBookingDemoEnabled(env)) return "demo";
  return "unavailable";
}

/** Build-time check: a production site without a working booking route cannot take bookings. */
export function bookingConfigWarning(env: Env = process.env): string | null {
  if (env.VERCEL_ENV !== "production") return null;
  if (env.BOOKING_URL && !parseBookingUrl(env.BOOKING_URL)) {
    return "BOOKING_URL is not a valid https URL, so it is ignored.";
  }
  if (bookingMode(env) !== "unavailable") return null;
  return "No booking route is configured: the main button still says \"Book now\" but /book only shows the Instagram fallback. Set SUPABASE_URL and SUPABASE_SECRET_KEY (requests stored for the coach area), the Resend settings (RESEND_API_KEY, BOOKING_NOTIFY_EMAIL, BOOKING_FROM_EMAIL), or BOOKING_URL — see DEPLOYMENT.md. (BOOKING_DEMO is ignored on production.)";
}

/** The primary "Book" button for a service, or for booking in general. */
export function getBookingAction(service: BookableService | "any" = "any", env: Env = process.env): CallToAction {
  const mode = bookingMode(env);
  if (mode === "external") {
    return { kind: "booking", label: LABELS[service], href: parseBookingUrl(env.BOOKING_URL)!.toString(), external: true };
  }
  if (mode === "demo" || mode === "request") {
    return { kind: "booking", label: LABELS[service], href: PATHS[service], external: false };
  }
  return { kind: "enquiry", label: "Book now", href: BOOK_PAGE_HREF, external: false };
}

export function getClassBookingAction(env: Env = process.env): CallToAction {
  return getBookingAction("group-class", env);
}

/**
 * Every "online coaching" button on the site. Online coaching is always an
 * enquiry (Alex replies personally; nothing is signed up for or paid), so the
 * label says so. It opens the enquiry form when that can be completed, and
 * otherwise the contact page, which points to Instagram.
 */
export function getOnlineCoachingAction(env: Env = process.env): CallToAction {
  const href = onlineEnquiryMode(env) === "unavailable" ? ENQUIRY_HREF : ONLINE_COACHING_HREF;
  return { kind: "enquiry", label: "Enquire about online coaching", href, external: false };
}

/**
 * Every membership button. Memberships renew automatically, which needs a
 * real billing set-up that doesn't exist yet, so until a sign-up page is
 * configured this is an enquiry to /contact. Set MEMBERSHIP_URL_STARTER,
 * MEMBERSHIP_URL_REGULAR and MEMBERSHIP_URL_DEDICATED (https), or one shared
 * MEMBERSHIP_URL, to a hosted sign-up page (e.g. a Stripe subscription link
 * created in the Stripe Dashboard). It never pretends anyone has joined or paid.
 */
export function getMembershipAction(
  planName: string,
  planId?: "starter" | "regular" | "dedicated",
  env: Env = process.env,
): CallToAction {
  const perPlan = planId ? env[`MEMBERSHIP_URL_${planId.toUpperCase()}`] : undefined;
  const url = parseBookingUrl(perPlan) ?? parseBookingUrl(env.MEMBERSHIP_URL);
  if (url) return { kind: "booking", label: `Join ${planName}`, href: url.toString(), external: true };
  return { kind: "enquiry", label: `Enquire about ${planName}`, href: ENQUIRY_HREF, external: false };
}

import { firstClassFree } from "@/content/offers";
import { onlineClassBooking } from "@/content/classes";
import { getService } from "@/content/services";
import { site } from "@/content/site";
import { bookingDeliveryConfig } from "./booking-request";
import { publishedClasses, type PublishedClass } from "./class-sessions";
import { inList, insert, rpc, select, update, type Db, type DbError } from "./coach/db";
import { formatLongDate, londonToUtc, toLondon, formatClock, type DateKey } from "./coach/time";
import type { Env } from "./env";
import { isToken, memberLinkOrigin, randomToken, sha256Hex, SIGN_IN_PATH } from "./member-auth";
import { isPublishable, publishable } from "./publish";
import { formatTime } from "./schedule";
import { sendNotice } from "./notices";
import { referenceFor } from "./reference";
import { sendEmail } from "./send-email";
import { stripeConfig, type StripeConfig } from "./stripe/config";
import { refundCancelledClass, refundSentence, refundSentenceForAlex, type RefundOutcome } from "./class-refunds";
import { createChargeLink } from "./stripe/sync";

/**
 * Booking a group class and paying online, with nothing for Alex to confirm
 * (owner, 2026-10-27; 1:1 stays a request). The database decides
 * (supabase/migrations/20261029000000_akb_instant_class_booking.sql): a place
 * is held for 15 minutes and confirmed only when a payment is recorded
 * against its charge, which happens only after Stripe's verified webhook.
 * Cancelling by the private link 24 hours or more before refunds a paid class
 * in full (lib/class-refunds.ts), and gives a class booked with a credit a
 * new single-use credit link (28 days). Online booking is on wherever online joining
 * is (onlineJoinEnabled in lib/membership-checkout.ts).
 */

export const BOOK_DONE_PATH = "/book/done";
export const BOOK_MANAGE_PATH = "/book/manage";
export const CLASS_BOOK_PATH = "/book/group-class";

export type ClassCheckoutResult =
  | { ok: true; url: string; bookingId: string; confirmed: boolean; firstClassFree?: boolean }
  | { ok: false; reason: "class_full" | "class_cancelled" | "class_started" | "already_booked" | "credit_invalid" | "unavailable" | "returning" };

const RULES = new Set(["class_full", "class_cancelled", "class_started", "already_booked", "credit_invalid"]);

/** "Saturday 31 October, 9:00 am" for a class date and its timetable time. */
export function classWhen(date: string, cls: Pick<PublishedClass, "start">): string {
  return `${formatLongDate(date as DateKey)}, ${formatTime(cls.start)}`;
}

/**
 * Holds a place and opens Stripe's page for the class price (from content,
 * never the form), or, with a valid credit link, books it straight away.
 * The class's start and length come from the published timetable.
 */
export async function startClassCheckout(
  db: Db,
  stripe: StripeConfig,
  booker: { name: string; email: string; phone: string },
  cls: PublishedClass,
  date: DateKey,
  /**
   * `confirmPaid`: the booker has seen that they've trained here before and the
   * class is £12. Without it, someone the free class doesn't apply to gets
   * `returning` (nothing is booked), so the form can say so before Stripe opens.
   */
  options: { idempotencyKey: string; creditToken?: string | null; confirmPaid?: boolean; env?: Env; fetchImpl?: typeof fetch },
): Promise<ClassCheckoutResult> {
  const price = publishable(getService("group-classes").prices)[0];
  if (!price) return { ok: false, reason: "unavailable" };
  const credit = options.creditToken && isToken(options.creditToken) ? await sha256Hex(options.creditToken) : null;

  // First class free (content/offers.ts): a new customer's first class is booked with nothing to pay.
  if (!credit && isPublishable(firstClassFree.status, options.env)) {
    const free = await rpc<{ eligible: boolean; booking_id?: string; status?: string }>(db, "akb_create_free_first_class_booking", {
      p_name: booker.name,
      p_email: booker.email,
      p_phone: booker.phone,
      p_slot: cls.id,
      p_date: date,
      p_starts_at: londonToUtc(date, cls.start),
      p_duration: cls.durationMinutes ?? 60,
      p_idempotency_key: options.idempotencyKey,
    });
    if (free.ok && free.data.eligible && free.data.booking_id) {
      const done = `${memberLinkOrigin(options.env)}${BOOK_DONE_PATH}?booking=${free.data.booking_id}`;
      return { ok: true, url: done, bookingId: free.data.booking_id, confirmed: true, firstClassFree: true };
    }
    // The class itself can't be booked (full, started, already booked…): say so, as a paid booking would.
    if (!free.ok && free.error.kind === "rule" && free.error.rule && RULES.has(free.error.rule)) return { ok: false, reason: ruleReason(free.error) };
    // Not new: say so before opening Stripe (owner, 2026-11-05), then pay as usual once they continue.
    if (free.ok && !free.data.eligible && !options.confirmPaid) return { ok: false, reason: "returning" };
    // The offer isn't in the database yet (migration not applied), or they've continued: pay as usual.
  }

  const created = await rpc<{ booking_id: string; charge_id: string | null; status: string }>(db, "akb_create_class_booking", {
    p_name: booker.name,
    p_email: booker.email,
    p_phone: booker.phone,
    p_slot: cls.id,
    p_date: date,
    p_starts_at: londonToUtc(date, cls.start),
    p_duration: cls.durationMinutes ?? 60,
    p_price_pence: price.amountGbp * 100,
    p_description: `Group class, ${classWhen(date, cls)}`,
    p_credit_token_hash: credit,
    p_idempotency_key: options.idempotencyKey,
  });
  if (!created.ok) return { ok: false, reason: ruleReason(created.error) };
  const done = `${memberLinkOrigin(options.env)}${BOOK_DONE_PATH}?booking=${created.data.booking_id}`;
  if (created.data.status === "confirmed" || !created.data.charge_id) {
    return { ok: true, url: done, bookingId: created.data.booking_id, confirmed: true };
  }
  const link = await createChargeLink(db, stripe, created.data.charge_id, options.fetchImpl, { buyerEmail: booker.email, redirectUrl: done, expiresInMinutes: 35 });
  if (!link.ok) return { ok: false, reason: "unavailable" };
  return { ok: true, url: link.url, bookingId: created.data.booking_id, confirmed: false };
}

/**
 * The booker ticked the participation and risk terms (content/policy.ts
 * classWaiver): keep which wording and when, with the booking, in the event
 * log the coach area reads. Only a version and a time, nothing about health.
 */
export async function recordWaiver(db: Db, bookingId: string, waiver: { version: string; at: string }): Promise<void> {
  const rows = await select<{ client_id: string }>(db, "akb_class_bookings", [["select", "client_id"], ["id", `eq.${bookingId}`]]);
  const clientId = rows.ok ? rows.data[0]?.client_id : undefined;
  if (!clientId) return;
  await insert(db, "akb_events", { client_id: clientId, entity: "class_booking", entity_id: bookingId, action: "waiver_accepted", detail: { version: waiver.version, at: waiver.at } });
}

function ruleReason(error: DbError): Exclude<ClassCheckoutResult, { ok: true }>["reason"] {
  if (error.kind === "rule" && error.rule && RULES.has(error.rule)) return error.rule as Exclude<ClassCheckoutResult, { ok: true }>["reason"];
  console.error(`Online class booking failed (${error.kind} ${error.code})`);
  return "unavailable";
}

interface BookingRow {
  id: string;
  status: "awaiting_payment" | "confirmed" | "expired" | "cancelled" | "needs_attention";
  client_id: string;
  attendance_id: string;
  charge_id: string | null;
  /** Booked with the first-class-free offer (absent until 20261123000000 is applied). */
  first_class_free?: boolean;
}

export interface ClassBookingStatus {
  status: BookingRow["status"];
  when: string | null;
  /** The open Stripe link, while it still waits for payment. */
  payUrl: string | null;
  /** What the class costs (0 when it was booked with a class credit). */
  pricePence: number;
  /** The short reference shown to the customer (from the booking's id). */
  reference: string;
  /** Booked with the first-class-free offer. */
  firstClassFree: boolean;
}

/** What the "after paying" page shows: the class and the state, no personal details. */
export async function classBookingStatus(db: Db, bookingId: string, classes: PublishedClass[]): Promise<ClassBookingStatus | null> {
  const rows = await select<BookingRow>(db, "akb_class_bookings", [["select", "*"], ["id", `eq.${bookingId}`]]);
  const row = rows.ok ? rows.data[0] : undefined;
  if (!row) return null;
  const when = await placeWhen(db, row.attendance_id, classes);
  let payUrl: string | null = null;
  let pricePence = 0;
  if (row.charge_id) {
    const charge = await select<{ amount_pence: number }>(db, "akb_charges", [["select", "amount_pence"], ["id", `eq.${row.charge_id}`]]);
    pricePence = charge.ok ? (charge.data[0]?.amount_pence ?? 0) : 0;
  }
  if (row.status === "awaiting_payment" && row.charge_id) {
    const links = await select<{ url: string }>(db, "akb_square_payment_links", [["select", "url"], ["charge_id", `eq.${row.charge_id}`], ["status", "eq.open"]]);
    payUrl = links.ok ? (links.data[0]?.url ?? null) : null;
  }
  return { status: row.status, when, payUrl, pricePence, reference: referenceFor(row.id), firstClassFree: row.first_class_free === true };
}

export async function placeWhen(db: Db, attendanceId: string, classes: PublishedClass[]): Promise<string | null> {
  const att = await select<{ class_session_id: string }>(db, "akb_class_attendance", [["select", "class_session_id"], ["id", `eq.${attendanceId}`]]);
  const sessionId = att.ok ? att.data[0]?.class_session_id : undefined;
  if (!sessionId) return null;
  const ses = await select<{ slot: string; class_date: string; starts_at: string }>(db, "akb_class_sessions", [["select", "slot,class_date,starts_at"], ["id", `eq.${sessionId}`]]);
  const s = ses.ok ? ses.data[0] : undefined;
  if (!s) return null;
  const cls = classes.find((c) => c.id === s.slot);
  if (cls) return classWhen(s.class_date, cls);
  const { date, time } = toLondon(s.starts_at);
  return `${formatLongDate(date)}, ${formatClock(time)}`;
}

/**
 * Once a booking is confirmed (or needs Alex), emails the booker (with a new
 * private link to manage or cancel it; only its hash is stored) and Alex,
 * once each. Without email settings nothing is marked, so it's tried again.
 */
export async function notifyClassBookings(db: Db, classes: PublishedClass[], env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const email = bookingDeliveryConfig(env);
  if (!email) return 0;
  const rows = await select<BookingRow>(db, "akb_class_bookings", [
    ["select", "*"],
    ["status", "in.(confirmed,needs_attention)"],
    ["notified_at", "is.null"],
    ["order", "created_at.asc"],
    ["limit", "20"],
  ]);
  if (!rows.ok || rows.data.length === 0) return 0;
  const people = await select<{ id: string; full_name: string; email: string; phone: string }>(db, "akb_clients", [
    ["select", "id,full_name,email,phone"],
    ["id", inList(rows.data.map((r) => r.client_id))],
  ]);
  if (!people.ok) return 0;
  let sent = 0;
  for (const row of rows.data) {
    const person = people.data.find((p) => p.id === row.client_id);
    if (!person) continue;
    const when = (await placeWhen(db, row.attendance_id, classes)) ?? "your class";
    const paid = row.first_class_free ? "first class free" : row.charge_id ? "paid online" : "with a class credit";
    const toAlex = await sendEmail(
      email,
      {
        idempotencyKey: `class-booking/${row.id}/coach`,
        replyTo: person.email,
        subject: row.status === "confirmed" ? `Class booked: ${person.full_name}, ${when}` : `Paid, needs you: ${person.full_name}, ${when}`,
        text: [
          row.status === "confirmed"
            ? `${person.full_name} booked the group class on ${when} (${paid}). Their place is confirmed; nothing to confirm. Reference: ${referenceFor(row.id)}.`
            : `${person.full_name} paid for the group class on ${when}, but the place couldn't be confirmed automatically (the class may be full or cancelled). The payment is recorded; please sort out their place in the coach area.`,
          "",
          `Email: ${person.email}`,
          person.phone ? `Phone: ${person.phone}` : null,
        ]
          .filter((l) => l !== null)
          .join("\n"),
      },
      fetchImpl,
    );
    if (!toAlex.ok) continue;
    if (row.status === "confirmed") {
      const token = randomToken();
      const saved = await update(db, "akb_class_bookings", [["id", `eq.${row.id}`]], { manage_token_hash: await sha256Hex(token) });
      if (!saved.ok) continue;
      await sendEmail(
        email,
        {
          idempotencyKey: `class-booking/${row.id}/booker`,
          to: person.email,
          replyTo: email.to,
          subject: `You're booked: ${when}`,
          text: [
            `Your place on the group class on ${when} is confirmed (${paid}).`,
            `Reference: ${referenceFor(row.id)}`,
            `Where: ${site.location.street}, ${site.location.town}, ${site.location.postcode}`,
            "",
            "Need to cancel? Use this private link:",
            `${memberLinkOrigin(env)}${BOOK_MANAGE_PATH}?token=${token}`,
            row.first_class_free
              ? "Can't make it? Cancel at least 24 hours before and you can book your free class for another date. Cancelling later, or not turning up, uses it."
              : row.charge_id
                ? onlineClassBooking.cancel
                : onlineClassBooking.cancelCredit,
            "",
            // The booking is the account (2026-10-28): sign in with this email, no password.
            "Your bookings and any class credits are also in your account. Sign in with this email address, no password needed.",
            `Go to your account: ${memberLinkOrigin(env)}${SIGN_IN_PATH}`,
          ].join("\n"),
        },
        fetchImpl,
      );
    } else {
      await sendEmail(
        email,
        {
          idempotencyKey: `class-booking/${row.id}/booker`,
          to: person.email,
          replyTo: email.to,
          subject: "We've received your payment",
          text: `Thanks. We received your payment for the group class on ${when}, but the place couldn't be confirmed automatically (the class may have filled up). Alex will be in touch to sort it out.`,
        },
        fetchImpl,
      );
    }
    const marked = await update(db, "akb_class_bookings", [["id", `eq.${row.id}`], ["notified_at", "is.null"]], { notified_at: new Date().toISOString() });
    if (marked.ok) sent += 1;
  }
  return sent;
}

export interface ManagedBooking {
  status: BookingRow["status"];
  when: string;
  canCancel: boolean;
  /** Paid with a class credit and 24 hours or more before: cancelling gives the credit back. */
  creditBack: boolean;
  /** Paid and 24 hours or more before: cancelling refunds the payment in full (Alex, 2026-11-05). */
  refundBack: boolean;
  /** The payment was refunded in full (in Stripe), so cancelling gives nothing more back. */
  refunded: boolean;
  classCancelled: boolean;
  /** Booked with the first-class-free offer: no credit; cancelled in time, the free class can be booked again. */
  firstClassFree: boolean;
  /** 24 hours or more before the class. */
  inTime: boolean;
}

/** The booking behind a private manage link, or null. */
export async function bookingByToken(db: Db, token: string, classes: PublishedClass[]): Promise<ManagedBooking | null> {
  if (!isToken(token)) return null;
  const r = await rpc<{ status: BookingRow["status"]; slot: string; class_date: string; starts_at: string; can_cancel: boolean; credit_back_if_cancelled: boolean; refunded?: boolean; class_cancelled: boolean; first_class_free?: boolean; paid?: boolean } | null>(
    db,
    "akb_class_booking_by_token",
    { p_token_hash: await sha256Hex(token) },
  );
  if (!r.ok || !r.data) return null;
  const cls = classes.find((c) => c.id === r.data!.slot);
  const { date, time } = toLondon(r.data.starts_at);
  return {
    status: r.data.status,
    when: cls ? classWhen(r.data.class_date, cls) : `${formatLongDate(date)}, ${formatClock(time)}`,
    canCancel: r.data.can_cancel,
    creditBack: r.data.credit_back_if_cancelled && r.data.paid !== true,
    refundBack: r.data.credit_back_if_cancelled && r.data.paid === true,
    refunded: r.data.refunded === true,
    classCancelled: r.data.class_cancelled,
    firstClassFree: r.data.first_class_free === true,
    inTime: new Date(r.data.starts_at).getTime() - Date.now() >= 24 * 60 * 60 * 1000,
  };
}

/**
 * Cancels by the private link. 24 hours or more before: a paid class is
 * refunded in full; one booked with a credit gets a single-use credit link,
 * returned and emailed (only its hash is stored).
 */
export async function cancelByToken(
  db: Db,
  token: string,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
  stripe: StripeConfig | null = stripeConfig(env),
): Promise<
  | { ok: true; creditLink: string | null; refunded: boolean; freeClassBack?: boolean; firstClassFree?: boolean; refund?: { outcome: RefundOutcome; amountPence: number } }
  | { ok: false; reason: "not_found" | "not_booked" | "class_started" | "failed" }
> {
  if (!isToken(token)) return { ok: false, reason: "not_found" };
  const creditToken = randomToken();
  const hash = await sha256Hex(token);
  const r = await rpc<{ credit: boolean; refunded?: boolean; first_class_free?: boolean; free_class_back?: boolean; refund_due?: boolean; booking_id?: string }>(db, "akb_cancel_class_booking", { p_token_hash: hash, p_credit_token_hash: await sha256Hex(creditToken) });
  if (!r.ok) {
    const rule = r.error.kind === "rule" ? r.error.rule : null;
    return { ok: false, reason: rule === "not_found" || rule === "not_booked" || rule === "class_started" ? rule : "failed" };
  }
  const refunded = r.data.refunded === true;
  const creditLink = r.data.credit ? `${memberLinkOrigin(env)}${CLASS_BOOK_PATH}?credit=${creditToken}` : null;
  // Paid and cancelled 24 hours or more before: refunded in full (before the emails, so they say how).
  const refund = r.data.refund_due && r.data.booking_id ? await refundCancelledClass(db, r.data.booking_id, stripe, env, fetchImpl) : null;
  // Tell the booker it's cancelled (with the credit link when one was given) and tell Alex, once each.
  // Best effort: the cancellation has already happened and the page shows the outcome.
  const rows = await select<{ id: string; client_id: string; attendance_id: string }>(db, "akb_class_bookings", [["select", "id,client_id,attendance_id"], ["manage_token_hash", `eq.${hash}`]]);
  const booking = rows.ok ? rows.data[0] : undefined;
  if (booking) {
    const people = await select<{ full_name: string; email: string }>(db, "akb_clients", [["select", "full_name,email"], ["id", `eq.${booking.client_id}`]]);
    const person = people.ok ? people.data[0] : undefined;
    if (person) {
      const when = (await placeWhen(db, booking.attendance_id, publishedClasses())) ?? "your class";
      const free = r.data.first_class_free === true;
      const outcome = free
        ? r.data.free_class_back
          ? `Your free first class is still yours: book it for another date here:\n${memberLinkOrigin(env)}${CLASS_BOOK_PATH}`
          : "It was less than 24 hours before the class, so your free first class has been used."
        : refund
        ? refundSentence(refund.outcome, refund.amountPence)
        : creditLink
        ? `Here's your credit for another group class within the next 4 weeks:\n${creditLink}\nIt works once. Nothing to pay when you book with it.`
        : refunded
          ? "Your payment for this class was already refunded, so there's nothing more to refund."
          : "It was less than 24 hours before the class, so there's nothing back.";
      await sendNotice(
        {
          label: "class-cancel",
          key: `class-cancel/${hash}`,
          customer: { email: person.email, subject: creditLink ? "Your class credit" : refund ? `Cancelled and refunded: ${when}` : `Cancelled: ${when}`, text: `Your booking for the group class on ${when} is cancelled.\n\n${outcome}` },
          alex: {
            subject: `Class cancelled: ${person.full_name}, ${when}`,
            text: `${person.full_name} (${person.email}) cancelled their booking for the group class on ${when} using their private link.\n\n${free ? (r.data.free_class_back ? "It was their free first class, cancelled in time, so they can book it again." : "It was their free first class, cancelled less than 24 hours before, so it's used.") : refund ? refundSentenceForAlex(refund.outcome, refund.amountPence) : creditLink ? "They were given a class credit for another class within 4 weeks." : refunded ? "Their payment had already been refunded, so no credit was given and the class fee is cancelled." : "It was less than 24 hours before the class, so no credit was given."}`,
          },
        },
        env,
        fetchImpl,
      );
    }
  }
  return { ok: true, creditLink, refunded, ...(refund ? { refund } : {}), ...(r.data.first_class_free ? { firstClassFree: true, freeClassBack: r.data.free_class_back === true } : {}) };
}

/** Whether a credit link can still be used, and until when. */
export async function creditStatus(db: Db, token: string): Promise<{ usable: boolean; expiresOn: string } | null> {
  if (!isToken(token)) return null;
  const r = await rpc<{ usable: boolean; expires_on: string } | null>(db, "akb_class_credit_by_token", { p_token_hash: await sha256Hex(token) });
  return r.ok && r.data ? { usable: r.data.usable, expiresOn: r.data.expires_on } : null;
}

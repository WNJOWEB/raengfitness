import { groupClass } from "@/content/classes";
import { formatAddressLines, site } from "@/content/site";
import { formatLongDate, type DateKey } from "./availability/dates";
import { bookingDeliveryConfig } from "./booking-request";
import { classWhen, CLASS_BOOK_PATH } from "./class-checkout";
import { publishedClasses } from "./class-sessions";
import { rpc, type Db, type DbError, type DbResult } from "./coach/db";
import type { Env } from "./env";
import { ACCOUNT_PATH, memberLinkOrigin, randomToken, sha256Hex } from "./member-auth";
import { sendEmail } from "./send-email";

/**
 * The waitlist for full classes (owner, 2026-11-04; migration
 * 20261120000000, where the rules are written down): join a class that is
 * full, be emailed when a place opens (places aren't held: first to book gets
 * it), leave any time. Server only.
 */

export const WAITLIST_PATH = "/book/waitlist";

export interface WaitlistJoin {
  status: "joined" | "already";
  id: string;
  position: number;
  slot: string;
  class_date: string;
  starts_at: string;
}

export interface WaitlistEntry {
  id: string;
  status: "waiting" | "offered";
  slot: string;
  class_date: string;
  starts_at: string;
  position: number;
}

export type WaitlistReason = "not_full" | "already_booked" | "class_started" | "class_cancelled" | "class_not_found" | "waitlist_full" | "invalid_email" | "unavailable";

const REASONS = new Set<string>(["not_full", "already_booked", "class_started", "class_cancelled", "class_not_found", "waitlist_full", "invalid_email"]);

export function waitlistReason(error: DbError): WaitlistReason {
  if (error.kind === "rule" && error.rule && REASONS.has(error.rule)) return error.rule as WaitlistReason;
  return "unavailable";
}

/** What the page says for each refusal. */
export const WAITLIST_MESSAGES: Record<WaitlistReason, string> = {
  not_full: "This class has a place free now, so you can book it instead.",
  already_booked: "You're already booked on this class.",
  class_started: "This class has already started.",
  class_cancelled: "This class has been cancelled.",
  class_not_found: "We couldn't find that class.",
  waitlist_full: "The waitlist for this class is full.",
  invalid_email: "Please check your email address.",
  unavailable: "Sorry, something went wrong. Please try again in a minute.",
};

/** "Monday 9 November, 6:30 pm" for a timetable slot on a date. */
export function whenFor(slot: string, date: string): string {
  const cls = publishedClasses().find((c) => c.id === slot);
  return cls ? classWhen(date, cls) : formatLongDate(date as DateKey);
}

export const memberWaitlist = (db: Db, clientId: string): Promise<DbResult<WaitlistEntry[]>> => rpc<WaitlistEntry[]>(db, "akb_member_waitlist", { p_client: clientId });

export const joinWaitlistAsMember = (db: Db, clientId: string, slot: string, date: string): Promise<DbResult<WaitlistJoin>> =>
  rpc<WaitlistJoin>(db, "akb_member_waitlist_join", { p_client: clientId, p_slot: slot, p_date: date });

export const leaveWaitlistAsMember = (db: Db, clientId: string, id: string): Promise<DbResult<boolean>> =>
  rpc<boolean>(db, "akb_member_waitlist_leave", { p_client: clientId, p_id: id });

/** Offers freed places on every class with people waiting, and lets lapsed offers go (daily, and after a class size changes). */
export const refreshWaitlist = (db: Db): Promise<DbResult<number>> => rpc<number>(db, "akb_waitlist_refresh", {});

/** A visitor joins with their details; they're emailed the confirmation with a private link to leave. */
export async function joinWaitlistPublic(
  db: Db,
  person: { name: string; email: string; phone: string },
  slot: string,
  date: string,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; data: WaitlistJoin } | { ok: false; reason: WaitlistReason }> {
  const token = randomToken();
  const joined = await rpc<WaitlistJoin>(db, "akb_waitlist_join_public", {
    p_name: person.name,
    p_email: person.email,
    p_phone: person.phone,
    p_slot: slot,
    p_date: date,
    p_token_hash: await sha256Hex(token),
  });
  if (!joined.ok) return { ok: false, reason: waitlistReason(joined.error) };
  const mail = bookingDeliveryConfig(env);
  // Only the first time: asking again changes nothing and the first email's link still works.
  if (mail && joined.data.status === "joined") {
    const message = waitlistJoinedEmail({ name: person.name, when: whenFor(slot, date), position: joined.data.position, leaveLink: `${memberLinkOrigin(env)}${WAITLIST_PATH}?leave=${token}` });
    await sendEmail(mail, { idempotencyKey: `waitlist-joined/${joined.data.id}/${joined.data.position}`, to: person.email.trim().toLowerCase(), replyTo: mail.to, ...message }, fetchImpl).catch(() => undefined);
  }
  return { ok: true, data: joined.data };
}

/** Leaves with the private link from the confirmation email. Null: no such link. */
export async function leaveWaitlistByToken(db: Db, token: string): Promise<DbResult<{ slot: string; class_date: string; starts_at: string; was_waiting: boolean } | null>> {
  return rpc(db, "akb_waitlist_leave_token", { p_token_hash: await sha256Hex(token) });
}

const first = (name: string) => name.trim().split(/\s+/)[0] || "there";

const ordinal = (n: number) => {
  const mod = n % 100;
  if (mod >= 11 && mod <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/** The confirmation to someone who has joined (plain text). */
export function waitlistJoinedEmail(a: { name: string; when: string; position: number; leaveLink: string }): { subject: string; text: string } {
  return {
    subject: `You're on the waitlist: ${a.when}`,
    text: [
      `Hi ${first(a.name)},`,
      "",
      `You're on the waitlist for ${groupClass.name} on ${a.when}. You're ${ordinal(a.position)} in the queue.`,
      "",
      "That class is full. If a place opens, we'll email you straight away. Places aren't held: they go to whoever books first, so book soon when you hear from us.",
      "",
      `Changed your mind? Leave the waitlist here: ${a.leaveLink}`,
      "",
      `${site.name}, ${formatAddressLines().join(", ")}`,
    ].join("\n"),
  };
}

/** "A place has opened" (plain text). */
export function waitlistOfferEmail(a: { name: string; when: string; link: string }): { subject: string; text: string } {
  return {
    subject: `A place has opened: ${a.when}`,
    text: [
      `Hi ${first(a.name)},`,
      "",
      `A place has opened up in ${groupClass.name} on ${a.when}. Book it here:`,
      a.link,
      "",
      "Places aren't held: they go to whoever books first, so book soon. If you don't book within a day, the place is offered to the next person on the waitlist.",
      "",
      "No longer need it? You can ignore this email.",
      "",
      `${site.name}, ${formatAddressLines().join(", ")}`,
    ].join("\n"),
  };
}

interface OfferRow {
  id: string;
  offered_at: string;
  name: string;
  email: string;
  slot: string;
  class_date: string;
  can_sign_in: boolean;
}

/**
 * Emails everyone newly offered a place, once each (marked only when the email
 * went, so a failure is tried again). Members who can sign in are sent to their
 * account's Book page, anyone else to the booking page. Returns how many.
 */
export async function sendWaitlistOffers(db: Db, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const mail = bookingDeliveryConfig(env);
  if (!mail) return 0;
  const due = await rpc<OfferRow[]>(db, "akb_waitlist_to_notify", {});
  if (!due.ok) return 0;
  let sent = 0;
  for (const o of due.data) {
    const origin = memberLinkOrigin(env);
    const link = o.can_sign_in ? `${origin}${ACCOUNT_PATH}/book` : `${origin}${CLASS_BOOK_PATH}`;
    const message = waitlistOfferEmail({ name: o.name, when: whenFor(o.slot, o.class_date), link });
    const result = await sendEmail(mail, { idempotencyKey: `waitlist-offer/${o.id}/${o.offered_at}`, to: o.email, replyTo: mail.to, ...message }, fetchImpl);
    if (!result.ok) continue;
    const marked = await rpc<null>(db, "akb_waitlist_notified", { p_id: o.id, p_offered_at: o.offered_at });
    if (marked.ok) sent += 1;
  }
  return sent;
}

/** After anything that may free a place: offer it, then tell the people offered. Best effort. */
export async function afterPlacesChange(db: Db, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<void> {
  await refreshWaitlist(db).catch(() => undefined);
  await sendWaitlistOffers(db, env, fetchImpl).catch(() => undefined);
}

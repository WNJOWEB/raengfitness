import { type Env, siteUrl } from "./env";
import { rpc, type Db, type DbResult } from "./coach/db";

/**
 * Member accounts (owner, 2026-10-26; docs/MEMBER_ACCOUNTS_DRAFT.md): our own
 * one-time email links, no passwords and no Supabase Auth users. The
 * database (migration 20261027000000_akb_member_accounts.sql) stores only
 * SHA-256 hashes of links and sessions; these helpers make the random
 * values, hash them, and call the member functions with the secret key on
 * the server. Members never get database access.
 */

export const ACCOUNT_PATH = "/account";
export const SIGN_IN_PATH = "/account/sign-in";
export const CONFIRM_PATH = "/account/confirm";
export const MEMBER_SESSION_COOKIE = "akb_member_session";
/** Matches the database: a session lasts 30 days from its last use (up to a year from signing in). */
export const MEMBER_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** 32 random bytes, base64url: 43 characters. Used for sign-in links and sessions. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Only values shaped like randomToken() are ever looked up. */
export function isToken(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** A 6-digit sign-in code (uniform: values that would bias the remainder are drawn again). */
export function randomCode(): string {
  const box = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(box);
    if (box[0] < 4_294_000_000) return String(box[0] % 1_000_000).padStart(6, "0");
  }
}

/** The 6 digits typed by the member, without spaces; null unless that's all it is. */
export function normaliseCode(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Lower-case hex SHA-256, as the database stores it. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * httpOnly so page scripts can't read it. Sent to the whole site (2026-10-28,
 * was /account only) so the booking forms can fill in a signed-in customer's
 * details (/api/account/details); nothing else reads it.
 */
export function memberCookieOptions(env: Env = process.env) {
  // Plain http only for the local e2e stand-in, like the coach cookies.
  const local = env.SUPABASE_URL?.startsWith("http://localhost:") ?? false;
  return { httpOnly: true, secure: env.NODE_ENV === "production" && !local, sameSite: "lax" as const, path: "/", maxAge: MEMBER_SESSION_MAX_AGE };
}

/** Where the cookie was set before 2026-10-28; cleared on sign-out too. */
export const LEGACY_COOKIE_PATH = ACCOUNT_PATH;

/**
 * Where the emailed link points. Never taken from the request's Host header
 * (a forged header would put someone else's domain in the email): the site's
 * own address on production, the preview's own address on previews.
 */
export function memberLinkOrigin(env: Env = process.env): string {
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return siteUrl(env);
}

export function signInLink(token: string, env: Env = process.env): string {
  return `${memberLinkOrigin(env)}${CONFIRM_PATH}?token=${token}`;
}

/**
 * The sign-in email. The code is shown large in the HTML version (owner, 2026-11-05: it was too small to read) and is in the subject too, so it shows in
 * the phone's notification (and iPhone offers it above the keyboard).
 */
export function signInEmail(link: string, code: string): { subject: string; text: string; code: string } {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  return {
    subject: `Your RAENG sign-in code: ${spaced}`,
    text: [
      `Your sign-in code is ${spaced}`,
      "",
      "Type it on the sign-in page you came from. Or sign in with this link:",
      "",
      link,
      "",
      "The code and the link work once, for the next 15 minutes.",
      "",
      "If you didn't ask for this, you can ignore this email: nobody can sign in without the code or the link.",
    ].join("\n"),
    code,
  };
}

// ---------------------------------------------------------------------------
// The member functions (server only, secret key)
// ---------------------------------------------------------------------------

export function createLoginLink(db: Db, email: string, tokenHash: string): Promise<DbResult<boolean>> {
  return rpc<boolean>(db, "akb_member_create_login_link", { p_email: email, p_token_hash: tokenHash });
}

/** The link plus its code (migration 20261111000000). Returns whether an email should go. */
export function createSignIn(db: Db, email: string, tokenHash: string, codeHash: string): Promise<DbResult<boolean>> {
  return rpc<boolean>(db, "akb_member_create_sign_in", { p_email: email, p_token_hash: tokenHash, p_code_hash: codeHash });
}

/** Signs in with the emailed code. Null for wrong, expired, used, too many tries or no account. */
export function redeemLoginCode(db: Db, email: string, codeHash: string, sessionHash: string): Promise<DbResult<string | null>> {
  return rpc<string | null>(db, "akb_member_redeem_login_code", { p_email: email, p_code_hash: codeHash, p_session_hash: sessionHash });
}

export function redeemLoginLink(db: Db, tokenHash: string, sessionHash: string): Promise<DbResult<string | null>> {
  return rpc<string | null>(db, "akb_member_redeem_login_link", { p_token_hash: tokenHash, p_session_hash: sessionHash });
}

export function sessionClient(db: Db, sessionHash: string): Promise<DbResult<string | null>> {
  return rpc<string | null>(db, "akb_member_session_client", { p_session_hash: sessionHash });
}

export function signOut(db: Db, sessionHash: string, everywhere: boolean): Promise<DbResult<null>> {
  return rpc<null>(db, "akb_member_sign_out", { p_session_hash: sessionHash, p_everywhere: everywhere });
}

export interface MemberPlace {
  id: string;
  class_date: string;
  starts_at: string;
  slot: string;
  status: "booked" | "attended" | "cancelled" | "no_show";
  late_cancel: boolean;
  with_credit: boolean;
  /** How it was paid: membership credit, paid online, a class credit, or arranged with Alex. */
  how: "credit" | "paid" | "class_credit" | "free" | "other";
  class_cancelled: boolean;
  can_cancel: boolean;
  credit_back_if_cancelled: boolean;
  /** A paid place whose payment was refunded in full: cancelling gives nothing more back. */
  refunded?: boolean;
}

/**
 * Everything the account page shows (migration 20261030000000): members and
 * pay-as-you-go customers alike; membership and period are null without one.
 */
export interface MemberOverview {
  client: { name: string; email: string; phone: string };
  membership: {
    plan: string;
    plan_name: string;
    status: "active" | "paused" | "cancelled";
    price_pence: number;
    credits: number;
    start_on: string;
    cancelled_on: string | null;
    renews_on: string | null;
  } | null;
  period: { start: string; end: string; credits: number; used: number; left: number } | null;
  places: MemberPlace[];
  /** Unused class credits from cancelled paid bookings. */
  class_credits: { id: string; expires_on: string }[];
  /** Classes paid for singly online, from 14 days ago to 13 days ahead (4 weeks). */
  paid_classes_28d: number;
}

export function memberOverview(db: Db, clientId: string): Promise<DbResult<MemberOverview>> {
  return rpc<MemberOverview>(db, "akb_member_overview", { p_client: clientId });
}

export function bookWithCredit(
  db: Db,
  args: { clientId: string; slot: string; date: string; startsAt: string; durationMinutes: number },
): Promise<DbResult<string>> {
  return rpc<string>(db, "akb_member_book_class", {
    p_client: args.clientId,
    p_slot: args.slot,
    p_date: args.date,
    p_starts_at: args.startsAt,
    p_duration: args.durationMinutes,
  });
}

/** True when the cancellation was late (the credit is used). */
export function cancelPlace(db: Db, clientId: string, attendanceId: string): Promise<DbResult<boolean>> {
  return rpc<boolean>(db, "akb_member_cancel_place", { p_client: clientId, p_attendance: attendanceId });
}

/**
 * Cancels one of the customer's own paid bookings (by its place). 24 hours or
 * more before: a class credit for 28 days (it shows in the account; only the
 * hash of its link is stored), unless the payment was already refunded in
 * full. Returns whether a credit was given and whether it had been refunded.
 */
export async function cancelPaidPlace(db: Db, clientId: string, attendanceId: string): Promise<DbResult<{ credit: boolean; refunded: boolean; firstClassFree?: boolean; freeClassBack?: boolean }>> {
  const r = await rpc<{ credit: boolean; refunded?: boolean; first_class_free?: boolean; free_class_back?: boolean }>(db, "akb_member_cancel_booking", {
    p_client: clientId,
    p_attendance: attendanceId,
    p_credit_token_hash: await sha256Hex(randomToken()),
  });
  return r.ok
    ? { ok: true, data: { credit: r.data.credit, refunded: r.data.refunded === true, ...(r.data.first_class_free ? { firstClassFree: true, freeClassBack: r.data.free_class_back === true } : {}) } }
    : r;
}

/** Books a class with one of the customer's own class credits: confirmed at once, nothing to pay. */
export function bookWithClassCredit(
  db: Db,
  args: { clientId: string; creditId: string; slot: string; date: string; startsAt: string; durationMinutes: number; idempotencyKey: string },
): Promise<DbResult<{ booking_id: string; status: string }>> {
  return rpc(db, "akb_member_book_with_class_credit", {
    p_client: args.clientId,
    p_credit: args.creditId,
    p_slot: args.slot,
    p_date: args.date,
    p_starts_at: args.startsAt,
    p_duration: args.durationMinutes,
    p_idempotency_key: args.idempotencyKey,
  });
}

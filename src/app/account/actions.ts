"use server";

import { formatAddressLines } from "@/content/site";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { bookingDeliveryConfig, isSpam, text, type FormState } from "@/lib/booking-request";
import { isClassDate } from "@/lib/availability/timetable";
import { classWhen, notifyClassBookings, placeWhen } from "@/lib/class-checkout";
import { MEMBERS_VIEW_PATH } from "@/lib/members-app";
import { publishedClasses } from "@/lib/class-sessions";
import { coachDb, isUuid, type Db } from "@/lib/coach/db";
import { formatLongDate, londonToday, londonToUtc, type DateKey } from "@/lib/coach/time";
import { emailError, singleLine } from "@/lib/form-validation";
import {
  ACCOUNT_PATH,
  bookWithClassCredit,
  bookWithCredit,
  cancelPaidPlace,
  cancelPlace,
  createSignIn,
  isToken,
  LEGACY_COOKIE_PATH,
  MEMBER_SESSION_COOKIE,
  memberLinkOrigin,
  memberOverview,
  memberCookieOptions,
  normaliseCode,
  randomCode,
  randomToken,
  redeemLoginCode,
  redeemLoginLink,
  sha256Hex,
  SIGN_IN_PATH,
  signInEmail,
  signInLink,
  signOut,
} from "@/lib/member-auth";
import { deviceLabel, labelSession } from "@/lib/member-settings";
import { requireMember } from "@/lib/member-session";
import { sendNotice } from "@/lib/notices";
import { refundSentence, refundSentenceForAlex } from "@/lib/class-refunds";
import { pauseErrorCode, pauseOwnMembership, undoOwnPause } from "@/lib/membership-pause";
import { afterPlacesChange, joinWaitlistAsMember, leaveWaitlistAsMember, waitlistReason } from "@/lib/waitlist";
import { DONE } from "./data";
import { sendEmailWithRetry } from "@/lib/send-email";
import { stripeConfig } from "@/lib/stripe/config";
import { cancelOwnMembership, endUnusedDirectDebit, restartOwnMembership, startCardUpdate, startDirectDebitSetup } from "@/lib/stripe/direct-debit";

export type SignInField = "email" | "code";

/**
 * Sends a one-time sign-in link to a customer's email (a member, or anyone
 * who has paid for a class: migration 20261030000000). The visitor sees the
 * same message whether or not the address has an account (so the form can't
 * be used to find out who does), and nothing says whether an email went.
 */
export async function requestSignInLink(_previous: FormState<SignInField>, formData: FormData): Promise<FormState<SignInField>> {
  const db = coachDb();
  const mail = bookingDeliveryConfig();
  if (!db || !mail) {
    return { status: "error", message: "Signing in by email isn't available yet. Please message Alex on Instagram.", errors: {} };
  }
  if (isSpam(formData)) {
    return { status: "error", message: "Please wait a few seconds and try again.", errors: {} };
  }
  const email = singleLine(text(formData, "email")).toLowerCase();
  const error = emailError(email);
  if (error) return { status: "error", message: "Please check your email address.", errors: { email: error } };

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  // The same email carries a code (owner, 2026-11-03): iPhone mail apps open links in their own browser.
  const code = randomCode();
  const created = await createSignIn(db, email, tokenHash, await sha256Hex(code));
  if (!created.ok) {
    console.error(`Member sign-in link failed (${created.error.kind} ${created.error.code})`);
    return { status: "error", message: "Sorry, something went wrong. Please try again in a minute.", errors: {} };
  }
  if (created.data) {
    const sent = await sendEmailWithRetry(mail, {
      ...signInEmail(signInLink(token), code),
      to: email,
      replyTo: mail.to,
      idempotencyKey: `member-sign-in/${tokenHash}`,
    });
    // Logged without the address; the visitor sees the same message either way.
    if (!sent.ok) console.error(`Member sign-in email failed (${sent.status ?? "network"})`);
  }
  return { status: "success", message: email, errors: {} };
}

/**
 * Signs in with the 6-digit code from the email, typed on the sign-in page in
 * the browser the member is using. Every failure gives the same answer, so it
 * never says whether the address has an account; 5 wrong codes and it stops
 * accepting them (the database counts).
 */
export async function confirmSignInCode(_previous: FormState<SignInField>, formData: FormData): Promise<FormState<SignInField>> {
  const db = coachDb();
  const email = singleLine(text(formData, "email")).toLowerCase();
  const code = normaliseCode(text(formData, "code"));
  if (!db) return { status: "error", message: "Signing in isn't available just now. Please try again in a minute.", errors: {} };
  if (!code) return { status: "error", message: "Enter the 6 digits from the email.", errors: { code: "Enter the 6 digits from the email." } };
  if (emailError(email)) return { status: "error", message: "Please ask for a new code.", errors: {} };
  const session = randomToken();
  const result = await redeemLoginCode(db, email, await sha256Hex(code), await sha256Hex(session));
  if (!result.ok || !result.data) {
    const wrong = "That code isn't right, or it has expired. Check it against the newest email, or ask for a new one.";
    return { status: "error", message: wrong, errors: { code: wrong } };
  }
  await labelSession(db, await sha256Hex(session), deviceLabel((await headers()).get("user-agent"))).catch(() => null);
  (await cookies()).set(MEMBER_SESSION_COOKIE, session, memberCookieOptions());
  redirect(ACCOUNT_PATH);
}

/**
 * Uses a sign-in link: only from the button on /account/confirm (a POST),
 * so an email scanner opening the link can't use it up.
 */
export async function confirmSignIn(formData: FormData): Promise<void> {
  const token = text(formData, "token");
  const db = coachDb();
  if (!db || !isToken(token)) redirect(`${SIGN_IN_PATH}?link=invalid`);
  const session = randomToken();
  const result = await redeemLoginLink(db, await sha256Hex(token), await sha256Hex(session));
  if (!result.ok || !result.data) redirect(`${SIGN_IN_PATH}?link=invalid`);
  // So the member can tell their devices apart (Sign-in and security); best effort, the label is only the device and browser family.
  await labelSession(db, await sha256Hex(session), deviceLabel((await headers()).get("user-agent"))).catch(() => null);
  (await cookies()).set(MEMBER_SESSION_COOKIE, session, memberCookieOptions());
  redirect(ACCOUNT_PATH);
}

/** What the account page says after an action (?done= or ?error=). */
const RULES: Record<string, string> = {
  class_full: "class_full",
  class_cancelled: "class_cancelled",
  no_credits: "no_credits",
  already_booked: "already_booked",
  class_started: "class_started",
  no_membership: "outside_period",
  period_unpaid: "period_unpaid",
  not_found: "not_found",
  not_booked: "not_found",
  not_credit_place: "not_found",
  credit_invalid: "credit_invalid",
};

/** The members view an action was used from (home, book or plan), to go back to it. */
function back(formData: FormData): string {
  const view = text(formData, "back");
  return view === "book" || view === "plan" ? MEMBERS_VIEW_PATH[view] : MEMBERS_VIEW_PATH.home;
}

/** The cancelled class (date.slot), so Book stays on its week; anything else is dropped. */
function at(formData: FormData): string {
  const value = text(formData, "at");
  return /^\d{4}-\d{2}-\d{2}\.[a-z0-9-]{1,40}$/.test(value) ? `&at=${value}` : "";
}

const errorFor = (result: { ok: false; error: { kind: string; rule?: string | null } }) =>
  result.error.kind === "rule" ? (RULES[result.error.rule ?? ""] ?? "failed") : "failed";

/** The member's name and email, for the emails that follow their own actions. Null if it can't be read (the action still stands). */
async function whoIs(member: { db: Db; clientId: string }): Promise<{ name: string; email: string } | null> {
  const overview = await memberOverview(member.db, member.clientId);
  return overview.ok ? { name: overview.data.client.name, email: overview.data.client.email } : null;
}

/** A timestamp to the minute, so one event is emailed once but the same class booked, cancelled and booked again is not mistaken for a repeat. */
const minute = () => new Date().toISOString().slice(0, 16);

/**
 * Books a class with a credit. The class's start time and length come from
 * the published timetable, never from the form: the form only says which
 * timetable class and which date.
 */
export async function bookClass(formData: FormData): Promise<void> {
  const member = await requireMember();
  const slot = publishedClasses().find((c) => c.id === text(formData, "slot"));
  const date = text(formData, "date");
  if (!slot || !isClassDate(date, slot, londonToday())) redirect(`${back(formData)}?error=not_found`);
  const result = await bookWithCredit(member.db, {
    clientId: member.clientId,
    slot: slot.id,
    date,
    startsAt: londonToUtc(date, slot.start),
    durationMinutes: slot.durationMinutes ?? 60,
  });
  if (!result.ok) redirect(`${back(formData)}?error=${errorFor(result)}`);
  // The emails go after the reply: the tap answers as soon as the place is booked.
  after(async () => {
    try {
    const who = await whoIs(member);
    if (who) {
      const when = classWhen(date, slot);
      await sendNotice({
        label: "member-book",
        key: `member-book/${result.data}`,
        customer: { email: who.email, subject: `You're booked: ${when}`, text: `Your place on the group class on ${when} is confirmed (one membership credit used).\nWhere: ${formatAddressLines().join(", ")}\n\nYou can see or cancel it in your account: ${memberLinkOrigin()}${ACCOUNT_PATH}` },
        alex: { subject: `Class booked: ${who.name}, ${when}`, text: `${who.name} (${who.email}) booked the group class on ${when} with a membership credit. Their place is confirmed; nothing to confirm.` },
      });
    }
    } catch {
      console.error("Member booking emails failed");
    }
  });
  // at= marks the class just booked on the page.
  redirect(`${back(formData)}?done=booked&at=${date}.${slot.id}`);
}

/**
 * Cancels one of the customer's own places. Late cancellations are confirmed
 * on the page first. 24 hours or more before, everything comes back (Alex,
 * 2026-11-05): a membership credit, a card payment (refunded in full), a
 * class credit, or the free first class.
 */
export async function cancelClass(formData: FormData): Promise<void> {
  const member = await requireMember();
  const id = text(formData, "place");
  if (!isUuid(id)) redirect(`${back(formData)}?error=not_found`);
  const paid = text(formData, "paid") === "yes";
  const result = paid ? await cancelPaidPlace(member.db, member.clientId, id, stripeConfig()) : await cancelPlace(member.db, member.clientId, id);
  if (!result.ok) redirect(`${back(formData)}?error=${errorFor(result)}`);
  // For a paid place: refunded, a class credit given, or already refunded. For a membership place: whether it was late (credit used).
  const outcome =
    result.data === true ? "cancelled_late"
    : result.data === false ? "cancelled"
    : result.data.firstClassFree ? (result.data.freeClassBack ? "cancelled_free_back" : "cancelled_free_used")
    : result.data.refund ? (result.data.refund.outcome === "manual" ? "cancelled_refund_manual" : "cancelled_refund")
    : result.data.credit ? "cancelled_credit"
    : result.data.refunded ? "cancelled_paid_refunded"
    : "cancelled_paid_late";
  const refund = typeof result.data === "object" ? result.data.refund : undefined;
  // The emails go after the reply (the lookups for them too), and a freed place is offered to the waitlist.
  after(async () => {
    await afterPlacesChange(member.db);
    try {
    const who = await whoIs(member);
    if (who) {
      const when = (await placeWhen(member.db, id, publishedClasses())) ?? "your class";
      const effect = refund ? `Cancelled. ${refundSentence(refund.outcome, refund.amountPence)}` : (DONE[outcome] ?? "Cancelled.");
      const forAlex = refund ? refundSentenceForAlex(refund.outcome, refund.amountPence) : effect;
      await sendNotice({
        label: "member-cancel",
        key: `member-cancel/${id}/${minute()}`,
        customer: { email: who.email, subject: `Cancelled: ${when}`, text: `Your place on the group class on ${when} is cancelled.\n\n${effect}` },
        alex: { subject: `Class cancelled: ${who.name}, ${when}`, text: `${who.name} (${who.email}) cancelled their place on the group class on ${when}.\n\n${forAlex}` },
      });
    }
    } catch {
      console.error("Member cancellation emails failed");
    }
  });
  redirect(`${back(formData)}?done=${outcome}${at(formData)}`);
}

/**
 * Books a class with one of the customer's class credits. As with credits,
 * the class's start time comes from the published timetable; the form only
 * says which class, which date and which credit.
 */
export async function bookClassWithCredit(formData: FormData): Promise<void> {
  const member = await requireMember();
  const slot = publishedClasses().find((c) => c.id === text(formData, "slot"));
  const date = text(formData, "date");
  const credit = text(formData, "credit");
  if (!slot || !isClassDate(date, slot, londonToday()) || !isUuid(credit)) redirect(`${back(formData)}?error=not_found`);
  const result = await bookWithClassCredit(member.db, {
    clientId: member.clientId,
    creditId: credit,
    slot: slot.id,
    date,
    startsAt: londonToUtc(date, slot.start),
    durationMinutes: slot.durationMinutes ?? 60,
    // One booking per credit: pressing twice books once.
    idempotencyKey: `account-credit/${credit}`,
  });
  if (!result.ok) redirect(`${back(formData)}?error=${errorFor(result)}`);
  // Confirmed at once: email the customer and Alex right away rather than at the next reconcile, but after the reply (best effort).
  after(async () => {
    await notifyClassBookings(member.db, publishedClasses()).catch(() => 0);
  });
  redirect(`${back(formData)}?done=booked_class_credit&at=${date}.${slot.id}`);
}

/** Signs this browser out, or every device (everywhere=yes). */
export async function signOutMember(formData: FormData): Promise<void> {
  const member = await requireMember();
  await signOut(member.db, member.sessionHash, text(formData, "everywhere") === "yes");
  const jar = await cookies();
  jar.delete({ name: MEMBER_SESSION_COOKIE, path: "/" });
  jar.delete({ name: MEMBER_SESSION_COOKIE, path: LEGACY_COOKIE_PATH });
  redirect(`${SIGN_IN_PATH}?signed=out`);
}

/** Opens Stripe's Direct Debit set-up page for the signed-in member (their next periods are collected from it). */
export async function setUpDirectDebit(): Promise<void> {
  const member = await requireMember();
  const stripe = stripeConfig();
  const overview = await memberOverview(member.db, member.clientId);
  if (!stripe || !overview.ok) redirect(`${ACCOUNT_PATH}/plan?error=direct_debit_unavailable`);
  const result = await startDirectDebitSetup(
    member.db,
    stripe,
    { clientId: member.clientId, email: overview.data.client.email, name: overview.data.client.name },
    `${memberLinkOrigin()}${ACCOUNT_PATH}/direct-debit?returned=1`,
    fetch,
    `${memberLinkOrigin()}${ACCOUNT_PATH}/plan`,
  );
  if (!result.ok) redirect(`${ACCOUNT_PATH}/plan?error=${result.reason === "already_set_up" ? "failed" : "direct_debit_unavailable"}`);
  redirect(result.url);
}

/** Opens Stripe's page where the signed-in member changes the card their renewals are charged to (nothing is charged there). */
export async function updateRenewalCard(): Promise<void> {
  const member = await requireMember();
  const stripe = stripeConfig();
  const overview = await memberOverview(member.db, member.clientId);
  const price = overview.ok ? overview.data.membership?.price_pence : undefined;
  if (!stripe || !overview.ok || !overview.data.client.email || !price) redirect(`${ACCOUNT_PATH}/plan?error=card_unavailable`);
  const result = await startCardUpdate(
    member.db,
    stripe,
    { clientId: member.clientId, email: overview.data.client.email, name: overview.data.client.name },
    price,
    `${memberLinkOrigin()}${ACCOUNT_PATH}/plan?done=card_updated`,
  );
  if (!result.ok) redirect(`${ACCOUNT_PATH}/plan?error=card_unavailable`);
  redirect(result.url);
}

/** Joins the waitlist of a full class, as themselves (owner, 2026-11-04). */
export async function joinWaitlist(formData: FormData): Promise<void> {
  const member = await requireMember();
  const slot = publishedClasses().find((c) => c.id === text(formData, "slot"));
  const date = text(formData, "date");
  if (!slot || !isClassDate(date, slot, londonToday())) redirect(`${back(formData)}?error=not_found`);
  const result = await joinWaitlistAsMember(member.db, member.clientId, slot.id, date);
  if (!result.ok) {
    const reason = waitlistReason(result.error);
    redirect(`${back(formData)}?error=${reason === "not_full" || reason === "waitlist_full" || reason === "already_booked" || reason === "class_started" || reason === "class_cancelled" ? reason : "failed"}`);
  }
  redirect(`${back(formData)}?done=waitlist_joined`);
}

/** Leaves a waitlist from the account. */
export async function leaveWaitlist(formData: FormData): Promise<void> {
  const member = await requireMember();
  const id = text(formData, "entry");
  if (!isUuid(id)) redirect(`${back(formData)}?error=not_found`);
  const result = await leaveWaitlistAsMember(member.db, member.clientId, id);
  if (!result.ok) redirect(`${back(formData)}?error=failed`);
  after(() => afterPlacesChange(member.db));
  redirect(`${back(formData)}?done=waitlist_left`);
}

/**
 * The member restarts the membership they cancelled, while the period they
 * paid for runs (owner, 2026-11-03): same plan, credits kept, nothing charged
 * now; it renews on the usual date. Member and Alex are told.
 */
export async function restartMembership(): Promise<void> {
  const member = await requireMember();
  const result = await restartOwnMembership(member.db, member.clientId);
  if (!result.ok) redirect(`${ACCOUNT_PATH}/plan?error=not_restartable`);
  after(async () => {
    try {
      const who = await whoIs(member);
      if (who) {
        const renews = result.renewsOn ? ` It renews on ${formatLongDate(result.renewsOn as DateKey)}.` : "";
        await sendNotice({
          label: "membership-restart",
          key: `membership-restart/${member.clientId}/${minute()}`,
          customer: { email: who.email, subject: "Your RAENG membership is back on", text: `Your membership is back on. Your credits are as they were.${renews} To stop it again, cancel from your account at any time.` },
          alex: { subject: `Membership restarted: ${who.name}`, text: `${who.name} (${who.email}) restarted the membership they had cancelled, from their account.${renews}` },
        });
      }
    } catch {
      console.error("Membership restart emails failed");
    }
  });
  redirect(`${ACCOUNT_PATH}/plan?done=membership_restarted`);
}

/**
 * The member pauses their membership (owner, 2026-11-04; the rules are in
 * migration 20261122000000): once, for one period, starting when the period
 * they are in ends, credits kept until then. Member and Alex are told.
 */
export async function pauseMembership(): Promise<void> {
  const member = await requireMember();
  const result = await pauseOwnMembership(member.db, member.clientId);
  if (!result.ok) redirect(`${ACCOUNT_PATH}/plan?error=${pauseErrorCode(result.error)}`);
  const { pause_from: from, pause_until: until } = result.data;
  after(async () => {
    try {
      const who = await whoIs(member);
      if (who) {
        const dates = `It starts on ${formatLongDate(from as DateKey)}, and your membership renews on ${formatLongDate(until as DateKey)}.`;
        await sendNotice({
          label: "membership-pause",
          key: `membership-pause/${member.clientId}/${from}`,
          customer: { email: who.email, subject: "Your RAENG membership will pause", text: `Your pause is booked. ${dates} Your credits stay usable until the end of your current period, and nothing is taken for the four weeks after it. Changed your mind? You can undo it from your account.` },
          alex: { subject: `Membership pause booked: ${who.name}`, text: `${who.name} (${who.email}) paused their membership from their account. ${dates}` },
        });
      }
    } catch {
      console.error("Membership pause emails failed");
    }
  });
  redirect(`${ACCOUNT_PATH}/plan?done=membership_paused`);
}

/** The member undoes a pause that hasn't begun, or ends one that is running (the membership restarts today). */
export async function endPause(): Promise<void> {
  const member = await requireMember();
  const result = await undoOwnPause(member.db, member.clientId);
  if (!result.ok) redirect(`${ACCOUNT_PATH}/plan?error=${pauseErrorCode(result.error)}`);
  const { renews_on: renews, began } = result.data;
  after(async () => {
    try {
      const who = await whoIs(member);
      if (who) {
        const when = formatLongDate(renews as DateKey);
        await sendNotice({
          label: "membership-pause-end",
          key: `membership-pause-end/${member.clientId}/${minute()}`,
          customer: {
            email: who.email,
            subject: began ? "Your RAENG membership is back on" : "Your RAENG pause is cancelled",
            text: began ? `Your pause has ended and your membership restarts today. Your next payment is taken as usual.` : `Your pause is cancelled and your membership carries on as normal. It renews on ${when}.`,
          },
          alex: { subject: `Membership pause ${began ? "ended early" : "cancelled"}: ${who.name}`, text: `${who.name} (${who.email}) ${began ? "ended their pause early; the membership restarts today" : "cancelled their pause before it began"}.` },
        });
      }
    } catch {
      console.error("Membership pause emails failed");
    }
  });
  redirect(`${ACCOUNT_PATH}/plan?done=${began ? "pause_ended" : "pause_undone"}`);
}

/** The member cancels their own membership: nothing more is taken; credits already given stay until the period ends. */
export async function cancelMembership(): Promise<void> {
  const member = await requireMember();
  const result = await cancelOwnMembership(member.db, member.clientId, londonToday());
  if (!result.ok) redirect(`${ACCOUNT_PATH}/plan?error=failed`);
  // The emails go after the reply, and the Direct Debit is cancelled with Stripe (owner, 2026-11-03; the daily job retries).
  after(async () => {
    const stripe = stripeConfig();
    if (stripe) await endUnusedDirectDebit(member.db, stripe, member.clientId).catch(() => undefined);
    try {
      const who = await whoIs(member);
      if (who) {
        const ends = result.endsOn ? ` Your credits stay usable until ${formatLongDate(result.endsOn as DateKey)}.` : "";
        await sendNotice({
          label: "membership-cancel",
          key: `membership-cancel/${member.clientId}/${minute()}`,
          customer: { email: who.email, subject: "Your RAENG membership is cancelled", text: `Your membership is cancelled and nothing more will be taken.${ends}` },
          alex: { subject: `Membership cancelled: ${who.name}`, text: `${who.name} (${who.email}) cancelled their own membership from their account.${ends}` },
        });
      }
    } catch {
      console.error("Membership cancellation emails failed");
    }
  });
  redirect(`${ACCOUNT_PATH}/plan?done=membership_cancelled`);
}

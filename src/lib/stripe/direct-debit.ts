import { randomUUID } from "node:crypto";
import { bookingDeliveryConfig } from "../booking-request";
import { rpc, select, update, type Db } from "../coach/db";
import { formatDate, type DateKey } from "../coach/time";
import type { Env } from "../env";
import { ACCOUNT_PATH, memberLinkOrigin } from "../member-auth";
import { formatPenceShort } from "../membership";
import { sendNotice } from "../notices";
import { sendEmail } from "../send-email";
import { createDirectDebitPayment, createDirectDebitSetupSession } from "./api";
import type { StripeConfig } from "./config";
import { ensureStripeCustomer, renewalConsent } from "./customer";
import { syncPaymentIntent } from "./sync";

/**
 * Renewals by saved card (owner, 2026-11-02, like Spotify): the first 4 weeks
 * are paid by card on Stripe's page, which keeps the card (the member agrees
 * there); each later 4 weeks is charged to it on the day the period starts,
 * until the member cancels. A failed charge is tried again 3 days and 7 days
 * later, then the membership pauses. Members are emailed 5 days before each
 * charge and when it is paid. Everything below about collections serves both
 * cards and Direct Debit; the member's method decides the timing.
 *
 * Memberships by Direct Debit (owner, 2026-10-30). The first 4 weeks are paid
 * by card on Stripe's page; the member then sets up a Bacs Direct Debit on
 * Stripe's page (their bank details never touch this site), and each later
 * 4 weeks is collected from it. Collections are submitted a few days before
 * the period starts because Bacs takes about three working days. Cancelling
 * stops all of it; credits already given stay usable until their period ends.
 * The database decides what is owed and when (20261105000000_akb_direct_debit.sql);
 * Stripe's signed webhook decides what was paid (sync.ts).
 */

/** Days ahead of a period's start that its collection is submitted. */
export const COLLECTION_LEAD_DAYS = 6;

export type SetupResult = { ok: true; url: string } | { ok: false; reason: "already_set_up" | "unavailable" };

type Member = { clientId: string; email: string; name: string };

async function openSetupPage(db: Db, stripe: StripeConfig, member: Member, returnUrl: string, method: "bacs_debit" | "card", fetchImpl: typeof fetch, consent?: string, cancelUrl?: string): Promise<SetupResult> {
  const customer = await ensureStripeCustomer(db, stripe, member, fetchImpl);
  if (!customer.ok) return { ok: false, reason: "unavailable" };
  const session = await createDirectDebitSetupSession(
    stripe,
    { idempotencyKey: `${method === "card" ? "card" : "dd"}-setup-${randomUUID()}`, customerId: customer.customerId, clientReference: member.clientId, successUrl: returnUrl, cancelUrl: cancelUrl ?? returnUrl, method, consent },
    fetchImpl,
  );
  if (!session.ok) {
    console.error(`Stripe: opening the ${method === "card" ? "card" : "Direct Debit"} set-up page failed (${session.status ?? "network"})`);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, url: session.data.url };
}

/** Opens Stripe's Direct Debit set-up page for a member who has paid their first period. */
export async function startDirectDebitSetup(db: Db, stripe: StripeConfig, member: Member, returnUrl: string, fetchImpl: typeof fetch = fetch, cancelUrl?: string): Promise<SetupResult> {
  const state = await rpc<{ status: string; method: string }>(db, "akb_payment_method_info", { p_client: member.clientId });
  if (state.ok && state.data.status === "active" && state.data.method === "bacs") return { ok: false, reason: "already_set_up" };
  return openSetupPage(db, stripe, member, returnUrl, "bacs_debit", fetchImpl, undefined, cancelUrl);
}

/**
 * Opens Stripe's page where a member saves the card their renewals are charged
 * to, or changes it (nothing is charged there). The page carries the same
 * agreement as the first payment: the amount, the rhythm and how to stop.
 */
export function startCardUpdate(db: Db, stripe: StripeConfig, member: Member, pricePence: number, returnUrl: string, fetchImpl: typeof fetch = fetch): Promise<SetupResult> {
  return openSetupPage(db, stripe, member, returnUrl, "card", fetchImpl, renewalConsent(pricePence));
}

interface DueRow {
  period_id: string;
  client_id: string;
  email: string;
  plan_name: string;
  outstanding_pence: number;
  customer_id: string;
  payment_method_id: string;
  environment: string;
  method: "bacs" | "card";
  attempts: number;
}

export interface CollectionSummary {
  ok: boolean;
  periodsCreated: number;
  submitted: number;
  failed: number;
}

/**
 * Daily: creates the next period early for members with a Direct Debit, then
 * submits each unpaid period's collection to Stripe (once per try: the
 * idempotency key names the period and try). Stripe's answer comes by webhook
 * days later. Stripe refusing outright (a cancelled mandate, say) counts as a
 * failed try, so the member is told and the membership pauses after three.
 */
export async function collectDirectDebits(db: Db, stripe: StripeConfig, today: DateKey, fetchImpl: typeof fetch = fetch): Promise<CollectionSummary> {
  const created = await rpc<number>(db, "akb_renew_dd_memberships", { p_today: today, p_lead_days: COLLECTION_LEAD_DAYS });
  if (!created.ok) return { ok: false, periodsCreated: 0, submitted: 0, failed: 0 };
  const due = await rpc<DueRow[]>(db, "akb_dd_due", { p_today: today, p_lead_days: COLLECTION_LEAD_DAYS, p_max: 3 });
  if (!due.ok) return { ok: false, periodsCreated: created.data, submitted: 0, failed: 0 };
  const summary: CollectionSummary = { ok: true, periodsCreated: created.data, submitted: 0, failed: 0 };
  for (const row of due.data) {
    if (row.environment !== stripe.environment) continue;
    const attempt = row.attempts + 1;
    const intent = await createDirectDebitPayment(
      stripe,
      {
        idempotencyKey: `dd-${row.period_id}-${attempt}`,
        customerId: row.customer_id,
        paymentMethodId: row.payment_method_id,
        amountPence: row.outstanding_pence,
        description: `RAENG ${row.plan_name} membership`,
        method: row.method === "card" ? "card" : "bacs_debit",
        metadata: { period: row.period_id },
      },
      fetchImpl,
    );
    if (intent.ok) {
      const noted = await rpc<null>(db, "akb_dd_record_attempt", { p_period: row.period_id, p_environment: stripe.environment, p_payment_intent: intent.data.id, p_today: today });
      if (!noted.ok) {
        summary.failed += 1;
        continue;
      }
      summary.submitted += 1;
      // A card answers at once and Stripe's webhook can arrive before the attempt above was noted (then it
      // finds no collection to record): so record it now. Idempotent with the webhook and the daily reconcile.
      if (intent.data.status === "succeeded") await syncPaymentIntent(db, stripe, intent.data.id, false, fetchImpl).catch(() => null);
      continue;
    }
    // A server or network error: nothing was submitted, so try again tomorrow. A refusal (4xx) is a failed try.
    if (intent.status === null || intent.status >= 500) {
      summary.failed += 1;
      continue;
    }
    const refused = `refused-${row.period_id}-${attempt}`;
    await rpc<null>(db, "akb_dd_record_attempt", { p_period: row.period_id, p_environment: stripe.environment, p_payment_intent: refused, p_today: today });
    await rpc<string>(db, "akb_dd_mark", { p_payment_intent: refused, p_status: "failed" });
    console.error(`Stripe: a ${row.method === "card" ? "card" : "Direct Debit"} collection was refused (${intent.status})`);
    summary.failed += 1;
  }
  if (summary.failed) console.error(`Direct Debit collections: ${summary.failed} of ${due.data.length} couldn't be submitted`);
  return summary;
}

interface FailedRow {
  period_id: string;
  client_id: string;
  paused: boolean;
  attempts: number;
}

/** Retry gaps (days after the failed try): a card is tried again 3 days later, then 4 days after that (day 3, day 7). */
const nextTry = (attempts: number) => (attempts >= 2 ? "in 4 days" : "in 3 days");

/**
 * Tells a member (and Alex, once the membership is paused) when a renewal
 * payment failed. Once per failure; without email settings nothing is marked,
 * so it is tried again. A card member is told how to fix it: change the card
 * (or pay the amount) from their account before the next try.
 */
export async function notifyDirectDebitFailures(db: Db, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const email = bookingDeliveryConfig(env);
  if (!email) return 0;
  const rows = await select<FailedRow>(db, "akb_dd_collections", [["select", "period_id,client_id,paused,attempts"], ["status", "eq.failed"], ["notified_at", "is.null"], ["limit", "50"]]);
  if (!rows.ok) return 0;
  let sent = 0;
  for (const r of rows.data) {
    const info = await select<{ email: string; full_name: string }>(db, "akb_clients", [["select", "email,full_name"], ["id", `eq.${r.client_id}`]]);
    const person = info.ok ? info.data[0] : undefined;
    const period = await select<{ period_start: string; period_end: string; charge_id: string }>(db, "akb_membership_periods", [["select", "period_start,period_end,charge_id"], ["id", `eq.${r.period_id}`]]);
    const p = period.ok ? period.data[0] : undefined;
    if (!person || !p) continue;
    const balance = await select<{ outstanding_pence: number }>(db, "akb_charge_balances", [["select", "outstanding_pence"], ["id", `eq.${p.charge_id}`]]);
    const owed = balance.ok && balance.data[0] ? formatPenceShort(balance.data[0].outstanding_pence) : "your membership payment";
    const account = `${memberLinkOrigin(env)}${ACCOUNT_PATH}`;
    const how = await rpc<{ method: string; label: string }>(db, "akb_payment_method_info", { p_client: r.client_id });
    const card = how.ok && how.data.method === "card";
    const mailed = await sendEmail(
      email,
      {
        idempotencyKey: `dd-failed/${r.period_id}/${r.attempts}`,
        to: person.email,
        replyTo: email.to,
        subject: r.paused ? "Your RAENG membership is paused" : card ? "Your RAENG membership payment didn't go through" : "Your RAENG Direct Debit payment didn't go through",
        text: [
          `We couldn't take ${owed} ${card ? `from your card${how.ok && how.data.label ? ` (${how.data.label})` : ""}` : "by Direct Debit"} for your membership period ${formatDate(p.period_start as DateKey)} to ${formatDate(p.period_end as DateKey)}.`,
          "",
          r.paused
            ? "We've tried three times, so your membership is paused and no more payments will be taken. Reply to this email and we'll sort it out together."
            : card
              ? `We'll try again ${nextTry(r.attempts)}. To fix it now, pay the amount from your account: paying there also saves the new card for your next renewals. Your bank may also need you to confirm the payment.`
              : "We'll try again in a few days. Please make sure the money is in your account. If it keeps failing, your membership will be paused.",
          "",
          `Your account: ${account}`,
        ].join("\n"),
      },
      fetchImpl,
    );
    if (!mailed.ok) continue;
    if (r.paused) {
      await sendEmail(
        email,
        { idempotencyKey: `dd-paused-alex/${r.period_id}`, replyTo: person.email, subject: `Membership paused: ${person.full_name}`, text: `${person.full_name} (${person.email}) has had three failed ${card ? "card" : "Direct Debit"} payments, so their membership is paused.` },
        fetchImpl,
      );
    }
    const marked = await update(db, "akb_dd_collections", [["period_id", `eq.${r.period_id}`]], { notified_at: new Date().toISOString() });
    if (marked.ok) sent += 1;
  }
  return sent;
}

interface ReminderRow {
  client_id: string;
  email: string;
  full_name: string;
  plan_name: string;
  price_pence: number;
  renews_on: string;
  card_label: string;
  environment: string;
}

/** How many days before a renewal the member is reminded. */
export const REMINDER_DAYS = 5;

/**
 * "Your membership renews on …" for card members, REMINDER_DAYS ahead, once per
 * renewal date. Marked only once the email went out, so a failure is tried again
 * the next day (the renewal is still ahead). Without email settings nothing is sent.
 */
export async function sendRenewalReminders(db: Db, stripe: StripeConfig, today: DateKey, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const email = bookingDeliveryConfig(env);
  if (!email) return 0;
  const due = await rpc<ReminderRow[]>(db, "akb_renewal_reminders_due", { p_today: today, p_days: REMINDER_DAYS });
  if (!due.ok) return 0;
  let sent = 0;
  for (const r of due.data) {
    if (r.environment !== stripe.environment) continue;
    const mailed = await sendEmail(
      email,
      {
        idempotencyKey: `renewal-reminder/${r.client_id}/${r.renews_on}`,
        to: r.email,
        replyTo: email.to,
        subject: `Your RAENG membership renews on ${formatDate(r.renews_on as DateKey)}`,
        text: [
          `Your ${r.plan_name} membership renews on ${formatDate(r.renews_on as DateKey)}. ${formatPenceShort(r.price_pence)} will be charged to your ${r.card_label || "card"} that day, and your new credits will be ready.`,
          "",
          "There's nothing you need to do. To stop your membership, cancel before then from your account. You keep the credits you've already paid for until the end of the period.",
          "",
          `Your account: ${memberLinkOrigin(env)}${ACCOUNT_PATH}/plan`,
          "",
          "Questions? Just reply to this email.",
        ].join("\n"),
      },
      fetchImpl,
    );
    if (!mailed.ok) continue;
    const marked = await rpc<null>(db, "akb_renewal_reminder_sent", { p_client: r.client_id, p_for: r.renews_on });
    if (marked.ok) sent += 1;
  }
  return sent;
}

interface PaidRow {
  period_id: string;
  client_id: string;
}

/**
 * Tells the member (and Alex) a renewal has been paid, once each: "Your
 * membership has renewed". Marked only when every email that could go did.
 */
export async function notifyRenewalPayments(db: Db, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!bookingDeliveryConfig(env)) return 0;
  const rows = await select<PaidRow>(db, "akb_dd_collections", [["select", "period_id,client_id"], ["status", "eq.succeeded"], ["paid_notified_at", "is.null"], ["limit", "50"]]);
  if (!rows.ok) return 0;
  let sent = 0;
  for (const r of rows.data) {
    const people = await select<{ email: string; full_name: string }>(db, "akb_clients", [["select", "email,full_name"], ["id", `eq.${r.client_id}`]]);
    const periods = await select<{ period_start: string; period_end: string; membership_id: string; credits: number }>(db, "akb_membership_periods", [["select", "period_start,period_end,membership_id,credits"], ["id", `eq.${r.period_id}`]]);
    const person = people.ok ? people.data[0] : undefined;
    const p = periods.ok ? periods.data[0] : undefined;
    if (!person || !p) continue;
    const memberships = await select<{ plan_name: string; price_pence: number; status: string; next_period_on: string | null }>(db, "akb_memberships", [["select", "plan_name,price_pence,status,next_period_on"], ["id", `eq.${p.membership_id}`]]);
    const m = memberships.ok ? memberships.data[0] : undefined;
    if (!m) continue;
    const how = await rpc<{ method: string; label: string }>(db, "akb_payment_method_info", { p_client: r.client_id });
    const via = how.ok && how.data.method === "card" ? `your ${how.data.label || "card"}` : "Direct Debit";
    const next = m.status === "active" && m.next_period_on ? ` Your next renewal is ${formatDate(m.next_period_on as DateKey)}.` : "";
    const result = await sendNotice(
      {
        label: "membership-renewed",
        key: `membership-renewed/${r.period_id}`,
        customer: person.email
          ? {
              email: person.email,
              subject: `Your RAENG membership has renewed`,
              text: `Thanks. We've taken ${formatPenceShort(m.price_pence)} from ${via} and your ${m.plan_name} membership has renewed for ${formatDate(p.period_start as DateKey)} to ${formatDate(p.period_end as DateKey)}. Your ${p.credits} credits are ready.${next}\n\nYour account: ${memberLinkOrigin(env)}${ACCOUNT_PATH}/plan`,
            }
          : undefined,
        alex: {
          subject: `Membership renewed: ${person.full_name}`,
          text: `${person.full_name}${person.email ? ` (${person.email})` : ""} renewed their ${m.plan_name} membership (${formatPenceShort(m.price_pence)}, ${formatDate(p.period_start as DateKey)} to ${formatDate(p.period_end as DateKey)}).`,
          replyTo: person.email || undefined,
        },
      },
      env,
      fetchImpl,
    );
    if ((result.customer || !person.email) && result.alex) {
      const marked = await update(db, "akb_dd_collections", [["period_id", `eq.${r.period_id}`]], { paid_notified_at: new Date().toISOString() });
      if (marked.ok) sent += 1;
    }
  }
  return sent;
}

export type DirectDebitState = "none" | "pending" | "active" | "ended";

/** Whether the member has a Direct Debit set up (for their account page). */
export async function directDebitState(db: Db, clientId: string): Promise<DirectDebitState> {
  const state = await rpc<DirectDebitState>(db, "akb_dd_state", { p_client: clientId });
  return state.ok ? state.data : "none";
}

export interface PaymentMethodInfo {
  /** "none": nothing on file; "pending": a customer exists but no method yet; "active": a method is on file. */
  status: DirectDebitState;
  /** "card" or "bacs" (empty when none). */
  method: "" | "card" | "bacs";
  /** For a card, e.g. "Visa ending 4242". */
  label: string;
}

/** The method the member's renewals are paid with (for their plan page). */
export async function paymentMethodInfo(db: Db, clientId: string): Promise<PaymentMethodInfo> {
  const info = await rpc<PaymentMethodInfo>(db, "akb_payment_method_info", { p_client: clientId });
  return info.ok ? info.data : { status: "none", method: "", label: "" };
}

/**
 * The member cancels their own membership: no new periods and no more
 * collections (the database stops both), and the credits already given stay
 * usable until their period ends. Returns the membership's last day.
 */
export async function cancelOwnMembership(db: Db, clientId: string, today: DateKey): Promise<{ ok: true; endsOn: string | null } | { ok: false }> {
  const rows = await select<{ id: string }>(db, "akb_memberships", [["select", "id"], ["client_id", `eq.${clientId}`], ["status", "in.(active,paused)"], ["order", "created_at.desc"], ["limit", "1"]]);
  const membership = rows.ok ? rows.data[0] : undefined;
  if (!membership) return { ok: false };
  const done = await rpc<null>(db, "akb_set_membership_status", { p_membership: membership.id, p_status: "cancelled", p_on: today });
  if (!done.ok) return { ok: false };
  const period = await select<{ period_end: string }>(db, "akb_membership_periods", [["select", "period_end"], ["membership_id", `eq.${membership.id}`], ["order", "period_end.desc"], ["limit", "1"]]);
  return { ok: true, endsOn: period.ok ? (period.data[0]?.period_end ?? null) : null };
}

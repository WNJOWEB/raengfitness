import { membershipPlans, BILLING_WEEKS } from "@/content/memberships";
import { bookingMode } from "./booking";
import { bookingDeliveryConfig } from "./booking-request";
import type { PublishedClass } from "./class-sessions";
import { coachDb, inList, rpc, select, update, type Db, type DbError } from "./coach/db";
import { formatDate, londonToUtc, type DateKey } from "./coach/time";
import type { Env } from "./env";
import { ACCOUNT_PATH, SIGN_IN_PATH, memberLinkOrigin } from "./member-auth";
import { formatPenceShort } from "./membership";
import { describeFirstClass, type MembershipRequest } from "./membership-request";
import { sendEmail } from "./send-email";
import { directDebitEnabled, stripeConfig, type StripeConfig } from "./stripe/config";
import { startDirectDebitSetup } from "./stripe/direct-debit";
import { createChargeLink } from "./stripe/sync";

/**
 * Joining a membership and paying online, with nothing for Alex to confirm
 * (owner, 2026-10-26). The database decides everything that matters
 * (supabase/migrations/20261028000000_akb_self_serve_memberships.sql): the
 * membership only starts when a payment is recorded against the first
 * charge, and a payment is only recorded after Stripe's webhook has been
 * verified and the payment re-read from Stripe. Nothing here ever trusts the
 * browser about payment.
 */

export const JOIN_DONE_PATH = "/memberships/join/done";

/**
 * Online joining is on only where a real Stripe checkout can open: booking
 * requests on, the database reachable, and Stripe configured for this
 * deployment (live Stripe only on Vercel production; previews share the live
 * database, so they never qualify). Otherwise joining stays a request to Alex.
 */
export function onlineJoinEnabled(env: Env = process.env): boolean {
  return bookingMode(env) === "request" && coachDb(env) !== null && stripeConfig(env) !== null;
}

export type CheckoutResult =
  | { ok: true; url: string; signupId: string }
  | { ok: false; reason: "already_member" | "payment_in_progress" | "unavailable" };

interface SignupCreated {
  signup_id: string;
  charge_id: string;
  status: string;
}

/**
 * Creates (or, for the same submission, finds) the sign-up and its first
 * charge, then the Stripe payment link for that charge. The plan's price and
 * credits come from content, never from the form.
 */
export async function startCheckout(
  db: Db,
  stripe: StripeConfig,
  data: MembershipRequest,
  firstClass: PublishedClass | null,
  options: { agreedAt: string; idempotencyKey: string; env?: Env; fetchImpl?: typeof fetch },
): Promise<CheckoutResult> {
  const plan = membershipPlans.find((p) => p.id === data.plan);
  if (!plan) return { ok: false, reason: "unavailable" };
  const withClass = Boolean(firstClass && data.classDate);
  const created = await rpc<SignupCreated>(db, "akb_create_membership_signup", {
    p_name: data.name,
    p_email: data.email,
    p_phone: data.phone,
    p_plan: plan.id,
    p_plan_name: plan.name,
    p_price_pence: plan.priceGbp * 100,
    p_credits: plan.credits,
    p_class_slot: withClass ? firstClass!.id : null,
    p_class_date: withClass ? data.classDate : null,
    p_class_starts_at: withClass ? londonToUtc(data.classDate as DateKey, firstClass!.start) : null,
    p_class_duration: withClass ? (firstClass!.durationMinutes ?? 60) : null,
    p_terms_agreed_at: options.agreedAt,
    p_idempotency_key: options.idempotencyKey,
  });
  if (!created.ok) return { ok: false, reason: ruleReason(created.error) };
  const signupId = created.data.signup_id;
  // The payment also keeps the member's card for the renewals (they agree to that on Stripe's page).
  const clientId = await signupClient(db, signupId);
  const link = await createChargeLink(db, stripe, created.data.charge_id, options.fetchImpl, {
    buyerEmail: data.email,
    redirectUrl: `${memberLinkOrigin(options.env)}${JOIN_DONE_PATH}?signup=${signupId}`,
    renewal: clientId ? { clientId, email: data.email, name: data.name } : undefined,
  });
  if (!link.ok) return { ok: false, reason: "unavailable" };
  return { ok: true, url: link.url, signupId };
}

async function signupClient(db: Db, signupId: string): Promise<string | null> {
  const rows = await select<{ client_id: string }>(db, "akb_membership_signups", [["select", "client_id"], ["id", `eq.${signupId}`]]);
  return rows.ok ? (rows.data[0]?.client_id ?? null) : null;
}

function ruleReason(error: DbError): "already_member" | "payment_in_progress" | "unavailable" {
  if (error.kind === "rule" && (error.rule === "already_member" || error.rule === "payment_in_progress")) return error.rule;
  console.error(`Online membership sign-up failed (${error.kind} ${error.code})`);
  return "unavailable";
}

export interface SignupStatus {
  status: "awaiting_payment" | "active" | "replaced" | "needs_attention";
  plan_name: string;
  first_class: "none" | "requested" | "booked" | "unavailable";
  class_date: string | null;
  /** The open Stripe link, while it's still waiting for payment. */
  payUrl: string | null;
  /** The member's Direct Debit: "none" until they set it up on Stripe's page. */
  dd: "none" | "pending" | "active" | "ended";
  /** The card their renewals are charged to (e.g. "Visa ending 4242"), once saved; empty otherwise. */
  card: string;
  /** What the confirmation screen lists (the plan's price in pence, its credits, the next renewal date). */
  price_pence: number;
  credits: number;
  next_renewal: string | null;
}

/** The member behind an active sign-up, for opening their Direct Debit set-up. */
export async function signupMember(db: Db, signupId: string): Promise<{ clientId: string; email: string; name: string } | null> {
  const rows = await select<{ client_id: string; status: string }>(db, "akb_membership_signups", [["select", "client_id,status"], ["id", `eq.${signupId}`]]);
  const row = rows.ok ? rows.data[0] : undefined;
  if (!row || row.status !== "active") return null;
  const people = await select<{ email: string; full_name: string }>(db, "akb_clients", [["select", "email,full_name"], ["id", `eq.${row.client_id}`]]);
  const person = people.ok ? people.data[0] : undefined;
  return person ? { clientId: row.client_id, email: person.email, name: person.full_name } : null;
}

/** The page that opens a paid sign-up's Direct Debit set-up on Stripe (the done page forwards there a few seconds after paying). */
export const SIGNUP_DD_PATH = "/memberships/join/direct-debit";

/**
 * Opens Stripe's Direct Debit page for a paid sign-up and says where to go:
 * Stripe's page, or back to the done page with a reason. Leaving Stripe's page
 * without finishing lands on the done page marked "skipped", so the member is
 * not sent straight back. The id is only a pointer: the member and their
 * details come from the database, and only an active (paid) sign-up qualifies.
 */
export async function beginSignupDirectDebit(db: Db | null, stripe: StripeConfig | null, signupId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<{ url: string; external: boolean }> {
  const back = `${memberLinkOrigin(env)}${JOIN_DONE_PATH}?signup=${signupId}`;
  if (!db || !stripe || !directDebitEnabled(env)) return { url: `${back}&dd=unavailable`, external: false };
  const member = await signupMember(db, signupId);
  if (!member) return { url: `${back}&dd=unavailable`, external: false };
  // Coming back from the bank page ("returned") shows the confirming screen until Stripe's word is in; leaving it unfinished is "skipped".
  const result = await startDirectDebitSetup(db, stripe, member, `${back}&dd=returned`, fetchImpl, `${back}&dd=skipped`);
  if (result.ok) return { url: result.url, external: true };
  return { url: `${back}&dd=${result.reason === "already_set_up" ? "done" : "unavailable"}`, external: false };
}

/** What the "after paying" page shows. Only the plan and the state: no personal details. */
export async function signupStatus(db: Db, signupId: string): Promise<SignupStatus | null> {
  const rows = await select<{ status: SignupStatus["status"]; plan_name: string; first_class: SignupStatus["first_class"]; class_date: string | null; charge_id: string; client_id: string; price_pence: number; credits: number; membership_id: string | null }>(
    db,
    "akb_membership_signups",
    [["select", "status,plan_name,first_class,class_date,charge_id,client_id,price_pence,credits,membership_id"], ["id", `eq.${signupId}`]],
  );
  const row = rows.ok ? rows.data[0] : undefined;
  if (!row) return null;
  let payUrl: string | null = null;
  if (row.status === "awaiting_payment") {
    const links = await select<{ url: string }>(db, "akb_square_payment_links", [["select", "url"], ["charge_id", `eq.${row.charge_id}`], ["status", "eq.open"]]);
    payUrl = links.ok ? (links.data[0]?.url ?? null) : null;
  }
  const how = await rpc<{ status: SignupStatus["dd"]; method: string; label: string }>(db, "akb_payment_method_info", { p_client: row.client_id });
  const bacs = how.ok && how.data.method === "bacs" && how.data.status === "active";
  const card = how.ok && how.data.method === "card" && how.data.status === "active" ? how.data.label || "your card" : "";
  let nextRenewal: string | null = null;
  if (row.membership_id) {
    const m = await select<{ next_period_on: string; status: string }>(db, "akb_memberships", [["select", "next_period_on,status"], ["id", `eq.${row.membership_id}`]]);
    nextRenewal = m.ok && m.data[0]?.status === "active" ? m.data[0].next_period_on : null;
  }
  return { status: row.status, plan_name: row.plan_name, first_class: row.first_class, class_date: row.class_date, payUrl, dd: bacs ? "active" : "none", card, price_pence: row.price_pence, credits: row.credits, next_renewal: nextRenewal };
}

interface ActivatedSignup {
  id: string;
  status: "active" | "needs_attention";
  plan_name: string;
  price_pence: number;
  first_class: SignupStatus["first_class"];
  class_date: string | null;
  class_slot: string | null;
  client_id: string;
}

/**
 * Once a sign-up's payment is in (webhook, reconcile or the portal), emails
 * Alex and the new member, once each sign-up. Best effort: without email
 * settings nothing is marked, so it's tried again on the next payment or run.
 */
export async function notifyNewMembers(db: Db, classes: PublishedClass[], env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const email = bookingDeliveryConfig(env);
  if (!email) return 0;
  const rows = await select<ActivatedSignup>(db, "akb_membership_signups", [
    ["select", "id,status,plan_name,price_pence,first_class,class_date,class_slot,client_id"],
    ["status", "in.(active,needs_attention)"],
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
    const client = people.data.find((p) => p.id === row.client_id);
    if (!client) continue;
    const s = { ...row, client };
    const how = await rpc<{ status: string; method: string; label: string }>(db, "akb_payment_method_info", { p_client: row.client_id });
    const renewalLine =
      how.ok && how.data.status === "active" && how.data.method === "card"
        ? `Your membership renews automatically every ${BILLING_WEEKS} weeks until you cancel: ${formatPenceShort(s.price_pence)} is charged to your ${how.data.label || "card"} on each renewal date. We'll email you 5 days before each payment. To stop it, cancel from your account at any time.${directDebitEnabled(env) ? `\n\nPrefer a Direct Debit? Set it up from your account and renewals are collected from your bank instead: ${memberLinkOrigin(env)}${ACCOUNT_PATH}/plan` : ""}`
        : `Your membership renews every ${BILLING_WEEKS} weeks; you'll get a payment link by email each time.`;
    const slot = classes.find((c) => c.id === s.class_slot);
    const firstClass = s.class_date && slot ? describeFirstClass({ session: slot.label, classDate: s.class_date }) : null;
    const toAlex = await sendEmail(
      email,
      {
        idempotencyKey: `membership-signup/${s.id}/coach`,
        replyTo: s.client.email,
        subject: s.status === "active" ? `New member: ${s.client.full_name} (${s.plan_name}, paid online)` : `Paid online, needs you: ${s.client.full_name}`,
        text: [
          s.status === "active"
            ? `${s.client.full_name} joined the ${s.plan_name} membership and paid ${formatPenceShort(s.price_pence)} online. Their membership has started; nothing to confirm.`
            : `${s.client.full_name} paid ${formatPenceShort(s.price_pence)} online for the ${s.plan_name} membership, but it couldn't start automatically (they may already have one). The payment is recorded; please set it up in the coach area.`,
          "",
          `Email: ${s.client.email}`,
          s.client.phone ? `Phone: ${s.client.phone}` : null,
          firstClass ? `First class: ${firstClass} (${s.first_class === "booked" ? "booked with a credit" : "couldn't be booked; they'll book another"})` : "First class: they'll book from their account",
        ]
          .filter((l) => l !== null)
          .join("\n"),
      },
      fetchImpl,
    );
    if (!toAlex.ok) continue;
    if (s.status === "active") {
      await sendEmail(
        email,
        {
          idempotencyKey: `membership-signup/${s.id}/member`,
          to: s.client.email,
          replyTo: email.to,
          subject: `Welcome to RAENG: your ${s.plan_name} membership has started`,
          text: [
            `Thanks for joining. Your payment went through and your ${s.plan_name} membership has started.`,
            "",
            firstClass
              ? s.first_class === "booked"
                ? `Your first class is booked: ${firstClass}.`
                : `${firstClass} couldn't be booked (it may have filled up), so please book another class from your account.`
              : "Book your classes from your account.",
            "",
            `Sign in with your email: ${memberLinkOrigin(env)}${SIGN_IN_PATH}`,
            renewalLine,
          ].join("\n"),
        },
        fetchImpl,
      );
    }
    const marked = await update(db, "akb_membership_signups", [["id", `eq.${s.id}`], ["notified_at", "is.null"]], { notified_at: new Date().toISOString() });
    if (marked.ok) sent += 1;
  }
  return sent;
}

interface UnpaidPeriod {
  period_id: string;
  charge_id: string;
  client_id: string;
  full_name: string;
  email: string;
  plan_name: string;
  period_start: string;
  period_end: string;
  outstanding_pence: number;
}

/**
 * Renewals for members who pay online: each new period's charge gets a
 * Stripe link, emailed to the member once. Their credits for the period wait
 * until it's paid. Needs Stripe and email; marks a period only once its
 * email went out, so a failure is retried on the next daily run.
 */
export async function sendRenewalLinks(db: Db, stripe: StripeConfig, today: DateKey, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; failed: number }> {
  const email = bookingDeliveryConfig(env);
  if (!email) return { sent: 0, failed: 0 };
  const due = await rpc<UnpaidPeriod[]>(db, "akb_unpaid_online_periods", { p_today: today });
  if (!due.ok) return { sent: 0, failed: 1 };
  let sent = 0;
  let failed = 0;
  for (const p of due.data) {
    const link = await createChargeLink(db, stripe, p.charge_id, fetchImpl, {
      buyerEmail: p.email,
      redirectUrl: `${memberLinkOrigin(env)}${ACCOUNT_PATH}`,
      renewal: { clientId: p.client_id, email: p.email, name: p.full_name },
    });
    if (!link.ok) {
      failed += 1;
      continue;
    }
    const mailed = await sendEmail(
      email,
      {
        idempotencyKey: `membership-renewal/${p.period_id}`,
        to: p.email,
        replyTo: email.to,
        subject: `Your RAENG ${p.plan_name} membership has renewed`,
        text: [
          `Your ${p.plan_name} membership has renewed for ${formatDate(p.period_start as DateKey)} to ${formatDate(p.period_end as DateKey)}.`,
          "",
          `Pay ${formatPenceShort(link.amountPence)} securely with Stripe to use this period's credits:`,
          link.url,
          "",
          "Paying this way also saves your card, so your membership renews automatically every 4 weeks from now on. We email you 5 days before each payment, and you can cancel any time from your account.",
        ].join("\n"),
      },
      fetchImpl,
    );
    if (!mailed.ok) {
      failed += 1;
      continue;
    }
    const marked = await update(db, "akb_membership_periods", [["id", `eq.${p.period_id}`]], { pay_link_sent_at: new Date().toISOString() });
    if (marked.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** A member's current period still to pay (pay-online members only), with a link to pay it. */
export async function paymentDue(db: Db, stripe: StripeConfig | null, clientId: string, env: Env = process.env): Promise<{ amountPence: number; url: string | null; periodEnd: string; direct: boolean } | null> {
  const due = await rpc<{ charge_id: string; outstanding_pence: number; period_end: string } | null>(db, "akb_member_payment_due", { p_client: clientId });
  if (!due.ok || !due.data) return null;
  let url: string | null = null;
  let direct = false;
  if (stripe) {
    const people = await select<{ email: string; full_name: string }>(db, "akb_clients", [["select", "email,full_name"], ["id", `eq.${clientId}`]]);
    const person = people.ok ? people.data[0] : undefined;
    const link = await createChargeLink(db, stripe, due.data.charge_id, fetch, {
      redirectUrl: `${memberLinkOrigin(env)}${ACCOUNT_PATH}`,
      renewal: person ? { clientId, email: person.email, name: person.full_name } : undefined,
    });
    url = link.ok ? link.url : null;
    // Being collected by Direct Debit: nothing for the member to pay.
    direct = !link.ok && link.reason === "direct-debit";
  }
  return { amountPence: due.data.outstanding_pence, url, periodEnd: due.data.period_end, direct };
}

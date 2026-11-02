import { insert, rpc, select, update, type Db, type DbError } from "../coach/db";
import { memberLinkOrigin } from "../member-auth";
import { toLondon } from "../coach/time";
import { createPaymentSession, getCheckoutSession, getPaymentIntent, getRefund, getSetupIntent, listRefundsForPaymentIntent, listSessionsForPaymentIntent, type CheckoutSession, type StripeRefund, type StripeResult } from "./api";
import type { StripeConfig, StripeWebhookConfig } from "./config";
import { verifyStripeSignature } from "./signature";

/**
 * Keeps Supabase in step with Stripe. Stripe is the source of truth for
 * payments: a webhook only says "something changed"; the checkout session or
 * refund is then re-read from Stripe's API and applied by one idempotent
 * database function (supabase/migrations/20261021000000_akb_square.sql, whose
 * table and function names predate Stripe: they now hold Stripe's ids, with a
 * checkout session id where a Square order id used to be). Logs carry ids,
 * types, outcomes and status codes only.
 */

type Outcome = "recorded" | "duplicate" | "unknown_order" | "unknown_payment" | "pending" | "not_paid" | "not_refunded" | "ignored" | "active" | "unknown_client" | "mismatch" | "succeeded" | "failed" | "paused" | "unknown_collection";
export type SyncResult = { ok: true; outcome: Outcome } | { ok: false; reason: string };

const stripeFailure = (what: string, r: StripeResult<unknown>): SyncResult => ({ ok: false, reason: `stripe-${what}-${r.ok ? "ok" : (r.status ?? "network")}` });
const dbFailure = (e: DbError): SyncResult => ({ ok: false, reason: `db-${e.kind}${e.rule ? `-${e.rule}` : ""}` });

/** Re-reads one checkout session from Stripe and records its payment if it was paid against one of our links. */
export async function syncCheckoutSession(db: Db, stripe: StripeConfig, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const found = await getCheckoutSession(stripe, sessionId, fetchImpl);
  if (!found.ok) return stripeFailure("session", found);
  const c = found.data;
  if (c.mode === "setup") return syncSetupSession(db, stripe, c, fetchImpl);
  if (c.mode !== "payment") return { ok: true, outcome: "ignored" };
  // Square's statuses are what the database function understands: paid is COMPLETED, an expired unpaid session CANCELED.
  const status = c.paymentStatus === "paid" ? "COMPLETED" : c.status === "expired" ? "CANCELED" : "PENDING";
  const result = await rpc<Outcome>(db, "akb_apply_square_payment", {
    p_environment: stripe.environment,
    p_payment_id: c.paymentIntentId ?? c.id,
    p_order_id: c.id,
    p_status: status,
    p_amount_pence: c.amountPence,
    p_currency: c.currency,
    p_paid_on: toLondon(c.createdAt).date,
  });
  if (result.ok && result.data === "not_paid") {
    // An expired or cancelled session closes its link, so the next attempt makes a fresh one.
    await update(db, "akb_square_payment_links", [["square_order_id", `eq.${c.id}`], ["status", "eq.open"]], { status: "cancelled" });
  }
  return result.ok ? { ok: true, outcome: result.data } : dbFailure(result.error);
}

/** A Direct Debit set-up page finished: record the member's method and mandate. */
async function syncSetupSession(db: Db, stripe: StripeConfig, session: CheckoutSession, fetchImpl: typeof fetch): Promise<SyncResult> {
  if (session.status !== "complete" || !session.setupIntentId || !session.clientReference) return { ok: true, outcome: "pending" };
  const intent = await getSetupIntent(stripe, session.setupIntentId, fetchImpl);
  if (!intent.ok) return stripeFailure("setup", intent);
  const i = intent.data;
  if (i.status !== "succeeded" || !i.paymentMethodId) return { ok: true, outcome: "pending" };
  const result = await rpc<Outcome>(db, "akb_dd_set_method", {
    p_client: session.clientReference,
    p_environment: stripe.environment,
    p_customer: i.customerId ?? session.customerId,
    p_method: i.paymentMethodId,
    p_mandate: i.mandateId ?? "",
  });
  return result.ok ? { ok: true, outcome: result.data } : dbFailure(result.error);
}

/**
 * A Direct Debit collection ended. Succeeded: the payment is re-read from
 * Stripe and recorded against the period's charge (through its link row), then
 * the collection is marked. Failed: the collection is marked, and a third
 * failure pauses the membership. Payment intents that aren't collections (a
 * card checkout's own) are ignored by the database.
 */
async function syncPaymentIntent(db: Db, stripe: StripeConfig, paymentIntentId: string, failed: boolean, fetchImpl: typeof fetch): Promise<SyncResult> {
  if (failed) {
    const marked = await rpc<Outcome>(db, "akb_dd_mark", { p_payment_intent: paymentIntentId, p_status: "failed" });
    return marked.ok ? { ok: true, outcome: marked.data } : dbFailure(marked.error);
  }
  const found = await getPaymentIntent(stripe, paymentIntentId, fetchImpl);
  if (!found.ok) return stripeFailure("intent", found);
  const p = found.data;
  if (p.status !== "succeeded") return { ok: true, outcome: "pending" };
  const applied = await rpc<Outcome>(db, "akb_apply_square_payment", {
    p_environment: stripe.environment,
    p_payment_id: p.id,
    p_order_id: p.id,
    p_status: "COMPLETED",
    p_amount_pence: p.amountPence,
    p_currency: p.currency,
    p_paid_on: toLondon(p.createdAt).date,
  });
  if (!applied.ok) return dbFailure(applied.error);
  if (applied.data === "recorded" || applied.data === "duplicate") await rpc<Outcome>(db, "akb_dd_mark", { p_payment_intent: p.id, p_status: "succeeded" });
  return { ok: true, outcome: applied.data };
}

/** Applies one Stripe refund; its payment is synced first, so order of arrival doesn't matter. */
async function applyRefund(db: Db, stripe: StripeConfig, r: StripeRefund, fetchImpl: typeof fetch): Promise<SyncResult> {
  const sessions = await listSessionsForPaymentIntent(stripe, r.paymentIntentId, fetchImpl);
  if (!sessions.ok) return stripeFailure("sessions", sessions);
  // A card checkout's payment is synced first; a Direct Debit payment has no session and is already recorded.
  for (const session of sessions.data) {
    const payment = await syncCheckoutSession(db, stripe, session.id, fetchImpl);
    if (!payment.ok) return payment;
  }
  const status = r.status === "succeeded" ? "COMPLETED" : r.status === "failed" || r.status === "canceled" ? "FAILED" : "PENDING";
  const result = await rpc<Outcome>(db, "akb_apply_square_refund", {
    p_environment: stripe.environment,
    p_refund_id: r.id,
    p_payment_id: r.paymentIntentId,
    p_status: status,
    p_amount_pence: r.amountPence,
    p_currency: r.currency,
    p_refunded_on: toLondon(r.createdAt).date,
  });
  return result.ok ? { ok: true, outcome: result.data } : dbFailure(result.error);
}

/** Re-reads one refund from Stripe and records it. */
export async function syncRefund(db: Db, stripe: StripeConfig, refundId: string, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const refund = await getRefund(stripe, refundId, fetchImpl);
  if (!refund.ok) return stripeFailure("refund", refund);
  return applyRefund(db, stripe, refund.data, fetchImpl);
}

/** A charge was refunded (in the Stripe Dashboard): record every refund on its payment. */
async function syncPaymentRefunds(db: Db, stripe: StripeConfig, paymentIntentId: string, fetchImpl: typeof fetch): Promise<SyncResult> {
  const refunds = await listRefundsForPaymentIntent(stripe, paymentIntentId, fetchImpl);
  if (!refunds.ok) return stripeFailure("refunds", refunds);
  let outcome: Outcome = "ignored";
  for (const r of refunds.data) {
    const done = await applyRefund(db, stripe, r, fetchImpl);
    if (!done.ok) return done;
    outcome = done.outcome;
  }
  return { ok: true, outcome };
}

interface EventRow {
  event_id: string;
  attempts: number;
  processed_at: string | null;
}

export interface WebhookResponse {
  status: number;
  body: Record<string, string>;
}

/** Bodies bigger than this are refused before verification (Stripe events are a few KB). */
export const MAX_WEBHOOK_BYTES = 64 * 1024;

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Handles one webhook delivery. 403 for a bad signature; 200 once processed
 * (or already processed, or not ours); 500 when Stripe or the database
 * couldn't be reached, so Stripe delivers it again.
 */
export async function handleStripeWebhook(
  db: Db,
  stripe: StripeConfig,
  webhook: StripeWebhookConfig,
  rawBody: string,
  signature: string | null,
  fetchImpl: typeof fetch = fetch,
  nowSeconds?: number,
): Promise<WebhookResponse> {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "too-large" } };
  if (!verifyStripeSignature(rawBody, signature, webhook.signingSecret, nowSeconds)) {
    console.error("Stripe webhook: signature check failed");
    return { status: 403, body: { error: "signature" } };
  }
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    event = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: "json" } };
  }
  const eventId = text(event.id, 100);
  const type = text(event.type, 60);
  const object = obj(obj(event.data)?.object) ?? {};
  const objectId = text(object.id, 100);
  if (!eventId || !type) return { status: 400, body: { error: "event" } };

  // Duplicate-delivery protection: one row per Stripe event id.
  const inserted = await insert<EventRow>(db, "akb_square_events", { event_id: eventId, environment: stripe.environment, type, object_id: objectId });
  if (!inserted.ok) {
    if (inserted.error.kind !== "conflict") return { status: 500, body: { error: "db" } };
    const existing = await select<EventRow>(db, "akb_square_events", [["event_id", `eq.${eventId}`]]);
    if (!existing.ok || !existing.data[0]) return { status: 500, body: { error: "db" } };
    if (existing.data[0].processed_at) return { status: 200, body: { outcome: "duplicate" } };
    await update(db, "akb_square_events", [["event_id", `eq.${eventId}`]], { attempts: Math.min(existing.data[0].attempts + 1, 1000) });
  }

  let result: SyncResult;
  if (!objectId) result = { ok: true, outcome: "ignored" };
  else if (type.startsWith("checkout.session.")) result = await syncCheckoutSession(db, stripe, objectId, fetchImpl);
  else if (type === "payment_intent.succeeded") result = await syncPaymentIntent(db, stripe, objectId, false, fetchImpl);
  else if (type === "payment_intent.payment_failed") result = await syncPaymentIntent(db, stripe, objectId, true, fetchImpl);
  else if (type === "refund.created" || type === "refund.updated") result = await syncRefund(db, stripe, objectId, fetchImpl);
  else if (type === "charge.refunded" && text(object.payment_intent, 100)) result = await syncPaymentRefunds(db, stripe, text(object.payment_intent, 100), fetchImpl);
  else result = { ok: true, outcome: "ignored" };

  const outcome = result.ok ? result.outcome : `error:${result.reason}`.slice(0, 60);
  await update(db, "akb_square_events", [["event_id", `eq.${eventId}`]], {
    outcome,
    ...(result.ok ? { processed_at: new Date().toISOString() } : {}),
  });
  console.log(`Stripe webhook: ${type} ${eventId} → ${outcome}`);
  return result.ok ? { status: 200, body: { outcome } } : { status: 500, body: { error: "retry" } };
}

interface LinkRow {
  id: string;
  environment: string;
  charge_id: string;
  client_id: string;
  amount_pence: number;
  idempotency_key: string;
  /** Historic column names: both hold the Stripe checkout session id. */
  square_link_id: string | null;
  square_order_id: string | null;
  url: string;
  status: "creating" | "open" | "paid" | "cancelled";
  created_at?: string;
}

interface ChargeBalance {
  id: string;
  client_id: string;
  description: string;
  voided_at: string | null;
  outstanding_pence: number;
}

export type LinkResult = { ok: true; url: string; amountPence: number } | { ok: false; reason: "not-found" | "nothing-owed" | "direct-debit" | "stripe" | "db" };

/** Stripe's checkout pages last 24 hours; a link older than this is replaced rather than shown. */
const LINK_LIFETIME_MS = 20 * 60 * 60 * 1000;

/**
 * A Stripe checkout link for what's still owed on a charge. Retrying (double
 * click, timeout) reuses the same idempotency key, so Stripe returns the same
 * session instead of making another; a charge has at most one live link.
 */
export async function createChargeLink(
  db: Db,
  stripe: StripeConfig,
  chargeId: string,
  fetchImpl: typeof fetch = fetch,
  /** Online sign-ups and class bookings: the buyer's email for Stripe's form, and the page to return to. */
  options: { buyerEmail?: string; redirectUrl?: string } = {},
): Promise<LinkResult> {
  const live = await select<LinkRow>(db, "akb_square_payment_links", [["charge_id", `eq.${chargeId}`], ["status", "in.(creating,open)"]]);
  if (!live.ok) return { ok: false, reason: "db" };
  let link: LinkRow | undefined = live.data[0];
  // A Direct Debit collection is how this charge is being paid: there is no page to open.
  if (link?.status === "open" && !link.url.startsWith("http")) return { ok: false, reason: "direct-debit" };
  if (link?.status === "open") {
    const age = link.created_at ? Date.now() - Date.parse(link.created_at) : 0;
    if (age < LINK_LIFETIME_MS) return { ok: true, url: link.url, amountPence: link.amount_pence };
    // Too old to trust: close it (a payment that still arrives is recorded by its session id) and make a fresh one.
    await update(db, "akb_square_payment_links", [["id", `eq.${link.id}`], ["status", "eq.open"]], { status: "cancelled" });
    link = undefined;
  }

  const charges = await select<ChargeBalance>(db, "akb_charge_balances", [["id", `eq.${chargeId}`]]);
  if (!charges.ok) return { ok: false, reason: "db" };
  const charge = charges.data[0];
  if (!charge) return { ok: false, reason: "not-found" };
  if (charge.voided_at || charge.outstanding_pence <= 0) return { ok: false, reason: "nothing-owed" };

  if (!link) {
    const created = await insert<LinkRow>(db, "akb_square_payment_links", {
      environment: stripe.environment,
      charge_id: charge.id,
      client_id: charge.client_id,
      amount_pence: charge.outstanding_pence,
    });
    if (!created.ok || !created.data[0]) return { ok: false, reason: "db" };
    link = created.data[0];
  }
  if (link.environment !== stripe.environment) return { ok: false, reason: "db" };

  // Stripe requires a return address and refuses a blank one (400). The coach portal's "Card link"
  // names none, so the buyer lands on a confirmation page that reads this link's state from the
  // database (which only the verified webhook changes): it never claims "paid" on its own.
  const back = options.redirectUrl || `${memberLinkOrigin()}${PAY_DONE_PATH}?link=${link.id}`;
  const made = await createPaymentSession(
    stripe,
    {
      idempotencyKey: link.idempotency_key,
      name: charge.description,
      amountPence: link.amount_pence,
      note: `RAENG ref ${link.id.slice(0, 8)}`,
      buyerEmail: options.buyerEmail,
      successUrl: back,
      cancelUrl: back,
    },
    fetchImpl,
  );
  if (!made.ok) {
    console.error(`Stripe: creating a checkout session failed (${made.status ?? "network"})`);
    return { ok: false, reason: "stripe" };
  }
  const opened = await update<LinkRow>(db, "akb_square_payment_links", [["id", `eq.${link.id}`], ["status", "eq.creating"]], {
    status: "open",
    square_link_id: made.data.id,
    square_order_id: made.data.id,
    url: made.data.url,
  });
  if (!opened.ok) return { ok: false, reason: "db" };
  return { ok: true, url: made.data.url, amountPence: link.amount_pence };
}

export interface ReconcileSummary {
  ok: boolean;
  checked: number;
  recorded: number;
  failed: number;
}

/**
 * Safety net for missed webhooks: re-reads each open link's checkout session
 * from Stripe and applies it (idempotently, so overlap with webhooks is
 * harmless). A session Stripe says has expired unpaid closes its link.
 */
export async function reconcileOpenLinks(db: Db, stripe: StripeConfig, fetchImpl: typeof fetch = fetch, limit = 50): Promise<ReconcileSummary> {
  const links = await select<LinkRow>(db, "akb_square_payment_links", [
    ["environment", `eq.${stripe.environment}`],
    ["status", "eq.open"],
    ["order", "created_at.asc"],
    ["limit", String(limit)],
  ]);
  if (!links.ok) return { ok: false, checked: 0, recorded: 0, failed: 0 };
  const summary: ReconcileSummary = { ok: true, checked: links.data.length, recorded: 0, failed: 0 };
  for (const link of links.data) {
    if (!link.square_order_id) continue;
    const result = await syncCheckoutSession(db, stripe, link.square_order_id, fetchImpl);
    if (!result.ok) summary.failed += 1;
    else if (result.outcome === "recorded") summary.recorded += 1;
  }
  if (summary.failed) console.error(`Stripe reconcile: ${summary.failed} of ${summary.checked} links couldn't be checked`);
  return summary;
}

export interface LiveLink {
  charge_id: string;
  url: string;
  amount_pence: number;
  environment: string;
}

/** A client's open Stripe links, for their charges list. */
export async function listOpenLinks(db: Db, clientId: string): Promise<LiveLink[]> {
  const result = await select<LiveLink>(db, "akb_square_payment_links", [
    ["select", "charge_id,url,amount_pence,environment"],
    ["client_id", `eq.${clientId}`],
    ["status", "eq.open"],
  ]);
  return result.ok ? result.data : [];
}

/** Where Stripe sends someone after paying a link the coach made (a Card link in the portal). */
export const PAY_DONE_PATH = "/pay/done";

export interface ChargeLinkStatus {
  /** "awaiting": not paid yet (or Stripe hasn't told us yet); "paid": the verified payment is recorded; "closed": the link was cancelled or has expired. */
  status: "awaiting" | "paid" | "closed";
  amountPence: number;
  description: string;
  /** The Stripe page to go back to, while the link is still open. */
  payUrl: string | null;
}

/**
 * What the confirmation page may show for a link: its state, the amount and
 * what it was for, nothing about the person. "paid" only once the payment is
 * in the database, which happens only from Stripe's signed webhook (or the
 * reconcile job), never from the buyer arriving at the page.
 */
export async function chargeLinkStatus(db: Db, linkId: string): Promise<ChargeLinkStatus | null> {
  const links = await select<{ status: LinkRow["status"]; amount_pence: number; charge_id: string; url: string }>(db, "akb_square_payment_links", [
    ["select", "status,amount_pence,charge_id,url"],
    ["id", `eq.${linkId}`],
  ]);
  const link = links.ok ? links.data[0] : undefined;
  if (!link) return null;
  const charges = await select<{ description: string }>(db, "akb_charges", [["select", "description"], ["id", `eq.${link.charge_id}`]]);
  const description = charges.ok ? (charges.data[0]?.description ?? "") : "";
  const status = link.status === "paid" ? "paid" : link.status === "cancelled" ? "closed" : "awaiting";
  return { status, amountPence: link.amount_pence, description, payUrl: status === "awaiting" && link.url.startsWith("https://") ? link.url : null };
}

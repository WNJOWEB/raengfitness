import { siteUrl } from "../env";
import { insert, rpc, select, update, type Db, type DbError } from "../coach/db";
import { toLondon } from "../coach/time";
import { createCheckoutSession, getRefund, getSession, getSessionByPaymentIntent, type StripeResult } from "./api";
import type { StripeConfig, StripeWebhookConfig } from "./config";
import { verifyStripeSignature } from "./signature";

/**
 * Keeps Supabase in step with Stripe. Stripe is the source of truth for card
 * payments: a webhook only says "something changed"; the Checkout Session or
 * refund is then re-read from Stripe's API and applied by one idempotent
 * database function (supabase/migrations/20261102000000_akb_stripe.sql). Logs
 * carry ids, types, outcomes and status codes only.
 */

type Outcome = "recorded" | "duplicate" | "unknown_session" | "pending" | "expired" | "not_paid" | "unknown_payment" | "not_refunded" | "ignored" | "wrong_mode";
export type SyncResult = { ok: true; outcome: Outcome } | { ok: false; reason: string };

const stripeFailure = (what: string, r: StripeResult<unknown>): SyncResult => ({ ok: false, reason: `stripe-${what}-${r.ok ? "ok" : (r.status ?? "network")}` });
const dbFailure = (e: DbError): SyncResult => ({ ok: false, reason: `db-${e.kind}${e.rule ? `-${e.rule}` : ""}` });
const dateOf = (unixSeconds: number) => toLondon(new Date(unixSeconds * 1000).toISOString()).date;
/** Live objects only against a live key, test objects only against a test key. */
const modeMatches = (stripe: StripeConfig, livemode: boolean) => livemode === (stripe.environment === "production");

/** Re-reads one Checkout Session from Stripe and records its payment if it was paid through one of our links. */
export async function syncSession(db: Db, stripe: StripeConfig, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const session = await getSession(stripe, sessionId, fetchImpl);
  if (!session.ok) return stripeFailure("session", session);
  const s = session.data;
  if (!modeMatches(stripe, s.livemode)) return { ok: true, outcome: "wrong_mode" };
  const result = await rpc<Outcome>(db, "akb_apply_stripe_session", {
    p_environment: stripe.environment,
    p_session_id: s.id,
    p_session_status: s.status,
    p_payment_status: s.paymentStatus,
    p_payment_intent: s.paymentIntentId,
    p_amount_pence: s.amountTotalPence,
    p_currency: s.currency,
    p_paid_on: dateOf(s.created),
  });
  return result.ok ? { ok: true, outcome: result.data } : dbFailure(result.error);
}

/** Re-reads one refund from Stripe; its payment is synced first if we haven't seen it, so order of arrival doesn't matter. */
export async function syncRefund(db: Db, stripe: StripeConfig, refundId: string, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const refund = await getRefund(stripe, refundId, fetchImpl);
  if (!refund.ok) return stripeFailure("refund", refund);
  const r = refund.data;
  if (!modeMatches(stripe, r.livemode)) return { ok: true, outcome: "wrong_mode" };
  if (!r.paymentIntentId) return { ok: true, outcome: "ignored" };
  const apply = () =>
    rpc<Outcome>(db, "akb_apply_stripe_refund", {
      p_environment: stripe.environment,
      p_refund_id: r.id,
      p_payment_intent: r.paymentIntentId,
      p_status: r.status,
      p_amount_pence: r.amountPence,
      p_currency: r.currency,
      p_refunded_on: dateOf(r.created),
    });
  let result = await apply();
  if (result.ok && result.data === "unknown_payment") {
    const owner = await getSessionByPaymentIntent(stripe, r.paymentIntentId, fetchImpl);
    if (!owner.ok) return stripeFailure("payment-lookup", owner);
    if (!owner.data) return { ok: true, outcome: "unknown_payment" }; // not collected through one of our links
    const synced = await syncSession(db, stripe, owner.data.id, fetchImpl);
    if (!synced.ok) return synced;
    result = await apply();
  }
  return result.ok ? { ok: true, outcome: result.data } : dbFailure(result.error);
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

const SESSION_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"]);
const REFUND_EVENTS = new Set(["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"]);

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
  const eventId = typeof event.id === "string" ? event.id.slice(0, 100) : "";
  const type = typeof event.type === "string" ? event.type.slice(0, 80) : "";
  const data = typeof event.data === "object" && event.data !== null ? (event.data as Record<string, unknown>) : {};
  const object = typeof data.object === "object" && data.object !== null ? (data.object as Record<string, unknown>) : {};
  const objectId = typeof object.id === "string" ? object.id.slice(0, 200) : "";
  if (!eventId || !type) return { status: 400, body: { error: "event" } };
  // An event from the other mode (e.g. a test event sent to the live endpoint) is acknowledged and ignored.
  if (typeof event.livemode === "boolean" && !modeMatches(stripe, event.livemode)) return { status: 200, body: { outcome: "wrong_mode" } };

  // Duplicate-delivery protection: one row per Stripe event id.
  const inserted = await insert<EventRow>(db, "akb_stripe_events", { event_id: eventId, environment: stripe.environment, type, object_id: objectId });
  if (!inserted.ok) {
    if (inserted.error.kind !== "conflict") return { status: 500, body: { error: "db" } };
    const existing = await select<EventRow>(db, "akb_stripe_events", [["event_id", `eq.${eventId}`]]);
    if (!existing.ok || !existing.data[0]) return { status: 500, body: { error: "db" } };
    if (existing.data[0].processed_at) return { status: 200, body: { outcome: "duplicate" } };
    await update(db, "akb_stripe_events", [["event_id", `eq.${eventId}`]], { attempts: Math.min(existing.data[0].attempts + 1, 1000) });
  }

  let result: SyncResult;
  if (!objectId) result = { ok: true, outcome: "ignored" };
  else if (SESSION_EVENTS.has(type)) result = await syncSession(db, stripe, objectId, fetchImpl);
  else if (REFUND_EVENTS.has(type)) result = await syncRefund(db, stripe, objectId, fetchImpl);
  else result = { ok: true, outcome: "ignored" };

  const outcome = result.ok ? result.outcome : `error:${result.reason}`.slice(0, 60);
  await update(db, "akb_stripe_events", [["event_id", `eq.${eventId}`]], {
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
  stripe_session_id: string | null;
  url: string;
  status: "creating" | "open" | "paid" | "cancelled";
}

interface ChargeBalance {
  id: string;
  client_id: string;
  description: string;
  voided_at: string | null;
  outstanding_pence: number;
}

export type LinkResult = { ok: true; url: string; amountPence: number } | { ok: false; reason: "not-found" | "nothing-owed" | "stripe" | "db" };

/**
 * A Stripe Checkout link for what's still owed on a charge. Retrying (double
 * click, timeout) reuses the same idempotency key, so Stripe returns the same
 * session instead of making another; a charge has at most one live link. The
 * session expires after 24 hours, after which the next "Card link" makes a new one.
 * Stripe sends the client back to `successUrl` (the home page) after paying; that
 * page says nothing about the payment: only the verified webhook records it.
 */
export async function createChargeLink(
  db: Db,
  stripe: StripeConfig,
  chargeId: string,
  fetchImpl: typeof fetch = fetch,
  successUrl: string = `${siteUrl()}/`,
): Promise<LinkResult> {
  const live = await select<LinkRow>(db, "akb_stripe_payment_links", [["charge_id", `eq.${chargeId}`], ["status", "in.(creating,open)"]]);
  if (!live.ok) return { ok: false, reason: "db" };
  let link: LinkRow | undefined = live.data[0];
  if (link?.status === "open") {
    // A link Stripe has since expired is retired first, so a fresh one can be made below.
    const state = link.stripe_session_id ? await syncSession(db, stripe, link.stripe_session_id, fetchImpl) : null;
    if (state?.ok && state.outcome === "expired") link = undefined;
    else if (state?.ok && state.outcome === "recorded") return { ok: false, reason: "nothing-owed" };
    else return { ok: true, url: link.url, amountPence: link.amount_pence };
  }

  const charges = await select<ChargeBalance>(db, "akb_charge_balances", [["id", `eq.${chargeId}`]]);
  if (!charges.ok) return { ok: false, reason: "db" };
  const charge = charges.data[0];
  if (!charge) return { ok: false, reason: "not-found" };
  if (charge.voided_at || charge.outstanding_pence <= 0) return { ok: false, reason: "nothing-owed" };

  if (!link) {
    const created = await insert<LinkRow>(db, "akb_stripe_payment_links", {
      environment: stripe.environment,
      charge_id: charge.id,
      client_id: charge.client_id,
      amount_pence: charge.outstanding_pence,
    });
    if (!created.ok || !created.data[0]) return { ok: false, reason: "db" };
    link = created.data[0];
  }
  if (link.environment !== stripe.environment) return { ok: false, reason: "db" };

  const made = await createCheckoutSession(
    stripe,
    { idempotencyKey: link.idempotency_key, name: charge.description, amountPence: link.amount_pence, linkId: link.id, successUrl },
    fetchImpl,
  );
  if (!made.ok) {
    console.error(`Stripe: creating a checkout session failed (${made.status ?? "network"})`);
    return { ok: false, reason: "stripe" };
  }
  const opened = await update<LinkRow>(db, "akb_stripe_payment_links", [["id", `eq.${link.id}`], ["status", "eq.creating"]], {
    status: "open",
    stripe_session_id: made.data.id,
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
 * Safety net for missed webhooks: re-reads each open link's session and applies
 * what Stripe says (a paid session is recorded, an expired one retired), idempotently,
 * so overlap with webhooks is harmless.
 */
export async function reconcileOpenLinks(db: Db, stripe: StripeConfig, fetchImpl: typeof fetch = fetch, limit = 50): Promise<ReconcileSummary> {
  const links = await select<LinkRow>(db, "akb_stripe_payment_links", [
    ["environment", `eq.${stripe.environment}`],
    ["status", "eq.open"],
    ["order", "created_at.asc"],
    ["limit", String(limit)],
  ]);
  if (!links.ok) return { ok: false, checked: 0, recorded: 0, failed: 0 };
  const summary: ReconcileSummary = { ok: true, checked: links.data.length, recorded: 0, failed: 0 };
  for (const link of links.data) {
    if (!link.stripe_session_id) continue;
    const result = await syncSession(db, stripe, link.stripe_session_id, fetchImpl);
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
  const result = await select<LiveLink>(db, "akb_stripe_payment_links", [
    ["select", "charge_id,url,amount_pence,environment"],
    ["client_id", `eq.${clientId}`],
    ["status", "eq.open"],
  ]);
  return result.ok ? result.data : [];
}

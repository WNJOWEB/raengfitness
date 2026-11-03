import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "../coach/clients";
import { rpc, type Db } from "../coach/db";
import { addCharge } from "../coach/ledger";
import { addDays, londonToday } from "../coach/time";
import { testDb } from "../coach/test-support";
import { startCheckout } from "../membership-checkout";
import type { MembershipRequest } from "../membership-request";
import type { StripeConfig } from "./config";
import { collectDirectDebits, notifyDirectDebitFailures } from "./direct-debit";
import { ensureStripeCustomer } from "./customer";
import { createChargeLink, handleStripeWebhook } from "./sync";
import { signedEvent, testWebhook } from "./test-support";

/**
 * The same flows as the other Stripe tests, but against Stripe's REAL test
 * account ("RAENG Fitness sandbox"), so what the stand-in server can't prove
 * is proven here: that Stripe accepts the exact requests the site makes
 * (page expiry, return addresses, the card agreement, saving a card), that a
 * saved card is charged with nobody present, and what really happens when a
 * card is declined, needs the bank's confirmation, or is refunded.
 *
 * Only the database is local (a throwaway Postgres with every migration); no
 * real money or live data is involved, and the key must be a TEST key.
 * Switched off unless asked, so ordinary test runs never call Stripe:
 *
 *   npm run test:sandbox        (needs STRIPE_TEST_SECRET_KEY, a sk_test_ key
 *                                kept in the environment, never in the repo)
 *
 * Each run creates test customers in the sandbox (harmless, free). Emails are
 * recorded here, not sent.
 */

const KEY = process.env.STRIPE_TEST_SECRET_KEY?.trim() ?? "";
const ON = process.env.RUN_STRIPE_SANDBOX === "1" && /^(sk|rk)_test_/.test(KEY);

const stripe: StripeConfig = { environment: "sandbox", baseUrl: "https://api.stripe.com", secretKey: KEY };
const RESEND = "http://localhost:3299/emails";
const env = { RESEND_API_KEY: "re_test", BOOKING_NOTIFY_EMAIL: "alex@example.com", BOOKING_FROM_EMAIL: "RAENG <bookings@example.com>", RESEND_API_URL: RESEND, SITE_URL: "https://raeng.example" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;
const emails: { to: string[]; subject: string; text: string; key: string }[] = [];
const touched: string[] = [];

/** Stripe's real API for setting things up and looking things up (not the site's own code). */
// Stripe's replies are read field by field in the tests below, so they are typed loosely on purpose (test code only).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function api(method: "GET" | "POST", path: string, form: Record<string, string> = {}): Promise<Json> {
  const query = method === "GET" && Object.keys(form).length ? `?${new URLSearchParams(form)}` : "";
  const response = await fetch(`https://api.stripe.com${path}${query}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Stripe-Version": "2024-06-20", ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "POST" ? new URLSearchParams(form).toString() : undefined,
  });
  return (await response.json()) as Json;
}

/** The site's own calls go to the real Stripe; emails are recorded; the database is the local one. */
const fetchImpl = (async (url: string, init: RequestInit = {}) => {
  const u = String(url);
  if (u === RESEND) {
    const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string };
    const key = (init.headers as Record<string, string>)["Idempotency-Key"];
    if (!emails.some((e) => e.key === key)) emails.push({ ...body, key });
    return Response.json({ id: "email" });
  }
  if (u.startsWith("https://api.stripe.com")) return fetch(url, init);
  return db.fetchImpl(url, init);
}) as typeof fetch;

/** A real event from Stripe's list, waited for (events can lag a few seconds). */
async function realEvent(type: string, match: (object: Json) => boolean) {
  for (let i = 0; i < 20; i++) {
    const list = await api("GET", "/v1/events", { type, limit: "30" });
    const hit = (list.data as Json[] | undefined)?.find((e) => match(e.data.object));
    if (hit) return hit;
    await sleep(1500);
  }
  throw new Error(`Stripe never listed a ${type} event`);
}

/** Hands a real Stripe event to the site's webhook, signed the way Stripe signs it. */
function deliver(event: Record<string, unknown>) {
  const { raw, signature, timestamp } = signedEvent(event);
  return handleStripeWebhook(db, stripe, testWebhook, raw, signature, fetchImpl, timestamp);
}

async function newClient(label: string) {
  n += 1;
  const name = `Sandbox ${label} ${n}`;
  const email = `sandbox-${label}-${n}-${Date.now()}@example.com`;
  const c = await createClient(db, { full_name: name, email, phone: "", instagram: "", preferred_contact: "", status: "active", notes: "" });
  if (!c.ok) throw new Error("client");
  return { id: c.data.id, name, email };
}

/** A member with a membership due today and a test card saved on a real Stripe customer. */
async function memberWithCard(label: string, paymentMethod: string) {
  const c = await newClient(label);
  const customer = await ensureStripeCustomer(db, stripe, { clientId: c.id, email: c.email, name: c.name }, fetchImpl);
  if (!customer.ok) throw new Error("Stripe customer");
  touched.push(customer.customerId);
  const attached = await api("POST", `/v1/payment_methods/${paymentMethod}/attach`, { customer: customer.customerId });
  if (!attached.id) throw new Error(`Stripe wouldn't attach ${paymentMethod}: ${JSON.stringify(attached.error?.message)}`);
  const label2 = attached.card ? `${String(attached.card.brand).replace(/^./, (x: string) => x.toUpperCase())} ending ${attached.card.last4}` : "Card";
  const saved = await rpc(db, "akb_card_set_method", { p_client: c.id, p_environment: "sandbox", p_customer: customer.customerId, p_method: attached.id, p_label: label2, p_replace: true });
  if (!saved.ok) throw new Error("saving the card");
  await sql("select akb_start_membership($1, 'regular', 'Regular', 6500, 8, akb_london_today())", [c.id]);
  const [m] = await sql("select id from akb_memberships where client_id = $1", [c.id]);
  return { ...c, customerId: customer.customerId, membership: String(m.id), label: label2 };
}

async function collection(membership: string) {
  const [row] = await sql("select c.status, c.attempts, c.payment_intent_id, c.paused from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [membership]);
  return row;
}

describe.skipIf(!ON)("Stripe's real test account", () => {
  beforeAll(async () => {
    ({ db, sql } = await testDb());
    await sql("insert into akb_database_role (role) values ('test')");
    // Never go further with a live account.
    const balance = await api("GET", "/v1/balance");
    expect(balance.livemode).toBe(false);
  }, 60_000);

  afterAll(() => {
    if (touched.length) console.log(`Sandbox customers created this run: ${touched.length} (free; clear them from the sandbox dashboard whenever you like).`);
  });

  it("accepts the pay page the site asks for: 35 minutes, a return address and a back-arrow address", async () => {
    const c = await newClient("page");
    const charge = await addCharge(db, { clientId: c.id, service: "group", description: "Group class, sandbox test", amountPence: 1200, dueOn: londonToday() });
    if (!charge.ok) throw new Error("charge");
    const link = await createChargeLink(db, stripe, charge.data.id, fetchImpl, { redirectUrl: "https://raeng.example/book/done?booking=abc", expiresInMinutes: 35, buyerEmail: c.email });
    expect(link).toMatchObject({ ok: true, amountPence: 1200 });
    expect(link.ok && link.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const [row] = await sql("select square_order_id from akb_square_payment_links where charge_id = $1", [charge.data.id]);
    const session = await api("GET", `/v1/checkout/sessions/${row.square_order_id}`);
    expect(session.status).toBe("open");
    expect(session.mode).toBe("payment");
    expect(session.amount_total).toBe(1200);
    expect(session.currency).toBe("gbp");
    expect(session.success_url).toBe("https://raeng.example/book/done?booking=abc");
    expect(session.cancel_url).toBe("https://raeng.example/book/done?booking=abc&cancelled=1");
    const minutes = (session.expires_at - session.created) / 60;
    expect(minutes).toBeGreaterThanOrEqual(34);
    expect(minutes).toBeLessThanOrEqual(36);

    // Replacing a stale link really closes the old page, so a tab left open can't pay.
    await sql("update akb_square_payment_links set created_at = now() - interval '21 hours' where charge_id = $1 and status = 'open'", [charge.data.id]);
    const fresh = await createChargeLink(db, stripe, charge.data.id, fetchImpl, { redirectUrl: "https://raeng.example/book/done?booking=abc", expiresInMinutes: 35 });
    expect(fresh.ok).toBe(true);
    expect((await api("GET", `/v1/checkout/sessions/${row.square_order_id}`)).status).toBe("expired");
  }, 60_000);

  it("accepts a membership's first payment with the saved-card agreement beside the button", async () => {
    n += 1;
    const request = { plan: "regular", session: "", classDate: "", experience: "new", name: `Sandbox Joiner ${n}`, email: `sandbox-join-${n}-${Date.now()}@example.com`, phone: "", message: "", submissionId: `sandbox-join-${n}-${Date.now()}` } as unknown as MembershipRequest;
    const out = await startCheckout(db, stripe, request, null, { agreedAt: new Date().toISOString(), idempotencyKey: `sandbox-join-${n}-${Date.now()}`, env, fetchImpl });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [row] = await sql("select l.square_order_id, l.client_id from akb_square_payment_links l join akb_membership_signups g on g.charge_id = l.charge_id where g.id = $1", [out.signupId]);
    const session = await api("GET", `/v1/checkout/sessions/${row.square_order_id}`);
    expect(session.status).toBe("open");
    expect(session.customer).toMatch(/^cus_/);
    expect(session.amount_total).toBe(6500);
    expect(String(session.custom_text?.submit?.message)).toContain("renews every 4 weeks until you cancel");
    expect(session.success_url).toContain("/memberships/join/done?signup=");
    expect(session.cancel_url).toContain("cancelled=1");
    touched.push(String(session.customer));
  }, 60_000);

  it("charges a saved card with nobody present, records it once, and emails a receipt", async () => {
    const m = await memberWithCard("renew", "pm_card_visa");
    const run = await collectDirectDebits(db, stripe, londonToday(), fetchImpl);
    expect(run.ok).toBe(true);
    const col = await collection(m.membership);
    expect(col).toMatchObject({ status: "succeeded", attempts: 1 });
    const intent = String(col.payment_intent_id);
    const real = await api("GET", `/v1/payment_intents/${intent}`);
    expect(real.status).toBe("succeeded");
    expect(real.amount).toBe(6500);
    expect(real.livemode).toBe(false);
    expect(await sql("select provider, method, amount_pence from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ provider: "stripe_test", method: "card", amount_pence: 6500 }]);

    // Stripe's own announcement of it, as Stripe really sends it, changes nothing more.
    const event = await realEvent("payment_intent.succeeded", (o) => o.id === intent);
    expect((await deliver(event)).body).toEqual({ outcome: "duplicate" });
    expect(await sql("select count(*)::int as n from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ n: 1 }]);
    // The next daily run charges nothing more.
    await collectDirectDebits(db, stripe, londonToday(), fetchImpl);
    expect(await sql("select count(*)::int as n from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ n: 1 }]);

    // A refund made in Stripe reaches the site as Stripe really announces it.
    const refund = await api("POST", "/v1/refunds", { payment_intent: intent });
    expect(refund.status).toMatch(/succeeded|pending/);
    const refundEvent = await realEvent("refund.created", (o) => o.id === refund.id);
    expect((await deliver(refundEvent)).status).toBe(200);
    expect(await sql("select count(*)::int as n from akb_refunds r join akb_payments p on p.id = r.payment_id where p.provider_payment_id = $1", [intent])).toEqual([{ n: 1 }]);
  }, 120_000);

  it("a declined card is a failed try: tells the member how to fix it, retries on day 3 and 7, then pauses", async () => {
    const m = await memberWithCard("declined", "pm_card_chargeCustomerFail");
    const today = londonToday();
    await collectDirectDebits(db, stripe, today, fetchImpl);
    expect(await collection(m.membership)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await notifyDirectDebitFailures(db, env, fetchImpl)).toBeGreaterThanOrEqual(1);
    const mail = emails.find((e) => e.to[0] === m.email && e.subject === "Your RAENG membership payment didn't go through");
    expect(mail?.text).toContain("We'll try again in 3 days");
    // Nothing more before day 3; then day 3 and day 7, after which the membership pauses.
    await collectDirectDebits(db, stripe, addDays(today, 2), fetchImpl);
    expect((await collection(m.membership)).attempts).toBe(1);
    await collectDirectDebits(db, stripe, addDays(today, 3), fetchImpl);
    expect((await collection(m.membership)).attempts).toBe(2);
    await collectDirectDebits(db, stripe, addDays(today, 7), fetchImpl);
    expect((await collection(m.membership)).attempts).toBe(3);
    expect((await sql("select status from akb_memberships where id = $1", [m.membership]))[0].status).toBe("paused");
    await notifyDirectDebitFailures(db, env, fetchImpl);
    expect(emails.some((e) => e.to[0] === m.email && e.subject === "Your RAENG membership is paused")).toBe(true);
    expect(await sql("select count(*)::int as n from akb_payments p join akb_clients c on c.id = p.client_id where c.id = $1", [m.id])).toEqual([{ n: 0 }]);
  }, 180_000);

  it("a card that needs the bank's confirmation can't be charged with nobody there: a failed try, never a payment", async () => {
    const m = await memberWithCard("bankcheck", "pm_card_authenticationRequired");
    await collectDirectDebits(db, stripe, londonToday(), fetchImpl);
    expect(await collection(m.membership)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await sql("select count(*)::int as n from akb_payments where client_id = $1", [m.id])).toEqual([{ n: 0 }]);
    await notifyDirectDebitFailures(db, env, fetchImpl);
    expect(emails.some((e) => e.to[0] === m.email && e.subject === "Your RAENG membership payment didn't go through")).toBe(true);
  }, 120_000);
});

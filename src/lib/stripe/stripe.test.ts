import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../coach/clients";
import { select, type Db } from "../coach/db";
import { addCharge, getCharge, recordPayment, recordRefund, setPaymentStatus, voidCharge } from "../coach/ledger";
import { testDb } from "../coach/test-support";
import { stripeConfig, stripeWebhookConfig } from "./config";
import { stripeSignature, verifyStripeSignature } from "./signature";
import { notifyChargePayments } from "./receipts";
import { chargeLinkStatus, createChargeLink, handleStripeWebhook, reconcileOpenLinks } from "./sync";
import { deliverStripeEvent, signedEvent, stripeStandIn, testStripe, testWebhook, type StripeStandIn } from "./test-support";

const stripe = testStripe;

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;

const api = () => stripeStandIn((url, init) => db.fetchImpl(url, init));
const completed = (a: StripeStandIn, sessionId: string, eventId?: string) => deliverStripeEvent(db, a, "checkout.session.completed", { id: sessionId }, eventId);

async function chargeFor(pence = 1000) {
  n += 1;
  const c = await createClient(db, { full_name: `Stripe ${n}`, email: `stripe${n}@example.com`, phone: "", instagram: "", preferred_contact: "", status: "active", notes: "" });
  if (!c.ok) throw new Error("client");
  const ch = await addCharge(db, { clientId: c.data.id, service: "group", description: "Group class, Sat 24 Oct", amountPence: pence, dueOn: "2026-10-24" });
  if (!ch.ok) throw new Error("charge");
  return { client: c.data.id, charge: ch.data.id };
}

async function openLink(a: StripeStandIn, pence = 1000) {
  const ids = await chargeFor(pence);
  const link = await createChargeLink(db, stripe, ids.charge, a.fetchImpl);
  if (!link.ok) throw new Error(`link ${link.reason}`);
  const row = (await sql("select * from akb_square_payment_links where charge_id = $1", [ids.charge]))[0];
  return { ...ids, sessionId: String(row.square_order_id), linkId: String(row.id) };
}

const stripePayments = (client: string) => sql("select * from akb_payments where client_id = $1 and provider like 'stripe%'", [client]);
const outstanding = async (charge: string) => {
  const r = await getCharge(db, charge);
  return r.ok ? r.data?.outstanding_pence : undefined;
};

beforeAll(async () => {
  ({ db, sql } = await testDb());
  // What the owner runs once on the isolated test database (DEPLOYMENT.md → Stripe).
  await sql("insert into akb_database_role (role) values ('test')");
}, 60_000);

afterEach(() => vi.restoreAllMocks());

describe("webhook signature", () => {
  const secret = "whsec_unit_test";
  const body = '{"id":"evt_1","object":"event","type":"checkout.session.completed","data":{"object":{"id":"cs_test_1"}}}';
  const t = 1_792_000_000;
  const good = `t=${t},v1=${stripeSignature(body, secret, t)}`;

  it("is Stripe's scheme: hex HMAC-SHA256 of `timestamp.body`, in a t=…,v1=… header", () => {
    expect(stripeSignature(body, secret, t)).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyStripeSignature(body, good, secret, t)).toBe(true);
    // Stripe may send several v1 values (rolled secrets): any one matching is enough.
    expect(verifyStripeSignature(body, `t=${t},v1=${"0".repeat(64)},v1=${stripeSignature(body, secret, t)}`, secret, t)).toBe(true);
  });

  it("rejects a changed body, key or signature, a missing or malformed header, and a stale timestamp", () => {
    expect(verifyStripeSignature(body.replace("cs_test_1", "cs_test_2"), good, secret, t)).toBe(false);
    expect(verifyStripeSignature(body, good, "whsec_other", t)).toBe(false);
    expect(verifyStripeSignature(body, good.replace(/v1=./, "v1=0"), secret, t)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, t)).toBe(false);
    expect(verifyStripeSignature(body, "short", secret, t)).toBe(false);
    expect(verifyStripeSignature(body, `v1=${stripeSignature(body, secret, t)}`, secret, t)).toBe(false);
    // A captured request can't be replayed later (five minutes either way).
    expect(verifyStripeSignature(body, good, secret, t + 301)).toBe(false);
    expect(verifyStripeSignature(body, good, secret, t + 299)).toBe(true);
    expect(verifyStripeSignature(body, good, secret, t - 301)).toBe(false);
  });
});

describe("configuration", () => {
  const live = "sk_live_not_real";
  const test = "sk_test_not_real";
  const hook = "whsec_not_real";

  it("is off unless a key is present and looks like a Stripe key", () => {
    expect(stripeConfig({})).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: "pk_test_publishable", VERCEL_ENV: "preview" })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: "garbage" })).toBeNull();
    expect(stripeWebhookConfig({ STRIPE_SECRET_KEY: test, STRIPE_WEBHOOK_SECRET: "not-whsec" })).toBeNull();
    expect(stripeWebhookConfig({ STRIPE_SECRET_KEY: test })).toBeNull();
    expect(stripeWebhookConfig({ STRIPE_SECRET_KEY: test, STRIPE_WEBHOOK_SECRET: hook })).toMatchObject({ environment: "sandbox", signingSecret: hook });
  });

  it("uses live keys only on Vercel production, and test keys everywhere else", () => {
    expect(stripeConfig({ STRIPE_SECRET_KEY: live, VERCEL_ENV: "production" })).toMatchObject({ environment: "production", baseUrl: "https://api.stripe.com" });
    expect(stripeConfig({ STRIPE_SECRET_KEY: live, VERCEL_ENV: "preview" })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: live })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: test, VERCEL_ENV: "preview" })).toMatchObject({ environment: "sandbox", baseUrl: "https://api.stripe.com" });
    expect(stripeConfig({ STRIPE_SECRET_KEY: test, VERCEL_ENV: "production" })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: "rk_live_restricted", VERCEL_ENV: "production" })).toMatchObject({ environment: "production" });
  });

  it("refuses test keys against the live Supabase project", () => {
    const sandbox = { STRIPE_SECRET_KEY: test, STRIPE_WEBHOOK_SECRET: hook, VERCEL_ENV: "preview" };
    expect(stripeConfig({ ...sandbox, SUPABASE_URL: "https://sqkpixwvugrxllrxlexs.supabase.co" })).toBeNull();
    expect(stripeWebhookConfig({ ...sandbox, SUPABASE_URL: "https://sqkpixwvugrxllrxlexs.supabase.co" })).toBeNull();
    expect(stripeConfig({ ...sandbox, SUPABASE_URL: "not a url" })).toBeNull();
    expect(stripeConfig({ ...sandbox, SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" })).toMatchObject({ environment: "sandbox" });
  });

  it("allows the localhost API stand-in only outside Vercel", () => {
    expect(stripeConfig({ STRIPE_SECRET_KEY: test, STRIPE_API_URL: "http://localhost:3297" })?.baseUrl).toBe("http://localhost:3297");
    expect(stripeConfig({ STRIPE_SECRET_KEY: test, STRIPE_API_URL: "http://localhost:3297", VERCEL_ENV: "preview" })?.baseUrl).toBe("https://api.stripe.com");
    expect(stripeConfig({ STRIPE_SECRET_KEY: test, STRIPE_API_URL: "https://evil.example" })?.baseUrl).toBe("https://api.stripe.com");
  });
});

describe("checkout links", () => {
  it("asks Stripe for a hosted checkout of what's owed, in GBP, as a form with the secret key", async () => {
    const a = api();
    const { charge } = await chargeFor(1000);
    const link = await createChargeLink(db, stripe, charge, a.fetchImpl, { buyerEmail: "buyer@example.com", redirectUrl: "https://raeng.example/back" });
    expect(link).toMatchObject({ ok: true, amountPence: 1000 });
    expect(link.ok && link.url).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_\d+$/);
    const call = a.calls[0];
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v1/checkout/sessions");
    expect(call.headers.Authorization).toBe(`Bearer ${stripe.secretKey}`);
    expect(call.headers["Stripe-Version"]).toBe("2024-06-20");
    expect(call.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(call.form.get("mode")).toBe("payment");
    expect(call.form.get("payment_method_types[0]")).toBe("card");
    expect(call.form.get("line_items[0][price_data][currency]")).toBe("gbp");
    expect(call.form.get("line_items[0][price_data][unit_amount]")).toBe("1000");
    expect(call.form.get("line_items[0][price_data][product_data][name]")).toBe("Group class, Sat 24 Oct");
    expect(call.form.get("customer_email")).toBe("buyer@example.com");
    expect(call.form.get("success_url")).toBe("https://raeng.example/back");
  });

  it("always gives Stripe a return address, even when the caller names none (the coach portal's Card link): the confirmation page for that link", async () => {
    const a = api();
    const { charge } = await chargeFor(1000);
    expect(await createChargeLink(db, stripe, charge, a.fetchImpl)).toMatchObject({ ok: true });
    const [row] = await sql("select id from akb_square_payment_links where charge_id = $1", [charge]);
    const success = a.calls[0].form.get("success_url");
    expect(success).toMatch(/^https?:\/\/[^/]+\/pay\/done\?link=[0-9a-f-]{36}$/);
    expect(success).toContain(`link=${row.id}`);
    expect(a.calls[0].form.get("cancel_url")).toBe(success);
  });

  it("the confirmation page's state: awaiting until the verified payment is recorded, then paid; closed when cancelled; unknown ids give nothing", async () => {
    const a = api();
    const { charge, client } = await chargeFor(1000);
    await createChargeLink(db, stripe, charge, a.fetchImpl);
    const [row] = await sql("select id, url from akb_square_payment_links where charge_id = $1", [charge]);
    // Arriving from Stripe proves nothing: still awaiting, with the Stripe page to go back to.
    expect(await chargeLinkStatus(db, String(row.id))).toEqual({ status: "awaiting", amountPence: 1000, description: "Group class, Sat 24 Oct", payUrl: row.url });
    // Only the signed webhook's recorded payment flips it.
    await sql("update akb_square_payment_links set status = 'paid' where id = $1", [row.id]);
    expect(await chargeLinkStatus(db, String(row.id))).toMatchObject({ status: "paid", payUrl: null });
    // A cancelled or expired link is closed.
    const other = await chargeFor(500);
    await createChargeLink(db, stripe, other.charge, a.fetchImpl);
    const [row2] = await sql("select id from akb_square_payment_links where charge_id = $1", [other.charge]);
    await sql("update akb_square_payment_links set status = 'cancelled' where id = $1", [row2.id]);
    expect(await chargeLinkStatus(db, String(row2.id))).toMatchObject({ status: "closed", payUrl: null });
    expect(await chargeLinkStatus(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    // Nothing about the person leaves the database.
    expect(JSON.stringify(await chargeLinkStatus(db, String(row.id)))).not.toContain(client);
  });

  it("one live link per charge; a retry after a failure reuses the same idempotency key", async () => {
    const a = api();
    const { charge } = await chargeFor(1500);
    a.setDown(true);
    expect(await createChargeLink(db, stripe, charge, a.fetchImpl)).toEqual({ ok: false, reason: "stripe" });
    a.setDown(false);
    const first = await createChargeLink(db, stripe, charge, a.fetchImpl);
    const again = await createChargeLink(db, stripe, charge, a.fetchImpl);
    expect(first.ok && again.ok && first.url === again.url).toBe(true);
    const keys = a.calls.filter((c) => c.method === "POST").map((c) => c.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(await sql("select count(*)::int as n from akb_square_payment_links where charge_id = $1", [charge])).toEqual([{ n: 1 }]);
  });

  it("replaces a link that is too old for Stripe's 24-hour checkout page", async () => {
    const a = api();
    const { charge, linkId } = await openLink(a, 1000);
    await sql("update akb_square_payment_links set created_at = now() - interval '21 hours' where id = $1", [linkId]);
    const fresh = await createChargeLink(db, stripe, charge, a.fetchImpl);
    expect(fresh.ok).toBe(true);
    expect((await sql("select status from akb_square_payment_links where id = $1", [linkId]))[0].status).toBe("cancelled");
    expect(await sql("select count(*)::int as n from akb_square_payment_links where charge_id = $1 and status = 'open'", [charge])).toEqual([{ n: 1 }]);
  });

  it("refuses a charge with nothing owed", async () => {
    const a = api();
    const { charge } = await chargeFor(1000);
    await voidCharge(db, charge, "Free");
    expect(await createChargeLink(db, stripe, charge, a.fetchImpl)).toEqual({ ok: false, reason: "nothing-owed" });
    expect(a.calls).toHaveLength(0);
  });
});

describe("webhooks → ledger", () => {
  it("records a paid session once, against its charge, only after re-reading it from Stripe", async () => {
    const a = api();
    const { client, charge, sessionId, linkId } = await openLink(a);
    const intent = a.pay(sessionId, 1000);
    expect(await completed(a, sessionId, "evt_pay_1")).toEqual({ status: 200, body: { outcome: "recorded" } });
    expect(a.calls.some((c) => c.method === "GET" && c.path === `/v1/checkout/sessions/${sessionId}`)).toBe(true);
    const rows = await stripePayments(client);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "stripe_test", provider_payment_id: intent, method: "card", amount_pence: 1000, status: "received" });
    expect(await outstanding(charge)).toBe(0);
    expect((await sql("select status from akb_square_payment_links where id = $1", [linkId]))[0].status).toBe("paid");

    // The same delivery again, and a different event about the same session.
    expect(await completed(a, sessionId, "evt_pay_1")).toEqual({ status: 200, body: { outcome: "duplicate" } });
    expect((await deliverStripeEvent(db, a, "checkout.session.async_payment_succeeded", { id: sessionId })).body).toEqual({ outcome: "duplicate" });
    expect(await stripePayments(client)).toHaveLength(1);
  });

  it("never trusts the event body: Stripe's current state decides", async () => {
    const a = api();
    const { client, sessionId } = await openLink(a);
    // The event claims a payment; Stripe says it is still unpaid.
    expect((await completed(a, sessionId)).body).toEqual({ outcome: "pending" });
    a.expire(sessionId);
    expect((await deliverStripeEvent(db, a, "checkout.session.expired", { id: sessionId })).body).toEqual({ outcome: "not_paid" });
    expect(await stripePayments(client)).toHaveLength(0);
    // An expired session closes its link, so the next attempt opens a fresh one.
    expect(await sql("select status from akb_square_payment_links where square_order_id = $1", [sessionId])).toEqual([{ status: "cancelled" }]);
  });

  it("rejects bad signatures and stale timestamps, and records nothing", async () => {
    const a = api();
    const { client, sessionId } = await openLink(a);
    a.pay(sessionId, 1000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { raw, signature, timestamp } = signedEvent({ id: "evt_forged", type: "checkout.session.completed", data: { object: { id: sessionId } } });
    expect((await handleStripeWebhook(db, stripe, testWebhook, raw.replace("evt_forged", "evt_forged2"), signature, a.fetchImpl, timestamp)).status).toBe(403);
    expect((await handleStripeWebhook(db, stripe, testWebhook, raw, null, a.fetchImpl, timestamp)).status).toBe(403);
    expect((await handleStripeWebhook(db, stripe, { ...testWebhook, signingSecret: "whsec_other" }, raw, signature, a.fetchImpl, timestamp)).status).toBe(403);
    expect((await handleStripeWebhook(db, stripe, testWebhook, raw, signature, a.fetchImpl, timestamp + 3600)).status).toBe(403);
    expect(await stripePayments(client)).toHaveLength(0);
    expect(await sql("select count(*)::int as n from akb_square_events where event_id like 'evt_forged%'")).toEqual([{ n: 0 }]);
    expect(a.calls.filter((c) => c.path.startsWith("/v1/checkout/sessions/"))).toHaveLength(0);
  });

  it("asks Stripe to redeliver when Stripe or the database can't be reached, then catches up", async () => {
    const a = api();
    const { client, sessionId } = await openLink(a);
    a.pay(sessionId, 1000);
    a.setDown(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await completed(a, sessionId, "evt_retry")).toEqual({ status: 500, body: { error: "retry" } });
    expect((await sql("select processed_at, attempts, outcome from akb_square_events where event_id = 'evt_retry'"))[0]).toMatchObject({ processed_at: null, attempts: 1, outcome: "error:stripe-session-500" });
    a.setDown(false);
    expect((await completed(a, sessionId, "evt_retry")).body).toEqual({ outcome: "recorded" });
    expect((await sql("select attempts from akb_square_events where event_id = 'evt_retry'"))[0].attempts).toBe(2);
    expect(await stripePayments(client)).toHaveLength(1);
  });

  it("ignores sessions that aren't from our links, and events it doesn't handle", async () => {
    const a = api();
    // A session someone else made on the same Stripe account (not one of our links).
    a.sessions.set("cs_test_foreign", { id: "cs_test_foreign", mode: "payment", status: "complete", payment_status: "paid", payment_intent: "pi_foreign", amount_total: 2500, currency: "gbp", created: 1_792_000_000 });
    expect((await completed(a, "cs_test_foreign")).body).toEqual({ outcome: "unknown_order" });
    expect((await deliverStripeEvent(db, a, "customer.created", { id: "cus_1" })).body).toEqual({ outcome: "ignored" });
    // A Direct Debit set-up page that isn't finished records nothing (see direct-debit.test.ts), and other modes are ignored.
    a.sessions.set("cs_test_setup", { id: "cs_test_setup", mode: "setup", status: "open", payment_status: "no_payment_required", created: 1_792_000_000 });
    expect((await completed(a, "cs_test_setup")).body).toEqual({ outcome: "pending" });
    a.sessions.set("cs_test_sub", { id: "cs_test_sub", mode: "subscription", status: "complete", payment_status: "paid", created: 1_792_000_000 });
    expect((await completed(a, "cs_test_sub")).body).toEqual({ outcome: "ignored" });
  });

  it("refuses a non-GBP payment and keeps asking for redelivery", async () => {
    const a = api();
    const { client, sessionId } = await openLink(a);
    a.pay(sessionId, 1000, { currency: "usd" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await completed(a, sessionId)).status).toBe(500);
    expect(await stripePayments(client)).toHaveLength(0);
  });

  it("money beyond what's owed (or on a cancelled charge) becomes credit", async () => {
    const a = api();
    const { client, charge, sessionId } = await openLink(a, 1000);
    // Meanwhile the client paid £4 in cash.
    await recordPayment(db, { clientId: client, service: "group", amountPence: 400, paidOn: "2026-10-19", method: "cash", reference: "", note: "", key: `cash-${charge}`, allocations: [{ charge_id: charge, amount_pence: 400 }] });
    a.pay(sessionId, 1000);
    expect((await completed(a, sessionId)).body).toEqual({ outcome: "recorded" });
    expect(await outstanding(charge)).toBe(0);
    const bal = await select<{ credit_pence: number }>(db, "akb_client_balances", [["client_id", `eq.${client}`]]);
    expect(bal.ok && bal.data[0].credit_pence).toBe(400);

    const late = await openLink(a, 1000);
    await voidCharge(db, late.charge, "Class cancelled");
    expect((await sql("select status from akb_square_payment_links where id = $1", [late.linkId]))[0].status).toBe("cancelled");
    a.pay(late.sessionId, 1000);
    expect((await completed(a, late.sessionId)).body).toEqual({ outcome: "recorded" });
    const lateBal = await select<{ credit_pence: number }>(db, "akb_client_balances", [["client_id", `eq.${late.client}`]]);
    expect(lateBal.ok && lateBal.data[0].credit_pence).toBe(1000);
  });
});

describe("receipts for payments on a coach Card link", () => {
  const RESEND = "http://localhost:3299/emails";
  const mailEnv = { RESEND_API_KEY: "re_test", BOOKING_NOTIFY_EMAIL: "alex@example.com", BOOKING_FROM_EMAIL: "RAENG <hello@example.com>", RESEND_API_URL: RESEND };
  const mailer = () => {
    const sent: { to: string[]; subject: string; text: string; key: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      if (String(url) !== RESEND) return db.fetchImpl(url, init);
      const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string };
      const key = (init.headers as Record<string, string>)["Idempotency-Key"];
      if (!sent.some((e) => e.key === key)) sent.push({ ...body, key });
      return Response.json({ id: "email" });
    }) as typeof fetch;
    return { sent, fetchImpl };
  };

  it("emails the customer and Alex once when the verified payment is recorded, and never again", async () => {
    const a = api();
    const m = mailer();
    const { client, sessionId } = await openLink(a, 100);
    a.pay(sessionId, 100);
    await completed(a, sessionId);
    const [person] = await sql("select email from akb_clients where id = $1", [client]);
    expect(await notifyChargePayments(db, mailEnv, m.fetchImpl)).toBeGreaterThanOrEqual(1);
    const mine = m.sent.filter((e) => e.to.includes(String(person.email)) || e.subject.includes("£1.00"));
    expect(mine.find((e) => e.to.includes(String(person.email)))).toMatchObject({ subject: "We've received your payment: £1.00" });
    expect(mine.find((e) => e.to.includes(String(person.email)))?.text).toContain("Group class, Sat 24 Oct");
    expect(mine.find((e) => e.to.includes("alex@example.com"))?.subject).toMatch(/^Payment received: .*£1\.00$/);
    const count = m.sent.length;
    expect(await notifyChargePayments(db, mailEnv, m.fetchImpl)).toBe(0);
    expect(m.sent).toHaveLength(count);
  });

  it("a client with no email on file: Alex is told (and told why no receipt went), nothing is sent to the customer, and it isn't retried forever", async () => {
    const a = api();
    const m = mailer();
    const { client, sessionId } = await openLink(a, 300);
    await sql("update akb_clients set email = '' where id = $1", [client]);
    a.pay(sessionId, 300);
    await completed(a, sessionId);
    expect(await notifyChargePayments(db, mailEnv, m.fetchImpl)).toBeGreaterThanOrEqual(1);
    const mine = m.sent.filter((e) => e.subject.includes("£3.00"));
    expect(mine).toHaveLength(1);
    expect(mine[0].to).toEqual(["alex@example.com"]);
    expect(mine[0].text).toContain("no email address on file");
    const count = m.sent.length;
    expect(await notifyChargePayments(db, mailEnv, m.fetchImpl)).toBe(0);
    expect(m.sent).toHaveLength(count);
  });

  it("sends nothing without email settings, and nothing for a payment that isn't recorded", async () => {
    const a = api();
    const m = mailer();
    const { sessionId } = await openLink(a, 250);
    expect(await notifyChargePayments(db, {}, m.fetchImpl)).toBe(0);
    await notifyChargePayments(db, mailEnv, m.fetchImpl); // the link above is still unpaid
    expect(m.sent.filter((e) => e.subject.includes("£2.50"))).toEqual([]);
    expect(sessionId).toBeTruthy();
  });
});

describe("refunds", () => {
  it("mirrors a succeeded Stripe refund once; the charge is owed again", async () => {
    const a = api();
    const { client, charge, sessionId } = await openLink(a, 1000);
    const intent = a.pay(sessionId, 1000);
    await completed(a, sessionId);
    const pending = a.refund(intent, 1000, "pending");
    expect((await deliverStripeEvent(db, a, "refund.created", { id: pending })).body).toEqual({ outcome: "pending" });
    const done = a.refund(intent, 1000);
    expect((await deliverStripeEvent(db, a, "refund.updated", { id: done })).body).toEqual({ outcome: "recorded" });
    expect((await deliverStripeEvent(db, a, "refund.updated", { id: done })).body).toEqual({ outcome: "duplicate" });
    const [payment] = await stripePayments(client);
    expect(await sql("select amount_pence, refunded_on::text, note from akb_refunds where payment_id = $1", [payment.id])).toEqual([{ amount_pence: 1000, refunded_on: "2026-10-21", note: "Stripe refund" }]);
    expect(await outstanding(charge)).toBe(1000);
  });

  it("a refund made in the Stripe Dashboard arrives as charge.refunded and is recorded the same way", async () => {
    const a = api();
    const { client, sessionId } = await openLink(a, 1000);
    const intent = a.pay(sessionId, 1000);
    await completed(a, sessionId);
    a.refund(intent, 250);
    expect((await deliverStripeEvent(db, a, "charge.refunded", { id: "ch_1", payment_intent: intent })).body).toEqual({ outcome: "recorded" });
    const [payment] = await stripePayments(client);
    expect(await sql("select amount_pence from akb_refunds where payment_id = $1", [payment.id])).toEqual([{ amount_pence: 250 }]);
  });

  it("a refund arriving before its payment's webhook records both, in order", async () => {
    const a = api();
    const { client, sessionId } = await openLink(a, 1000);
    const intent = a.pay(sessionId, 1000);
    const refundId = a.refund(intent, 300);
    expect((await deliverStripeEvent(db, a, "refund.updated", { id: refundId })).body).toEqual({ outcome: "recorded" });
    const [payment] = await stripePayments(client);
    expect(await sql("select amount_pence from akb_refunds where payment_id = $1", [payment.id])).toEqual([{ amount_pence: 300 }]);
  });

  it("the portal can't refund or void a Stripe payment (that's done in Stripe), but still can for cash", async () => {
    const a = api();
    const { client, charge, sessionId } = await openLink(a, 1000);
    a.pay(sessionId, 1000);
    await completed(a, sessionId);
    const [payment] = await stripePayments(client);
    const id = String(payment.id);
    expect(await recordRefund(db, { paymentId: id, amountPence: 100, refundedOn: "2026-10-21", note: "", key: `portal-${id}`, chargeId: charge, voidCharge: false })).toMatchObject({ ok: false, error: { rule: "provider_managed" } });
    expect(await setPaymentStatus(db, id, "void", "")).toMatchObject({ ok: false, error: { rule: "provider_managed" } });

    const cash = await recordPayment(db, { clientId: client, service: "group", amountPence: 500, paidOn: "2026-10-21", method: "cash", reference: "", note: "", key: `cash2-${id}`, allocations: [] });
    if (!cash.ok) throw new Error("cash");
    expect((await recordRefund(db, { paymentId: cash.data, amountPence: 100, refundedOn: "2026-10-21", note: "", key: `cash-refund-${id}`, chargeId: null, voidCharge: false })).ok).toBe(true);
  });
});

describe("reconciliation", () => {
  it("records payments whose webhook never arrived, without duplicating, and closes expired links", async () => {
    const a = api();
    const paid = await openLink(a, 1000);
    a.pay(paid.sessionId, 1000);
    const lapsed = await openLink(a, 1000);
    a.expire(lapsed.sessionId);
    const first = await reconcileOpenLinks(db, stripe, a.fetchImpl);
    expect(first.ok).toBe(true);
    expect(first.recorded).toBeGreaterThanOrEqual(1);
    expect((await reconcileOpenLinks(db, stripe, a.fetchImpl)).recorded).toBe(0);
    expect(await stripePayments(paid.client)).toHaveLength(1);
    expect(await stripePayments(lapsed.client)).toHaveLength(0);
    expect((await sql("select status from akb_square_payment_links where id = $1", [lapsed.linkId]))[0].status).toBe("cancelled");
  });
});

describe("access and logs", () => {
  it("public roles can't touch the payment tables or functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const relation of ["akb_square_payment_links", "akb_square_events"]) {
        await sql(`set role ${role}`);
        await expect(sql(`select * from ${relation} limit 1`), `${role} ${relation}`).rejects.toThrow(/permission denied/);
        await sql("reset role");
      }
    }
    const grants = await sql(
      `select proname, has_function_privilege('anon', oid, 'EXECUTE') as anon, has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated
       from pg_proc where proname in ('akb_apply_square_payment', 'akb_apply_square_refund', 'akb_refund_apply', 'akb_square_provider') order by 1`,
    );
    expect(grants).toHaveLength(4);
    for (const g of grants) expect(g).toMatchObject({ anon: false, authenticated: false });
    const rls = await sql("select relname from pg_class where relname in ('akb_square_payment_links', 'akb_square_events') and not relrowsecurity");
    expect(rls).toEqual([]);
  });

  it("never logs the secret key, signing secret or customer details", async () => {
    const a = api();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...x) => void lines.push(x.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...x) => void lines.push(x.join(" ")));
    const { sessionId } = await openLink(a);
    a.pay(sessionId, 1000);
    await completed(a, sessionId);
    a.setDown(true);
    await completed(a, sessionId);
    await createChargeLink(db, stripe, (await chargeFor()).charge, a.fetchImpl, { buyerEmail: "buyer@example.com" });
    await handleStripeWebhook(db, stripe, testWebhook, "{}", "bad", a.fetchImpl);
    const all = lines.join("\n");
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [stripe.secretKey, testWebhook.signingSecret, "@example.com"]) expect(all).not.toContain(secret);
  });
});

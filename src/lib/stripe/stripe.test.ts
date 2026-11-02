import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "../coach/clients";
import { select, type Db } from "../coach/db";
import { addCharge, getCharge, recordPayment, recordRefund, setPaymentStatus, voidCharge } from "../coach/ledger";
import { testDb } from "../coach/test-support";
import { formEncode } from "./api";
import { stripeConfig, stripeWebhookConfig, STRIPE_API_VERSION, type StripeConfig, type StripeWebhookConfig } from "./config";
import { stripeSignature, verifyStripeSignature } from "./signature";
import { createChargeLink, handleStripeWebhook, reconcileOpenLinks } from "./sync";

const stripe: StripeConfig = { environment: "sandbox", baseUrl: "https://api.stripe.com", secretKey: "sk_test_notreal0123456789" };
const webhook: StripeWebhookConfig = { environment: "sandbox", signingSecret: "whsec_notreal0123456789" };
const NOW = 1_792_000_000;

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;
/** Stripe ids are unique across the whole run, as in Stripe. */
let ids = 0;

type Session = Record<string, unknown>;

/**
 * Stripe stand-in: Checkout Sessions and refunds held in memory. Like Stripe,
 * a repeated Idempotency-Key returns the same session.
 */
function stripeApi() {
  const byKey = new Map<string, Session>();
  const sessions = new Map<string, Session>();
  const refunds = new Map<string, Record<string, unknown>>();
  const calls: { method: string; path: string; headers: Record<string, string>; body: URLSearchParams | null }[] = [];
  let down = false;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    if (!String(url).startsWith(stripe.baseUrl)) return db.fetchImpl(url, init);
    const full = new URL(String(url));
    const path = full.pathname;
    const headers = init.headers as Record<string, string>;
    const body = init.body ? new URLSearchParams(String(init.body)) : null;
    calls.push({ method: init.method ?? "GET", path, headers, body });
    if (down) return Response.json({ error: { type: "api_error" } }, { status: 500 });
    if (init.method === "POST" && path === "/v1/checkout/sessions") {
      const key = headers["Idempotency-Key"];
      if (!byKey.has(key)) {
        const i = ++ids;
        const session = { id: `cs_test_${i}`, status: "open", payment_status: "unpaid", payment_intent: null, amount_total: Number(body!.get("line_items[0][price_data][unit_amount]")), currency: "gbp", livemode: false, created: NOW, url: `https://checkout.stripe.com/c/pay/cs_test_${i}` };
        byKey.set(key, session);
        sessions.set(session.id, session);
      }
      return Response.json(byKey.get(key));
    }
    if (path === "/v1/checkout/sessions") {
      const pi = full.searchParams.get("payment_intent");
      return Response.json({ object: "list", data: [...sessions.values()].filter((s) => s.payment_intent === pi).slice(0, 1) });
    }
    const parts = path.split("/"); // ["", "v1", "refunds", id] or ["", "v1", "checkout", "sessions", id]
    const found = parts[2] === "refunds" ? refunds.get(parts[3]) : parts[2] === "checkout" ? sessions.get(parts[4]) : undefined;
    return found ? Response.json(found) : Response.json({ error: { type: "invalid_request_error" } }, { status: 404 });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    sessions,
    setDown: (value: boolean) => (down = value),
    /** The client pays: the session completes and gets a PaymentIntent. */
    pay(sessionId: string, patch: Session = {}) {
      const pi = `pi_${++ids}`;
      sessions.set(sessionId, { ...sessions.get(sessionId), status: "complete", payment_status: "paid", payment_intent: pi, ...patch });
      return pi;
    },
    setSession(sessionId: string, patch: Session) {
      sessions.set(sessionId, { ...sessions.get(sessionId), ...patch });
    },
    refund(paymentIntent: string, amount: number, status = "succeeded", extra: Session = {}) {
      const id = `re_${++ids}`;
      refunds.set(id, { id, status, payment_intent: paymentIntent, amount, currency: "gbp", livemode: false, created: NOW + 86_400, ...extra });
      return id;
    },
    setRefund(id: string, patch: Session) {
      refunds.set(id, { ...refunds.get(id), ...patch });
    },
  };
}

function signed(event: Record<string, unknown>, secret = webhook.signingSecret, at = NOW) {
  const raw = JSON.stringify(event);
  return { raw, signature: `t=${at},v1=${stripeSignature(raw, secret, at)}` };
}

let e = 0;
function deliver(api: ReturnType<typeof stripeApi>, type: string, objectId: string, eventId = `evt_${++e}`, extra: Record<string, unknown> = {}) {
  const { raw, signature } = signed({ id: eventId, object: "event", type, livemode: false, created: NOW, data: { object: { id: objectId } }, ...extra });
  return handleStripeWebhook(db, stripe, webhook, raw, signature, api.fetchImpl, NOW);
}

async function chargeFor(pence = 1000) {
  n += 1;
  const c = await createClient(db, { full_name: `Stripe ${n}`, email: `stripe${n}@example.com`, phone: "", instagram: "", preferred_contact: "", status: "active", notes: "" });
  if (!c.ok) throw new Error("client");
  const ch = await addCharge(db, { clientId: c.data.id, service: "group", description: "Group class, Sat 24 Oct", amountPence: pence, dueOn: "2026-10-24" });
  if (!ch.ok) throw new Error("charge");
  return { client: c.data.id, charge: ch.data.id };
}

async function openLink(api: ReturnType<typeof stripeApi>, pence = 1000) {
  const ids = await chargeFor(pence);
  const link = await createChargeLink(db, stripe, ids.charge, api.fetchImpl, "https://example.test/");
  if (!link.ok) throw new Error(`link ${link.reason}`);
  const row = (await sql("select * from akb_stripe_payment_links where charge_id = $1 order by created_at desc", [ids.charge]))[0];
  return { ...ids, sessionId: String(row.stripe_session_id), linkId: String(row.id) };
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
  // Vector computed independently with openssl: printf '%s' "$ts.$body" | openssl dgst -sha256 -hmac "$secret"
  const secret = "whsec_test_secret";
  const body = '{"id":"evt_1","object":"event","type":"checkout.session.completed","data":{"object":{"id":"cs_test_1"}}}';
  const ts = 1_492_774_577;
  const expected = stripeSignature(body, secret, ts);

  it("is the hex HMAC-SHA256 of `timestamp.body`", () => {
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyStripeSignature(body, `t=${ts},v1=${expected}`, secret, ts + 10)).toBe(true);
  });

  it("accepts any v1 during secret rotation, and ignores other schemes", () => {
    const wrong = "0".repeat(64);
    expect(verifyStripeSignature(body, `t=${ts},v1=${wrong},v1=${expected}`, secret, ts)).toBe(true);
    expect(verifyStripeSignature(body, `t=${ts},v0=${expected}`, secret, ts)).toBe(false);
  });

  it("rejects a changed body, key, signature, malformed or missing header", () => {
    expect(verifyStripeSignature(body.replace("cs_test_1", "cs_test_2"), `t=${ts},v1=${expected}`, secret, ts)).toBe(false);
    expect(verifyStripeSignature(body, `t=${ts},v1=${expected}`, "whsec_other", ts)).toBe(false);
    expect(verifyStripeSignature(body, `t=${ts},v1=${expected.replace(/^./, expected[0] === "a" ? "b" : "a")}`, secret, ts)).toBe(false);
    expect(verifyStripeSignature(body, `t=${ts + 1},v1=${expected}`, secret, ts)).toBe(false);
    for (const header of [null, "", "garbage", `v1=${expected}`, `t=abc,v1=${expected}`, `t=${ts},v1=short`]) expect(verifyStripeSignature(body, header, secret, ts), String(header)).toBe(false);
  });

  it("rejects a replay outside the five-minute tolerance", () => {
    expect(verifyStripeSignature(body, `t=${ts},v1=${expected}`, secret, ts + 300)).toBe(true);
    expect(verifyStripeSignature(body, `t=${ts},v1=${expected}`, secret, ts + 301)).toBe(false);
    expect(verifyStripeSignature(body, `t=${ts},v1=${expected}`, secret, ts - 301)).toBe(false);
  });
});

describe("form encoding", () => {
  it("uses Stripe's nested bracket syntax", () => {
    expect(formEncode({ mode: "payment", line_items: [{ quantity: 1, price_data: { currency: "gbp" } }], metadata: { a: "b c" }, skip: undefined })).toBe(
      "mode=payment&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=gbp&metadata%5Ba%5D=b%20c",
    );
  });
});

describe("configuration", () => {
  const key = (mode: "live" | "test") => `sk_${mode}_abc123DEF456`;
  const secret = { STRIPE_WEBHOOK_SECRET: "whsec_abc123" };

  it("is off unless a recognisable key is present", () => {
    expect(stripeConfig({})).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: "pk_test_abc" })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: "sk_test_" })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: "whsec_abc" })).toBeNull();
    expect(stripeWebhookConfig({ STRIPE_SECRET_KEY: key("test") })).toBeNull();
    expect(stripeWebhookConfig({ STRIPE_SECRET_KEY: key("test"), STRIPE_WEBHOOK_SECRET: "not-a-secret" })).toBeNull();
  });

  it("uses a live key only on Vercel production, and a test key everywhere else", () => {
    expect(stripeConfig({ STRIPE_SECRET_KEY: key("live"), VERCEL_ENV: "production" })).toMatchObject({ environment: "production", baseUrl: "https://api.stripe.com" });
    expect(stripeConfig({ STRIPE_SECRET_KEY: "rk_live_abc123", VERCEL_ENV: "production" })).toMatchObject({ environment: "production" });
    expect(stripeConfig({ STRIPE_SECRET_KEY: key("live"), VERCEL_ENV: "preview" })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: key("live") })).toBeNull();
    expect(stripeConfig({ STRIPE_SECRET_KEY: key("test"), VERCEL_ENV: "preview" })).toMatchObject({ environment: "sandbox" });
    expect(stripeConfig({ STRIPE_SECRET_KEY: key("test") })).toMatchObject({ environment: "sandbox" });
    expect(stripeConfig({ STRIPE_SECRET_KEY: key("test"), VERCEL_ENV: "production" })).toBeNull();
    expect(stripeWebhookConfig({ STRIPE_SECRET_KEY: key("live"), VERCEL_ENV: "production", ...secret })).toMatchObject({ environment: "production" });
    expect(stripeWebhookConfig({ STRIPE_SECRET_KEY: key("test"), VERCEL_ENV: "production", ...secret })).toBeNull();
  });

  it("refuses test mode against the live Supabase project", () => {
    const test = { STRIPE_SECRET_KEY: key("test"), VERCEL_ENV: "preview", ...secret };
    expect(stripeConfig({ ...test, SUPABASE_URL: "https://sqkpixwvugrxllrxlexs.supabase.co" })).toBeNull();
    expect(stripeWebhookConfig({ ...test, SUPABASE_URL: "https://sqkpixwvugrxllrxlexs.supabase.co" })).toBeNull();
    expect(stripeConfig({ ...test, SUPABASE_URL: "not a url" })).toBeNull();
    expect(stripeConfig({ ...test, SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" })).toMatchObject({ environment: "sandbox" });
  });

  it("allows the localhost API stand-in only outside Vercel", () => {
    const test = { STRIPE_SECRET_KEY: key("test"), STRIPE_API_URL: "http://localhost:3297" };
    expect(stripeConfig(test)?.baseUrl).toBe("http://localhost:3297");
    expect(stripeConfig({ ...test, VERCEL_ENV: "preview" })?.baseUrl).toBe("https://api.stripe.com");
    expect(stripeConfig({ ...test, STRIPE_API_URL: "https://evil.example" })?.baseUrl).toBe("https://api.stripe.com");
  });
});

describe("payment links", () => {
  it("asks Stripe for a hosted, card-only checkout of what's owed, in GBP, with no personal data", async () => {
    const api = stripeApi();
    const { charge } = await chargeFor(1000);
    const link = await createChargeLink(db, stripe, charge, api.fetchImpl, "https://example.test/");
    expect(link).toMatchObject({ ok: true, amountPence: 1000 });
    expect(link.ok && link.url).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_\d+$/);
    const call = api.calls[0];
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe(`Bearer ${stripe.secretKey}`);
    expect(call.headers["Stripe-Version"]).toBe(STRIPE_API_VERSION);
    expect(call.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const b = call.body!;
    expect(b.get("mode")).toBe("payment");
    expect(b.get("payment_method_types[0]")).toBe("card");
    expect(b.get("line_items[0][price_data][currency]")).toBe("gbp");
    expect(b.get("line_items[0][price_data][unit_amount]")).toBe("1000");
    expect(b.get("line_items[0][price_data][product_data][name]")).toBe("Group class, Sat 24 Oct");
    expect(b.get("success_url")).toBe("https://example.test/");
    expect(b.get("metadata[akb_link]")).toBe(b.get("client_reference_id"));
    expect(b.toString()).not.toContain("example.com");
  });

  it("one live link per charge; a retry after a failure reuses the same idempotency key", async () => {
    const api = stripeApi();
    const { charge } = await chargeFor(1500);
    api.setDown(true);
    expect(await createChargeLink(db, stripe, charge, api.fetchImpl)).toEqual({ ok: false, reason: "stripe" });
    api.setDown(false);
    const first = await createChargeLink(db, stripe, charge, api.fetchImpl);
    const again = await createChargeLink(db, stripe, charge, api.fetchImpl);
    expect(first.ok && again.ok && first.url === again.url).toBe(true);
    const keys = api.calls.filter((c) => c.method === "POST").map((c) => c.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(await sql("select count(*)::int as n from akb_stripe_payment_links where charge_id = $1", [charge])).toEqual([{ n: 1 }]);
  });

  it("makes a fresh link once Stripe has expired the old one (24 hours)", async () => {
    const api = stripeApi();
    const { charge, sessionId, linkId } = await openLink(api);
    api.setSession(sessionId, { status: "expired" });
    const next = await createChargeLink(db, stripe, charge, api.fetchImpl, "https://example.test/");
    expect(next.ok && next.url).not.toContain(sessionId);
    expect((await sql("select status from akb_stripe_payment_links where id = $1", [linkId]))[0].status).toBe("cancelled");
    expect(await sql("select count(*)::int as n from akb_stripe_payment_links where charge_id = $1 and status = 'open'", [charge])).toEqual([{ n: 1 }]);
  });

  it("refuses a charge with nothing owed", async () => {
    const api = stripeApi();
    const { charge } = await chargeFor(1000);
    await voidCharge(db, charge, "Free");
    expect(await createChargeLink(db, stripe, charge, api.fetchImpl)).toEqual({ ok: false, reason: "nothing-owed" });
    expect(api.calls).toHaveLength(0);
  });
});

describe("webhooks → ledger", () => {
  it("records a paid session once, against its charge, only after re-reading it from Stripe", async () => {
    const api = stripeApi();
    const { client, charge, sessionId, linkId } = await openLink(api);
    const pi = api.pay(sessionId);
    expect(await deliver(api, "checkout.session.completed", sessionId, "evt_pay_1")).toEqual({ status: 200, body: { outcome: "recorded" } });
    expect(api.calls.some((c) => c.method === "GET" && c.path === `/v1/checkout/sessions/${sessionId}`)).toBe(true);
    const rows = await stripePayments(client);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "stripe_sandbox", provider_payment_id: pi, method: "card", amount_pence: 1000, status: "received", paid_on: new Date("2026-10-14T00:00:00Z") });
    expect(await outstanding(charge)).toBe(0);
    expect((await sql("select status from akb_stripe_payment_links where id = $1", [linkId]))[0].status).toBe("paid");

    // The same delivery again, and a different event about the same session.
    expect(await deliver(api, "checkout.session.completed", sessionId, "evt_pay_1")).toEqual({ status: 200, body: { outcome: "duplicate" } });
    expect(await deliver(api, "checkout.session.async_payment_succeeded", sessionId)).toEqual({ status: 200, body: { outcome: "duplicate" } });
    expect(await stripePayments(client)).toHaveLength(1);
  });

  it("never trusts the event body: Stripe's current state decides", async () => {
    const api = stripeApi();
    const { client, sessionId } = await openLink(api);
    // The event claims payment; the session says it's still open.
    expect((await deliver(api, "checkout.session.completed", sessionId, undefined, { data: { object: { id: sessionId, payment_status: "paid", status: "complete" } } })).body).toEqual({ outcome: "pending" });
    api.setSession(sessionId, { status: "complete", payment_status: "unpaid" });
    expect((await deliver(api, "checkout.session.completed", sessionId)).body).toEqual({ outcome: "not_paid" });
    expect(await stripePayments(client)).toHaveLength(0);
    api.pay(sessionId);
    expect((await deliver(api, "checkout.session.completed", sessionId)).body).toEqual({ outcome: "recorded" });
  });

  it("an expired session retires its link", async () => {
    const api = stripeApi();
    const { sessionId, linkId } = await openLink(api);
    api.setSession(sessionId, { status: "expired" });
    expect((await deliver(api, "checkout.session.expired", sessionId)).body).toEqual({ outcome: "expired" });
    expect((await sql("select status from akb_stripe_payment_links where id = $1", [linkId]))[0].status).toBe("cancelled");
  });

  it("rejects bad signatures and stale timestamps, and records nothing", async () => {
    const api = stripeApi();
    const { client, sessionId } = await openLink(api);
    api.pay(sessionId);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const event = { id: "evt_forged", type: "checkout.session.completed", livemode: false, data: { object: { id: sessionId } } };
    const good = signed(event);
    const send = (raw: string, signature: string | null, now = NOW) => handleStripeWebhook(db, stripe, webhook, raw, signature, api.fetchImpl, now);
    expect((await send(good.raw.replace("evt_forged", "evt_forged2"), good.signature)).status).toBe(403);
    expect((await send(good.raw, null)).status).toBe(403);
    expect((await send(good.raw, signed(event, "whsec_attacker").signature)).status).toBe(403);
    expect((await send(good.raw, good.signature, NOW + 3600)).status).toBe(403);
    expect(await stripePayments(client)).toHaveLength(0);
    expect(await sql("select count(*)::int as n from akb_stripe_events where event_id like 'evt_forged%'")).toEqual([{ n: 0 }]);
    expect(api.calls.filter((c) => c.method === "GET" && c.path.startsWith("/v1/checkout/sessions/"))).toHaveLength(0);
  });

  it("asks Stripe to redeliver when Stripe or the database can't be reached, then catches up", async () => {
    const api = stripeApi();
    const { client, sessionId } = await openLink(api);
    api.pay(sessionId);
    api.setDown(true);
    expect(await deliver(api, "checkout.session.completed", sessionId, "evt_retry")).toEqual({ status: 500, body: { error: "retry" } });
    expect((await sql("select processed_at, attempts, outcome from akb_stripe_events where event_id = 'evt_retry'"))[0]).toMatchObject({ processed_at: null, attempts: 1, outcome: "error:stripe-session-500" });
    api.setDown(false);
    expect((await deliver(api, "checkout.session.completed", sessionId, "evt_retry")).body).toEqual({ outcome: "recorded" });
    expect((await sql("select attempts from akb_stripe_events where event_id = 'evt_retry'"))[0].attempts).toBe(2);
    expect(await stripePayments(client)).toHaveLength(1);
  });

  it("ignores sessions that aren't ours, other event types and events from the other mode", async () => {
    const api = stripeApi();
    api.sessions.set("cs_test_other", { id: "cs_test_other", status: "complete", payment_status: "paid", payment_intent: "pi_other", amount_total: 2500, currency: "gbp", livemode: false, created: NOW });
    expect((await deliver(api, "checkout.session.completed", "cs_test_other")).body).toEqual({ outcome: "unknown_session" });
    expect((await deliver(api, "customer.created", "cus_1")).body).toEqual({ outcome: "ignored" });
    expect((await deliver(api, "checkout.session.completed", "cs_live_1", undefined, { livemode: true })).body).toEqual({ outcome: "wrong_mode" });
    // A live-mode session read with a test key is also refused.
    const { sessionId } = await openLink(api);
    api.pay(sessionId, { livemode: true });
    expect((await deliver(api, "checkout.session.completed", sessionId)).body).toEqual({ outcome: "wrong_mode" });
  });

  it("refuses a non-GBP payment and keeps asking for redelivery", async () => {
    const api = stripeApi();
    const { client, sessionId } = await openLink(api);
    api.pay(sessionId, { currency: "usd" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deliver(api, "checkout.session.completed", sessionId)).status).toBe(500);
    expect(await stripePayments(client)).toHaveLength(0);
  });

  it("money beyond what's owed (or on a cancelled charge) becomes credit", async () => {
    const api = stripeApi();
    const { client, charge, sessionId } = await openLink(api, 1000);
    // Meanwhile the client paid £4 in cash.
    await recordPayment(db, { clientId: client, service: "group", amountPence: 400, paidOn: "2026-10-19", method: "cash", reference: "", note: "", key: `cash-${charge}`, allocations: [{ charge_id: charge, amount_pence: 400 }] });
    api.pay(sessionId);
    expect((await deliver(api, "checkout.session.completed", sessionId)).body).toEqual({ outcome: "recorded" });
    expect(await outstanding(charge)).toBe(0);
    const bal = await select<{ credit_pence: number }>(db, "akb_client_balances", [["client_id", `eq.${client}`]]);
    expect(bal.ok && bal.data[0].credit_pence).toBe(400);

    const late = await openLink(api, 1000);
    await voidCharge(db, late.charge, "Class cancelled");
    expect((await sql("select status from akb_stripe_payment_links where id = $1", [late.linkId]))[0].status).toBe("cancelled");
    api.pay(late.sessionId);
    expect((await deliver(api, "checkout.session.completed", late.sessionId)).body).toEqual({ outcome: "recorded" });
    const lateBal = await select<{ credit_pence: number }>(db, "akb_client_balances", [["client_id", `eq.${late.client}`]]);
    expect(lateBal.ok && lateBal.data[0].credit_pence).toBe(1000);
  });
});

describe("refunds", () => {
  it("mirrors a succeeded Stripe refund once; the charge is owed again", async () => {
    const api = stripeApi();
    const { client, charge, sessionId } = await openLink(api, 1000);
    const pi = api.pay(sessionId);
    await deliver(api, "checkout.session.completed", sessionId);
    const refundId = api.refund(pi, 1000, "pending");
    expect((await deliver(api, "refund.created", refundId)).body).toEqual({ outcome: "pending" });
    api.setRefund(refundId, { status: "succeeded" });
    expect((await deliver(api, "refund.updated", refundId)).body).toEqual({ outcome: "recorded" });
    expect((await deliver(api, "refund.updated", refundId)).body).toEqual({ outcome: "duplicate" });
    const [payment] = await stripePayments(client);
    expect(await sql("select amount_pence, refunded_on::text, note from akb_refunds where payment_id = $1", [payment.id])).toEqual([{ amount_pence: 1000, refunded_on: "2026-10-15", note: "Stripe refund" }]);
    expect(await outstanding(charge)).toBe(1000);
  });

  it("a failed refund records nothing", async () => {
    const api = stripeApi();
    const { client, sessionId } = await openLink(api, 1000);
    const pi = api.pay(sessionId);
    await deliver(api, "checkout.session.completed", sessionId);
    expect((await deliver(api, "refund.failed", api.refund(pi, 500, "failed"))).body).toEqual({ outcome: "not_refunded" });
    const [payment] = await stripePayments(client);
    expect(await sql("select count(*)::int as n from akb_refunds where payment_id = $1", [payment.id])).toEqual([{ n: 0 }]);
  });

  it("a refund arriving before its payment's webhook records both, in order", async () => {
    const api = stripeApi();
    const { client, sessionId } = await openLink(api, 1000);
    const pi = api.pay(sessionId);
    const refundId = api.refund(pi, 300);
    expect((await deliver(api, "refund.updated", refundId)).body).toEqual({ outcome: "recorded" });
    const [payment] = await stripePayments(client);
    expect(await sql("select amount_pence from akb_refunds where payment_id = $1", [payment.id])).toEqual([{ amount_pence: 300 }]);
  });

  it("ignores a refund of a payment that wasn't made through one of our links", async () => {
    const api = stripeApi();
    expect((await deliver(api, "refund.created", api.refund("pi_in_person", 500))).body).toEqual({ outcome: "unknown_payment" });
  });

  it("the portal can't refund or void a Stripe payment (that's done in Stripe), but still can for cash", async () => {
    const api = stripeApi();
    const { client, charge, sessionId } = await openLink(api, 1000);
    api.pay(sessionId);
    await deliver(api, "checkout.session.completed", sessionId);
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
  it("records payments whose webhook never arrived, retires expired links, without duplicating", async () => {
    const api = stripeApi();
    const paid = await openLink(api, 1000);
    const expired = await openLink(api, 1000);
    api.pay(paid.sessionId);
    api.setSession(expired.sessionId, { status: "expired" });
    const first = await reconcileOpenLinks(db, stripe, api.fetchImpl);
    expect(first.ok && first.recorded).toBeGreaterThanOrEqual(1);
    expect((await reconcileOpenLinks(db, stripe, api.fetchImpl)).recorded).toBe(0);
    expect(await stripePayments(paid.client)).toHaveLength(1);
    expect((await sql("select status from akb_stripe_payment_links where id = $1", [expired.linkId]))[0].status).toBe("cancelled");
  });
});

describe("access and logs", () => {
  it("public roles can't touch the Stripe tables or functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const relation of ["akb_stripe_payment_links", "akb_stripe_events"]) {
        await sql(`set role ${role}`);
        await expect(sql(`select * from ${relation} limit 1`), `${role} ${relation}`).rejects.toThrow(/permission denied/);
        await sql("reset role");
      }
    }
    const grants = await sql(
      `select proname, has_function_privilege('anon', oid, 'EXECUTE') as anon, has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated
       from pg_proc where proname in ('akb_apply_stripe_session', 'akb_apply_stripe_refund', 'akb_stripe_provider', 'akb_void_charge') order by 1`,
    );
    expect(grants).toHaveLength(4);
    for (const g of grants) expect(g).toMatchObject({ anon: false, authenticated: false });
    expect(await sql("select relname from pg_class where relname in ('akb_stripe_payment_links', 'akb_stripe_events') and not relrowsecurity")).toEqual([]);
  });

  it("never logs the secret key, signing secret or customer details", async () => {
    const api = stripeApi();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));
    const { sessionId } = await openLink(api);
    api.pay(sessionId);
    await deliver(api, "checkout.session.completed", sessionId);
    api.setDown(true);
    await deliver(api, "checkout.session.completed", sessionId);
    await createChargeLink(db, stripe, (await chargeFor()).charge, api.fetchImpl);
    await handleStripeWebhook(db, stripe, webhook, "{}", "bad", api.fetchImpl, NOW);
    const all = lines.join("\n");
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [stripe.secretKey, webhook.signingSecret, "@example.com"]) expect(all).not.toContain(secret);
  });
});

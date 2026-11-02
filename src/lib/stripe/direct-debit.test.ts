import { beforeAll, describe, expect, it } from "vitest";
import { rpc, type Db } from "../coach/db";
import { addDays, londonToday } from "../coach/time";
import { testDb } from "../coach/test-support";
import { sendRenewalLinks, startCheckout } from "../membership-checkout";
import type { MembershipRequest } from "../membership-request";
import { collectDirectDebits, notifyDirectDebitFailures, startDirectDebitSetup } from "./direct-debit";
import { deliverStripeEvent, stripeStandIn, testStripe } from "./test-support";

/**
 * Memberships by Direct Debit, end to end against the real migrations: pay the
 * first 4 weeks by card, set up a Direct Debit on Stripe's page, and each later
 * period is collected by it (submitted early, recorded when Bacs clears).
 * Failures are retried then pause the membership; cancelling stops it all.
 */

const stripe = testStripe;
const RESEND = "http://localhost:3299/emails";
const env = { RESEND_API_KEY: "re_test", BOOKING_NOTIFY_EMAIL: "alex@example.com", BOOKING_FROM_EMAIL: "RAENG <bookings@example.com>", RESEND_API_URL: RESEND, SITE_URL: "https://raeng.example" };

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;

function services() {
  const emails: { to: string[]; subject: string; text: string; key: string }[] = [];
  const api = stripeStandIn(async (url, init = {}) => {
    if (String(url) === RESEND) {
      const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string };
      const key = (init.headers as Record<string, string>)["Idempotency-Key"];
      if (!emails.some((e) => e.key === key)) emails.push({ ...body, key });
      return Response.json({ id: "email" });
    }
    return db.fetchImpl(url, init);
  });
  return { api, emails, fetchImpl: api.fetchImpl };
}

function request(plan: string): MembershipRequest {
  n += 1;
  return { plan, session: "", classDate: "", experience: "new", name: `DD Member ${n}`, email: `dd${n}@example.com`, phone: "", message: "", submissionId: `dd-sub-${n}` } as unknown as MembershipRequest;
}

/** A member who has paid their first period by card. */
async function paidMember(s: ReturnType<typeof services>, plan = "regular", pence = 6500) {
  const data = request(plan);
  const out = await startCheckout(db, stripe, data, null, { agreedAt: new Date().toISOString(), idempotencyKey: `dd-join-${n}`, env, fetchImpl: s.fetchImpl });
  if (!out.ok) throw new Error(out.reason);
  const [{ square_order_id: sessionId }] = (await sql("select l.square_order_id from akb_square_payment_links l join akb_membership_signups g on g.charge_id = l.charge_id where g.id = $1", [out.signupId])) as { square_order_id: string }[];
  s.api.pay(sessionId, pence);
  await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId });
  const [row] = (await sql("select membership_id, client_id from akb_membership_signups where id = $1", [out.signupId])) as { membership_id: string; client_id: string }[];
  return { ...row, email: data.email, name: data.name, membership: row.membership_id, client: row.client_id };
}

async function setUpDirectDebit(s: ReturnType<typeof services>, m: Awaited<ReturnType<typeof paidMember>>) {
  const res = await startDirectDebitSetup(db, stripe, { clientId: m.client, email: m.email, name: m.name }, "https://raeng.example/account", s.fetchImpl);
  if (!res.ok) throw new Error(res.reason);
  const sessionId = res.url.split("/").pop()!;
  s.api.completeSetup(sessionId);
  await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId });
  return sessionId;
}

/** The payment-intent calls made for this member's periods (the test database is shared, so other members' collections are left out). */
async function intentCalls(s: ReturnType<typeof services>, m: { membership: string }) {
  const periods = (await sql("select id from akb_membership_periods where membership_id = $1", [m.membership])).map((r) => String(r.id));
  return s.api.calls.filter((c) => c.path === "/v1/payment_intents" && c.method === "POST" && periods.includes(c.form.get("metadata[period]") ?? ""));
}

/** Moves the member's next period to `days` from today and lets the first period end before it. */
async function dueIn(m: { membership: string }, days: number) {
  await sql("update akb_membership_periods set period_start = $2::date - 28, period_end = $2::date - 1 where membership_id = $1", [m.membership, addDays(londonToday(), days)]);
  await sql("update akb_memberships set next_period_on = $2 where id = $1", [m.membership, addDays(londonToday(), days)]);
}

beforeAll(async () => {
  ({ db, sql } = await testDb());
  await sql("insert into akb_database_role (role) values ('test')");
}, 60_000);

describe("setting up the Direct Debit", () => {
  it("opens Stripe's Bacs set-up page for a customer, and records the mandate only from Stripe's signed word", async () => {
    const s = services();
    const m = await paidMember(s);
    // The first payment kept the member's card, so a method is already on file: it is a card until the Direct Debit replaces it.
    expect(await rpc(db, "akb_payment_method_info", { p_client: m.client })).toMatchObject({ ok: true, data: { status: "active", method: "card" } });
    const res = await startDirectDebitSetup(db, stripe, { clientId: m.client, email: m.email, name: m.name }, "https://raeng.example/account", s.fetchImpl);
    expect(res.ok && res.url).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/setup\/cs_test_\d+$/);
    const setup = s.api.calls.filter((c) => c.method === "POST" && c.path === "/v1/checkout/sessions").pop()!.form;
    expect(setup.get("mode")).toBe("setup");
    expect(setup.get("payment_method_types[0]")).toBe("bacs_debit");
    expect(setup.get("currency")).toBe("gbp");
    expect(setup.get("client_reference_id")).toBe(m.client);
    expect(setup.get("customer")).toMatch(/^cus_test_/);
    expect(s.api.calls.find((c) => c.path === "/v1/customers")?.form.get("email")).toBe(m.email);
    // Opening the page isn't set-up: the card stays the method until Stripe says the Direct Debit is.
    expect(await rpc(db, "akb_payment_method_info", { p_client: m.client })).toMatchObject({ data: { method: "card" } });

    const sessionId = (res.ok ? res.url : "").split("/").pop()!;
    s.api.completeSetup(sessionId);
    expect((await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId })).body).toEqual({ outcome: "active" });
    expect(await rpc(db, "akb_payment_method_info", { p_client: m.client })).toMatchObject({ data: { status: "active", method: "bacs", label: "" } });
    // Already set up: no second page.
    expect(await startDirectDebitSetup(db, stripe, { clientId: m.client, email: m.email, name: m.name }, "https://raeng.example/account", s.fetchImpl)).toEqual({ ok: false, reason: "already_set_up" });
  });

  it("a set-up page left unfinished leaves the member on their card", async () => {
    const s = services();
    const m = await paidMember(s);
    const res = await startDirectDebitSetup(db, stripe, { clientId: m.client, email: m.email, name: m.name }, "https://raeng.example/account", s.fetchImpl);
    const sessionId = (res.ok ? res.url : "").split("/").pop()!;
    expect((await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId })).body).toEqual({ outcome: "pending" });
    expect(await rpc(db, "akb_payment_method_info", { p_client: m.client })).toMatchObject({ data: { method: "card" } });
  });
});

describe("collecting each later period", () => {
  it("submits the next period early, records it when Bacs clears, and gives its credits", async () => {
    const s = services();
    const m = await paidMember(s, "dedicated", 8500);
    await setUpDirectDebit(s, m);
    await dueIn(m, 3); // the next period starts in 3 days: inside the 6-day lead

    const first = await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(first).toMatchObject({ ok: true, periodsCreated: 1 });
    expect(first.submitted).toBeGreaterThanOrEqual(1);
    const post = (await intentCalls(s, m)).pop()!;
    expect(post.form.get("amount")).toBe("8500");
    expect(post.form.get("currency")).toBe("gbp");
    expect(post.form.get("payment_method_types[0]")).toBe("bacs_debit");
    expect(post.form.get("off_session")).toBe("true");
    expect(post.form.get("confirm")).toBe("true");
    const [col] = await sql("select c.status, c.attempts, c.payment_intent_id from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership]);
    expect(col).toMatchObject({ status: "submitted", attempts: 1 });
    // In flight: running again submits nothing more.
    const calls = s.api.calls.length;
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(1);
    expect(s.api.calls.length).toBeGreaterThanOrEqual(calls);

    // Nothing is recorded until Stripe says it cleared.
    const intent = String(col.payment_intent_id);
    expect((await deliverStripeEvent(db, s.api, "payment_intent.succeeded", { id: intent })).body).toEqual({ outcome: "pending" });
    s.api.succeedIntent(intent);
    expect((await deliverStripeEvent(db, s.api, "payment_intent.succeeded", { id: intent })).body).toEqual({ outcome: "recorded" });
    expect(await sql("select provider, method, amount_pence from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ provider: "stripe_test", method: "card", amount_pence: 8500 }]);
    expect(await sql("select status from akb_dd_collections where payment_intent_id = $1", [intent])).toEqual([{ status: "succeeded" }]);
    const unpaid = await sql("select count(*)::int as n from akb_membership_periods p join akb_charge_balances b on b.id = p.charge_id where p.membership_id = $1 and b.outstanding_pence > 0", [m.membership]);
    expect(unpaid).toEqual([{ n: 0 }]);
    // A repeated event records nothing twice, and nothing more is collected.
    expect((await deliverStripeEvent(db, s.api, "payment_intent.succeeded", { id: intent })).body).toEqual({ outcome: "duplicate" });
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(1);
  });

  it("a Direct Debit member isn't sent a card pay link", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    await dueIn(m, 0);
    await rpc(db, "akb_renew_memberships", { p_today: londonToday() });
    const sent = await sendRenewalLinks(db, stripe, londonToday(), env, s.fetchImpl);
    expect(s.emails.filter((e) => e.to[0] === m.email)).toHaveLength(0);
    expect(sent.failed).toBe(0);
  });

  it("only collects ahead for members who have a Direct Debit", async () => {
    const s = services();
    const m = await paidMember(s);
    await dueIn(m, 3);
    const res = await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(res.ok).toBe(true);
    expect(await sql("select count(*)::int as n from akb_membership_periods where membership_id = $1", [m.membership])).toEqual([{ n: 1 }]);
  });
});

describe("failed collections", () => {
  it("retries a failed collection after three days, then pauses the membership and tells the member and Alex", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    await dueIn(m, 2);
    const today = londonToday();
    const intents: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const day = addDays(today, (attempt - 1) * 3);
      await collectDirectDebits(db, stripe, day, s.fetchImpl);
      const [col] = await sql("select payment_intent_id, attempts from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership]);
      expect(col.attempts).toBe(attempt);
      intents.push(String(col.payment_intent_id));
      const failed = await deliverStripeEvent(db, s.api, "payment_intent.payment_failed", { id: String(col.payment_intent_id) });
      expect(failed.body).toEqual({ outcome: attempt < 3 ? "failed" : "paused" });
    }
    expect(new Set(intents).size).toBe(3);
    expect((await sql("select status from akb_memberships where id = $1", [m.membership]))[0].status).toBe("paused");
    // Nothing more is collected from a paused membership.
    await collectDirectDebits(db, stripe, addDays(today, 12), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(3);

    expect(await notifyDirectDebitFailures(db, env, s.fetchImpl)).toBeGreaterThanOrEqual(1);
    const mail = s.emails.find((e) => e.to[0] === m.email && e.subject === "Your RAENG membership is paused");
    expect(mail?.text).toContain("tried three times");
    expect(s.emails.some((e) => e.subject === `Membership paused: ${m.name}`)).toBe(true);
    const before = s.emails.length;
    await notifyDirectDebitFailures(db, env, s.fetchImpl);
    expect(s.emails.length).toBe(before);
  });

  it("doesn't retry sooner than three days, and a refused collection counts as a failed try", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    await dueIn(m, 2);
    const today = londonToday();
    await collectDirectDebits(db, stripe, today, s.fetchImpl);
    const [col] = await sql("select payment_intent_id from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership]);
    await deliverStripeEvent(db, s.api, "payment_intent.payment_failed", { id: String(col.payment_intent_id) });
    await collectDirectDebits(db, stripe, addDays(today, 1), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(1);
    // Stripe refuses the next one outright (say the mandate was cancelled at the bank).
    s.api.refuseIntents(400);
    await collectDirectDebits(db, stripe, addDays(today, 3), s.fetchImpl);
    expect(await sql("select attempts, status from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership])).toEqual([{ attempts: 2, status: "failed" }]);
    // A Stripe outage (5xx) isn't a failed try: it is tried again tomorrow.
    s.api.refuseIntents(503);
    const down = await collectDirectDebits(db, stripe, addDays(today, 6), s.fetchImpl);
    expect(down.failed).toBeGreaterThanOrEqual(1);
    expect(await sql("select attempts from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership])).toEqual([{ attempts: 2 }]);
  });
});

describe("cancelling", () => {
  it("stops all further periods and collections; the credits already given stay", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    expect(await rpc(db, "akb_set_membership_status", { p_membership: m.membership, p_status: "cancelled", p_on: londonToday() })).toMatchObject({ ok: true });
    await dueIn(m, 2);
    const res = await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(res).toMatchObject({ ok: true, periodsCreated: 0, submitted: 0 });
    expect(await sql("select count(*)::int as n from akb_membership_periods where membership_id = $1", [m.membership])).toEqual([{ n: 1 }]);
    expect(await intentCalls(s, m)).toHaveLength(0);
  });
});

describe("refunds", () => {
  it("a Direct Debit payment refunded in Stripe is mirrored like a card payment", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    await dueIn(m, 2);
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    const [col] = await sql("select payment_intent_id from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership]);
    const intent = String(col.payment_intent_id);
    s.api.succeedIntent(intent);
    await deliverStripeEvent(db, s.api, "payment_intent.succeeded", { id: intent });
    s.api.refund(intent, 1000);
    expect((await deliverStripeEvent(db, s.api, "charge.refunded", { id: "ch_dd", payment_intent: intent })).body).toEqual({ outcome: "recorded" });
    expect((await sql("select count(*)::int as n from akb_refunds r join akb_payments p on p.id = r.payment_id where p.provider_payment_id = $1", [intent]))[0].n).toBe(1);
  });
});

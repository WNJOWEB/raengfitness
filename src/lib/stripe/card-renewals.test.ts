import { beforeAll, describe, expect, it } from "vitest";
import { rpc, type Db } from "../coach/db";
import { addDays, londonToday } from "../coach/time";
import { testDb } from "../coach/test-support";
import { notifyNewMembers, sendRenewalLinks, startCheckout } from "../membership-checkout";
import type { MembershipRequest } from "../membership-request";
import { collectDirectDebits, notifyDirectDebitFailures, notifyRenewalPayments, sendRenewalReminders, startCardUpdate, startDirectDebitSetup } from "./direct-debit";
import { reconcileOpenLinks } from "./sync";
import { deliverStripeEvent, stripeStandIn, testStripe } from "./test-support";

/**
 * Memberships that renew by saved card, end to end against the real
 * migrations: the first payment keeps the card (the member agrees on Stripe's
 * page), each later period is charged to it on the day it starts, the member
 * is emailed 5 days before and when it is paid, a failed charge is retried on
 * day 3 and day 7 and then pauses the membership, and cancelling stops it all.
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
  return { plan, session: "", classDate: "", experience: "new", name: `Card Member ${n}`, email: `card${n}@example.com`, phone: "", message: "", submissionId: `card-sub-${n}` } as unknown as MembershipRequest;
}

/** A member who has paid their first period on Stripe's page, which kept their card. */
async function joined(s: ReturnType<typeof services>, plan = "regular", pence = 6500) {
  const data = request(plan);
  const out = await startCheckout(db, stripe, data, null, { agreedAt: new Date().toISOString(), idempotencyKey: `card-join-${n}`, env, fetchImpl: s.fetchImpl });
  if (!out.ok) throw new Error(out.reason);
  const [{ square_order_id: sessionId }] = (await sql("select l.square_order_id from akb_square_payment_links l join akb_membership_signups g on g.charge_id = l.charge_id where g.id = $1", [out.signupId])) as { square_order_id: string }[];
  s.api.pay(sessionId, pence);
  const delivered = await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId });
  const [row] = (await sql("select membership_id, client_id from akb_membership_signups where id = $1", [out.signupId])) as { membership_id: string; client_id: string }[];
  return { signup: out.signupId, sessionId, delivered, email: data.email, name: data.name, membership: row.membership_id, client: row.client_id };
}

/** Moves the next period to `days` from today and lets the first period end before it. */
async function dueIn(m: { membership: string }, days: number) {
  await sql("update akb_membership_periods set period_start = $2::date - 28, period_end = $2::date - 1 where membership_id = $1", [m.membership, addDays(londonToday(), days)]);
  await sql("update akb_memberships set next_period_on = $2 where id = $1", [m.membership, addDays(londonToday(), days)]);
}

/** The payment-intent calls made for this member's periods (the test database is shared, so other members' charges are left out). */
async function intentCalls(s: ReturnType<typeof services>, m: { membership: string }) {
  const periods = (await sql("select id from akb_membership_periods where membership_id = $1", [m.membership])).map((r) => String(r.id));
  return s.api.calls.filter((c) => c.path === "/v1/payment_intents" && c.method === "POST" && periods.includes(c.form.get("metadata[period]") ?? ""));
}

const info = (m: { client: string }) => rpc(db, "akb_payment_method_info", { p_client: m.client });

beforeAll(async () => {
  ({ db, sql } = await testDb());
  await sql("insert into akb_database_role (role) values ('test')");
}, 60_000);

describe("the first payment keeps the card", () => {
  it("asks for the member's agreement on Stripe's page and saves the card only from Stripe's signed word", async () => {
    const s = services();
    const data = request("regular");
    const out = await startCheckout(db, stripe, data, null, { agreedAt: new Date().toISOString(), idempotencyKey: `card-join-${n}`, env, fetchImpl: s.fetchImpl });
    expect(out.ok).toBe(true);
    const session = s.api.calls.filter((c) => c.method === "POST" && c.path === "/v1/checkout/sessions").pop()!.form;
    expect(session.get("payment_intent_data[setup_future_usage]")).toBe("off_session");
    expect(session.get("customer")).toMatch(/^cus_test_/);
    expect(session.get("customer_email")).toBeNull();
    expect(session.get("client_reference_id")).toMatch(/^[0-9a-f-]{36}$/);
    const consent = session.get("custom_text[submit][message]") ?? "";
    expect(consent).toContain("renews every 4 weeks until you cancel");
    expect(consent).toContain("£65");
    expect(consent).toContain("Cancel any time from your account");

    // Nothing is saved until the payment is verified.
    const [{ client_id: client }] = (await sql("select client_id from akb_membership_signups where id = $1", [out.ok ? out.signupId : ""])) as { client_id: string }[];
    expect(await info({ client })).toMatchObject({ data: { status: "pending", method: "bacs" } });
  });

  it("saves the card from the verified payment, and says so in the welcome email", async () => {
    const s = services();
    const m = await joined(s);
    expect(m.delivered.body).toEqual({ outcome: "recorded" });
    expect(await info(m)).toMatchObject({ ok: true, data: { status: "active", method: "card", label: "Visa ending 4242" } });
    expect(await notifyNewMembers(db, [], env, s.fetchImpl)).toBeGreaterThanOrEqual(1);
    const welcome = s.emails.find((e) => e.to[0] === m.email && e.subject.startsWith("Welcome to RAENG"));
    expect(welcome?.text).toContain("renews automatically every 4 weeks until you cancel");
    expect(welcome?.text).toContain("Visa ending 4242");
    expect(welcome?.text).toContain("5 days before");
    expect(welcome?.text).not.toContain("payment link");
    // The same event again changes nothing.
    expect((await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: m.sessionId })).body).toEqual({ outcome: "duplicate" });
  });

  it("a card saved while paying doesn't replace a Direct Debit the member already has", async () => {
    const s = services();
    const m = await joined(s);
    const res = await startDirectDebitSetup(db, stripe, { clientId: m.client, email: m.email, name: m.name }, "https://raeng.example/account", s.fetchImpl);
    const sessionId = (res.ok ? res.url : "").split("/").pop()!;
    s.api.completeSetup(sessionId);
    await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId });
    expect(await info(m)).toMatchObject({ data: { method: "bacs" } });
    const customer = (await sql("select customer_id from akb_stripe_customers where client_id = $1", [m.client]))[0].customer_id;
    expect(await rpc(db, "akb_card_set_method", { p_client: m.client, p_environment: "sandbox", p_customer: customer, p_method: "pm_other", p_label: "Visa ending 1111", p_replace: false })).toMatchObject({ data: "kept_direct_debit" });
    expect(await info(m)).toMatchObject({ data: { method: "bacs" } });
  });
});

describe("renewing", () => {
  it("charges the card on the day the period starts, not before, records it once and emails a receipt", async () => {
    const s = services();
    const m = await joined(s, "dedicated", 8500);
    await dueIn(m, 3);
    // Three days ahead: a card isn't charged yet.
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(0);

    await dueIn(m, 0);
    await rpc(db, "akb_renew_memberships", { p_today: londonToday() });
    const run = await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(run.ok).toBe(true);
    const calls = await intentCalls(s, m);
    expect(calls).toHaveLength(1);
    expect(calls[0].form.get("amount")).toBe("8500");
    expect(calls[0].form.get("currency")).toBe("gbp");
    expect(calls[0].form.get("payment_method_types[0]")).toBe("card");
    expect(calls[0].form.get("off_session")).toBe("true");
    expect(calls[0].form.get("confirm")).toBe("true");
    expect(calls[0].form.get("customer")).toMatch(/^cus_test_/);

    // A card answers at once: it is recorded without waiting for a webhook.
    const [col] = await sql("select c.status, c.payment_intent_id from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership]);
    expect(col.status).toBe("succeeded");
    const intent = String(col.payment_intent_id);
    expect(await sql("select provider, method, amount_pence from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ provider: "stripe_test", method: "card", amount_pence: 8500 }]);
    // Stripe's own webhook arriving afterwards, and the next daily run, record and charge nothing more.
    expect((await deliverStripeEvent(db, s.api, "payment_intent.succeeded", { id: intent })).body).toEqual({ outcome: "duplicate" });
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(1);
    expect(await sql("select count(*)::int as n from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ n: 1 }]);

    expect(await notifyRenewalPayments(db, env, s.fetchImpl)).toBeGreaterThanOrEqual(1);
    const receipt = s.emails.find((e) => e.to[0] === m.email && e.subject === "Your RAENG membership has renewed");
    expect(receipt?.text).toContain("£85");
    expect(receipt?.text).toContain("Visa ending 4242");
    expect(s.emails.some((e) => e.subject === `Membership renewed: ${m.name}`)).toBe(true);
    const before = s.emails.length;
    await notifyRenewalPayments(db, env, s.fetchImpl);
    expect(s.emails.length).toBe(before);
  });

  it("a collection whose webhook never arrived is found by the daily reconcile", async () => {
    const s = services();
    const m = await joined(s);
    const res = await startDirectDebitSetup(db, stripe, { clientId: m.client, email: m.email, name: m.name }, "https://raeng.example/account", s.fetchImpl);
    const setupId = (res.ok ? res.url : "").split("/").pop()!;
    s.api.completeSetup(setupId);
    await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: setupId });
    await dueIn(m, 3);
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    const [col] = await sql("select c.payment_intent_id from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership]);
    const intent = String(col.payment_intent_id);
    expect(await sql("select count(*)::int as n from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ n: 0 }]);
    // Bacs cleared, but no webhook came: the reconcile reads the payment from Stripe and records it, once.
    s.api.succeedIntent(intent);
    // (The test database is shared, so open links of other tests' members may not be readable here: only this one is checked.)
    const summary = await reconcileOpenLinks(db, stripe, s.fetchImpl);
    expect(summary.recorded).toBeGreaterThanOrEqual(1);
    expect(await sql("select count(*)::int as n from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ n: 1 }]);
    await reconcileOpenLinks(db, stripe, s.fetchImpl);
    expect(await sql("select count(*)::int as n from akb_payments where provider_payment_id = $1", [intent])).toEqual([{ n: 1 }]);
  });

  it("members with a saved card aren't sent a pay link", async () => {
    const s = services();
    const m = await joined(s);
    await dueIn(m, 0);
    await rpc(db, "akb_renew_memberships", { p_today: londonToday() });
    await sendRenewalLinks(db, stripe, londonToday(), env, s.fetchImpl);
    expect(s.emails.filter((e) => e.to[0] === m.email && e.subject.includes("has renewed"))).toHaveLength(0);
  });

  it("a member without a saved card gets a pay link that keeps their card when they pay it", async () => {
    const s = services();
    const m = await joined(s);
    // An existing member from before saved cards: nothing on file.
    await sql("update akb_stripe_customers set dd_status = 'pending', payment_method_id = null, card_label = '' where client_id = $1", [m.client]);
    await dueIn(m, 0);
    await rpc(db, "akb_renew_memberships", { p_today: londonToday() });
    const sent = await sendRenewalLinks(db, stripe, londonToday(), env, s.fetchImpl);
    expect(sent.failed).toBe(0);
    const mail = s.emails.find((e) => e.to[0] === m.email && e.subject.includes("has renewed"));
    expect(mail?.text).toContain("also saves your card");
    expect(mail?.text).toContain("cancel any time from your account");
    const session = s.api.calls.filter((c) => c.method === "POST" && c.path === "/v1/checkout/sessions").pop()!.form;
    expect(session.get("payment_intent_data[setup_future_usage]")).toBe("off_session");
    expect(session.get("custom_text[submit][message]")).toContain("renews every 4 weeks until you cancel");
    const sessionId = mail!.text.match(/cs_test_\d+/)![0];
    s.api.pay(sessionId, 6500);
    await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId });
    expect(await info(m)).toMatchObject({ data: { status: "active", method: "card", label: "Visa ending 4242" } });
  });
});

describe("the reminder", () => {
  it("emails card members 5 days before the renewal, once per renewal date", async () => {
    const s = services();
    const m = await joined(s, "starter", 4000);
    await sql("update akb_memberships set next_period_on = $2 where id = $1", [m.membership, addDays(londonToday(), 6)]);
    expect(await sendRenewalReminders(db, stripe, londonToday(), env, s.fetchImpl)).toBe(0);
    const reminders = () => s.emails.filter((e) => e.to[0] === m.email && e.subject.startsWith("Your RAENG membership renews on"));
    expect(reminders()).toHaveLength(0);

    const day = addDays(londonToday(), 1); // now 5 days to go
    expect(await sendRenewalReminders(db, stripe, day, env, s.fetchImpl)).toBeGreaterThanOrEqual(1);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0].text).toContain("£40");
    expect(reminders()[0].text).toContain("Visa ending 4242");
    expect(reminders()[0].text).toContain("cancel before then");
    // Not again, today or tomorrow.
    await sendRenewalReminders(db, stripe, day, env, s.fetchImpl);
    await sendRenewalReminders(db, stripe, addDays(day, 1), env, s.fetchImpl);
    expect(reminders()).toHaveLength(1);
  });

  it("doesn't remind a cancelled membership or a member with no saved card", async () => {
    const s = services();
    const cancelled = await joined(s);
    const bare = await joined(s);
    await sql("update akb_memberships set next_period_on = $2 where id = any($1::uuid[])", [[cancelled.membership, bare.membership], addDays(londonToday(), 3)]);
    await rpc(db, "akb_set_membership_status", { p_membership: cancelled.membership, p_status: "cancelled", p_on: londonToday() });
    await sql("update akb_stripe_customers set dd_status = 'pending', payment_method_id = null where client_id = $1", [bare.client]);
    await sendRenewalReminders(db, stripe, londonToday(), env, s.fetchImpl);
    expect(s.emails.filter((e) => [cancelled.email, bare.email].includes(e.to[0]) && e.subject.startsWith("Your RAENG membership renews on"))).toHaveLength(0);
  });
});

describe("a charge that fails", () => {
  it("is retried on day 3 and day 7, then pauses the membership and tells the member and Alex", async () => {
    const s = services();
    const m = await joined(s);
    await dueIn(m, 0);
    await rpc(db, "akb_renew_memberships", { p_today: londonToday() });
    const today = londonToday();
    s.api.refuseIntents(402); // the card is declined

    const attempt = async (day: number) => collectDirectDebits(db, stripe, addDays(today, day), s.fetchImpl);
    await attempt(0);
    expect(await sql("select attempts, status from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership])).toEqual([{ attempts: 1, status: "failed" }]);
    await attempt(1);
    await attempt(2);
    expect(await intentCalls(s, m)).toHaveLength(1);
    await attempt(3);
    expect(await sql("select attempts from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership])).toEqual([{ attempts: 2 }]);
    // The third try waits four more days: day 7, not day 6.
    await attempt(6);
    expect(await intentCalls(s, m)).toHaveLength(2);
    await attempt(7);
    expect(await intentCalls(s, m)).toHaveLength(3);
    expect((await sql("select status from akb_memberships where id = $1", [m.membership]))[0].status).toBe("paused");
    await attempt(12);
    expect(await intentCalls(s, m)).toHaveLength(3);

    expect(await notifyDirectDebitFailures(db, env, s.fetchImpl)).toBeGreaterThanOrEqual(1);
    const paused = s.emails.find((e) => e.to[0] === m.email && e.subject === "Your RAENG membership is paused");
    expect(paused?.text).toContain("tried three times");
    expect(paused?.text).toContain("from your card (Visa ending 4242)");
    expect(s.emails.some((e) => e.subject === `Membership paused: ${m.name}`)).toBe(true);
  });

  it("tells the member how to fix it before the next try", async () => {
    const s = services();
    const m = await joined(s);
    await dueIn(m, 0);
    await rpc(db, "akb_renew_memberships", { p_today: londonToday() });
    s.api.refuseIntents(402);
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    await notifyDirectDebitFailures(db, env, s.fetchImpl);
    const mail = s.emails.find((e) => e.to[0] === m.email && e.subject === "Your RAENG membership payment didn't go through");
    expect(mail?.text).toContain("We'll try again in 3 days");
    expect(mail?.text).toContain("pay the amount from your account");
    expect(mail?.text).toContain("also saves the new card");
    expect(mail?.text).toContain("https://raeng.example/account");
    const before = s.emails.length;
    await notifyDirectDebitFailures(db, env, s.fetchImpl);
    expect(s.emails.length).toBe(before);
  });

  it("a Stripe outage isn't a failed try: it is tried again tomorrow", async () => {
    const s = services();
    const m = await joined(s);
    await dueIn(m, 0);
    await rpc(db, "akb_renew_memberships", { p_today: londonToday() });
    s.api.refuseIntents(503);
    const down = await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(down.failed).toBeGreaterThanOrEqual(1);
    expect(await sql("select count(*)::int as n from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership])).toEqual([{ n: 0 }]);
    s.api.refuseIntents(0);
    await collectDirectDebits(db, stripe, addDays(londonToday(), 1), s.fetchImpl);
    expect(await sql("select status from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership])).toEqual([{ status: "succeeded" }]);
  });
});

describe("changing the card", () => {
  it("opens a card page with the agreement, saves the new card from Stripe's word, and retries a failed charge at the next run", async () => {
    const s = services();
    const m = await joined(s);
    await dueIn(m, 0);
    await rpc(db, "akb_renew_memberships", { p_today: londonToday() });
    s.api.refuseIntents(402);
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    s.api.refuseIntents(0);
    // Too soon to retry (day 3), unless the card changes.
    await collectDirectDebits(db, stripe, addDays(londonToday(), 1), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(1);

    const res = await startCardUpdate(db, stripe, { clientId: m.client, email: m.email, name: m.name }, 6500, "https://raeng.example/account/plan?done=card_updated", s.fetchImpl);
    expect(res.ok && res.url).toMatch(/\/setup\/cs_test_\d+$/);
    const setup = s.api.calls.filter((c) => c.method === "POST" && c.path === "/v1/checkout/sessions").pop()!.form;
    expect(setup.get("mode")).toBe("setup");
    expect(setup.get("payment_method_types[0]")).toBe("card");
    expect(setup.get("currency")).toBeNull();
    expect(setup.get("custom_text[submit][message]")).toContain("£65");
    // Opening the page changes nothing.
    expect(await info(m)).toMatchObject({ data: { label: "Visa ending 4242" } });

    const sessionId = (res.ok ? res.url : "").split("/").pop()!;
    s.api.completeSetup(sessionId);
    await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId });
    expect(await info(m)).toMatchObject({ data: { status: "active", method: "card", label: "Mastercard ending 4444" } });

    await collectDirectDebits(db, stripe, addDays(londonToday(), 1), s.fetchImpl);
    const calls = await intentCalls(s, m);
    expect(calls).toHaveLength(2);
    expect(await sql("select status, attempts from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership])).toEqual([{ status: "succeeded", attempts: 2 }]);
  });

  it("a member with a Direct Debit set up isn't charged a card", async () => {
    const s = services();
    const m = await joined(s);
    const res = await startDirectDebitSetup(db, stripe, { clientId: m.client, email: m.email, name: m.name }, "https://raeng.example/account", s.fetchImpl);
    const sessionId = (res.ok ? res.url : "").split("/").pop()!;
    s.api.completeSetup(sessionId);
    await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: sessionId });
    await dueIn(m, 3);
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    const calls = await intentCalls(s, m);
    expect(calls).toHaveLength(1);
    expect(calls[0].form.get("payment_method_types[0]")).toBe("bacs_debit");
  });
});

describe("cancelling", () => {
  it("stops the charges and the periods; the credits already given stay", async () => {
    const s = services();
    const m = await joined(s);
    expect(await rpc(db, "akb_set_membership_status", { p_membership: m.membership, p_status: "cancelled", p_on: londonToday() })).toMatchObject({ ok: true });
    await dueIn(m, 0);
    const res = await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(res.ok).toBe(true);
    expect(await intentCalls(s, m)).toHaveLength(0);
    expect(await sql("select count(*)::int as n from akb_membership_periods where membership_id = $1", [m.membership])).toEqual([{ n: 1 }]);
  });
});

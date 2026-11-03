import { beforeAll, describe, expect, it } from "vitest";
import { rpc, type Db } from "../coach/db";
import { addDays, londonToday } from "../coach/time";
import { testDb } from "../coach/test-support";
import { beginSignupDirectDebit, sendRenewalLinks, startCheckout } from "../membership-checkout";
import { createChargeLink } from "./sync";
import type { MembershipRequest } from "../membership-request";
import { canRestartMembership, cancelOwnMembership, collectDirectDebits, restartOwnMembership, endUnusedDirectDebit, endUnusedDirectDebits, notifyDirectDebitFailures, startDirectDebitSetup } from "./direct-debit";
import { notifyDirectDebitSetUp } from "./dd-notice";
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

describe("the confirmation email", () => {
  it("emails the member and Alex once when the Direct Debit is set up, with the amount, the Guarantee and how to stop it", async () => {
    const s = services();
    const m = await paidMember(s, "dedicated", 8500);
    await setUpDirectDebit(s, m);
    await notifyDirectDebitSetUp(db, m.client, "seti_demo_1", env, s.fetchImpl);
    const mail = s.emails.find((e) => e.to[0] === m.email && e.subject === "Your RAENG Direct Debit is set up");
    expect(mail?.text).toContain("£85 every 4 weeks for your Dedicated membership");
    expect(mail?.text).toContain("Direct Debit Guarantee");
    expect(mail?.text).toContain("https://raeng.example/account/plan");
    expect(mail?.text).toContain("Cancel before a payment is collected to stop that one.");
    expect(s.emails.some((e) => e.subject === `Direct Debit set up: ${m.name}`)).toBe(true);
    // The same set-up again (a repeated webhook) sends nothing more.
    const before = s.emails.length;
    await notifyDirectDebitSetUp(db, m.client, "seti_demo_1", env, s.fetchImpl);
    expect(s.emails.length).toBe(before);
  });
});

describe("the forward to the bank page after paying", () => {
  const on = { ...env, STRIPE_SECRET_KEY: "sk_test_not_real", DIRECT_DEBIT_ENABLED: "true" };

  it("opens Stripe's Direct Debit page for a paid sign-up, and leaving it unfinished comes back marked skipped", async () => {
    const s = services();
    const m = await paidMember(s);
    const [{ id: signup }] = (await sql("select id from akb_membership_signups where client_id = $1", [m.client])) as { id: string }[];
    const next = await beginSignupDirectDebit(db, stripe, signup, on, s.fetchImpl);
    expect(next.external).toBe(true);
    expect(next.url).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/setup\/cs_test_\d+$/);
    const setup = s.api.calls.filter((c) => c.method === "POST" && c.path === "/v1/checkout/sessions").pop()!.form;
    expect(setup.get("mode")).toBe("setup");
    expect(setup.get("success_url")).toBe(`https://raeng.example/memberships/join/done?signup=${signup}&dd=returned`);
    expect(setup.get("cancel_url")).toBe(`https://raeng.example/memberships/join/done?signup=${signup}&dd=skipped`);
  });

  it("goes back to the done page with a reason when it can't: unknown sign-up, nothing paid, or Direct Debit off", async () => {
    const s = services();
    const m = await paidMember(s);
    const [{ id: signup }] = (await sql("select id from akb_membership_signups where client_id = $1", [m.client])) as { id: string }[];
    const unknown = await beginSignupDirectDebit(db, stripe, "00000000-0000-4000-8000-000000000000", on, s.fetchImpl);
    expect(unknown).toEqual({ url: "https://raeng.example/memberships/join/done?signup=00000000-0000-4000-8000-000000000000&dd=unavailable", external: false });
    const off = await beginSignupDirectDebit(db, stripe, signup, env, s.fetchImpl);
    expect(off).toEqual({ url: `https://raeng.example/memberships/join/done?signup=${signup}&dd=unavailable`, external: false });
    const none = await beginSignupDirectDebit(null, stripe, signup, on, s.fetchImpl);
    expect(none.external).toBe(false);
    // Already set up: back to the page, which says so.
    await setUpDirectDebit(s, m);
    const again = await beginSignupDirectDebit(db, stripe, signup, on, s.fetchImpl);
    expect(again).toEqual({ url: `https://raeng.example/memberships/join/done?signup=${signup}&dd=done`, external: false });
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

  it("paying what's owed restarts the paused membership by itself (owner, 2026-11-03)", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    await dueIn(m, 2);
    const today = londonToday();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await collectDirectDebits(db, stripe, addDays(today, (attempt - 1) * 3), s.fetchImpl);
      const [col] = await sql("select payment_intent_id from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership]);
      await deliverStripeEvent(db, s.api, "payment_intent.payment_failed", { id: String(col.payment_intent_id) });
    }
    expect((await sql("select status from akb_memberships where id = $1", [m.membership]))[0].status).toBe("paused");
    await notifyDirectDebitFailures(db, env, s.fetchImpl);
    expect(s.emails.find((e) => e.to[0] === m.email && e.subject === "Your RAENG membership is paused")?.text).toContain("pay what's owed from your account and it restarts straight away");

    // The Plan page's payment: a Stripe page for the owed period (not "being collected").
    await sql("update akb_membership_periods set period_start = $2::date - 1, period_end = $2::date + 26 where membership_id = $1 and period_start > $2::date - 20", [m.membership, today]);
    const due = await rpc<{ charge_id: string; outstanding_pence: number }>(db, "akb_member_payment_due", { p_client: m.client });
    if (!due.ok || !due.data) throw new Error("nothing due");
    // As the Plan page makes it (paymentDue), through the Stripe stand-in: a page to pay, not "being collected".
    const link = await createChargeLink(db, stripe, due.data.charge_id, s.fetchImpl, { renewal: { clientId: m.client, email: m.email, name: m.name } });
    if (!link.ok) throw new Error(`no link: ${link.reason}`);
    const session = link.url.split("/").pop()!;
    s.api.pay(session, due.data.outstanding_pence);
    expect((await deliverStripeEvent(db, s.api, "checkout.session.completed", { id: session })).status).toBe(200);
    expect((await sql("select status from akb_memberships where id = $1", [m.membership]))[0].status).toBe("active");
    expect(await sql("select count(*)::int as n from akb_events where entity_id = $1 and action = 'resumed_after_payment'", [m.membership])).toEqual([{ n: 1 }]);
    expect(await sql("select paused from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership])).toEqual([{ paused: false }]);
  });

  it("a pause Alex set himself isn't lifted by a payment", async () => {
    const s = services();
    const m = await paidMember(s);
    expect((await rpc<null>(db, "akb_set_membership_status", { p_membership: m.membership, p_status: "paused", p_on: londonToday() })).ok).toBe(true);
    const [p] = await sql("select charge_id from akb_membership_periods where membership_id = $1", [m.membership]);
    // Something allocated to the (already paid) period changes nothing.
    await sql("update akb_payment_allocations set amount_pence = amount_pence where charge_id = $1", [p.charge_id]);
    expect((await sql("select status from akb_memberships where id = $1", [m.membership]))[0].status).toBe("paused");
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

describe("cancelling the membership cancels the Direct Debit (owner, 2026-11-03)", () => {
  const ddRow = async (client: string) => (await sql("select dd_status, method from akb_stripe_customers where client_id = $1", [client]))[0];
  const detaches = (s: ReturnType<typeof services>) => s.api.calls.filter((c) => c.method === "POST" && /\/v1\/payment_methods\/[\w-]+\/detach$/.test(c.path));

  it("detaches the Bacs method at Stripe (which cancels the mandate), marks it ended and logs it, once", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    // While the membership runs, nothing is ended.
    expect(await endUnusedDirectDebit(db, stripe, m.client, s.fetchImpl)).toBe("kept");
    expect(detaches(s)).toHaveLength(0);

    expect(await cancelOwnMembership(db, m.client, londonToday())).toMatchObject({ ok: true });
    expect(await endUnusedDirectDebit(db, stripe, m.client, s.fetchImpl)).toBe("ended");
    expect(detaches(s)).toHaveLength(1);
    expect(await ddRow(m.client)).toEqual({ dd_status: "ended", method: "bacs" });
    expect(await sql("select detail->>'reason' as reason from akb_events where client_id = $1 and action = 'direct_debit_ended'", [m.client])).toEqual([{ reason: "membership_cancelled" }]);
    // Again (the daily job, a double tap): nothing more.
    expect(await endUnusedDirectDebit(db, stripe, m.client, s.fetchImpl)).toBe("kept");
    expect(detaches(s)).toHaveLength(1);
    // And nothing is collected for a cancelled membership.
    await dueIn(m, 3);
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(0);
  });

  it("a collection still on its way through Bacs is left to finish; the daily job ends the Direct Debit once it has", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    await dueIn(m, 3);
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    const [col] = await sql("select c.payment_intent_id from akb_dd_collections c join akb_membership_periods p on p.id = c.period_id where p.membership_id = $1", [m.membership]);
    expect(await cancelOwnMembership(db, m.client, londonToday())).toMatchObject({ ok: true });
    expect(await endUnusedDirectDebit(db, stripe, m.client, s.fetchImpl)).toBe("kept");
    expect(await ddRow(m.client)).toMatchObject({ dd_status: "active" });

    const intent = String(col.payment_intent_id);
    s.api.succeedIntent(intent);
    await deliverStripeEvent(db, s.api, "payment_intent.succeeded", { id: intent });
    expect(await endUnusedDirectDebits(db, stripe, s.fetchImpl)).toBeGreaterThanOrEqual(1);
    expect(await ddRow(m.client)).toMatchObject({ dd_status: "ended" });
  });

  it("if Stripe can't be reached it stays as it was, and the daily job tries again", async () => {
    const s = services();
    const m = await paidMember(s);
    await setUpDirectDebit(s, m);
    expect(await cancelOwnMembership(db, m.client, londonToday())).toMatchObject({ ok: true });
    s.api.setDown(true);
    expect(await endUnusedDirectDebit(db, stripe, m.client, s.fetchImpl)).toBe("failed");
    expect(await ddRow(m.client)).toMatchObject({ dd_status: "active" });
    s.api.setDown(false);
    expect(await endUnusedDirectDebits(db, stripe, s.fetchImpl)).toBeGreaterThanOrEqual(1);
    expect(await ddRow(m.client)).toMatchObject({ dd_status: "ended" });
  });

  it("a card member has nothing to end", async () => {
    const s = services();
    const m = await paidMember(s);
    expect(await cancelOwnMembership(db, m.client, londonToday())).toMatchObject({ ok: true });
    expect(await endUnusedDirectDebit(db, stripe, m.client, s.fetchImpl)).toBe("kept");
    expect(detaches(s)).toHaveLength(0);
  });
});

describe("restarting a cancelled membership from the account (owner, 2026-11-03)", () => {
  it("while the paid period runs: active again, credits kept, nothing charged, renews as before; once only", async () => {
    const s = services();
    const m = await paidMember(s);
    const [before] = await sql("select next_period_on::text as next from akb_memberships where id = $1", [m.membership]);
    await sql("update akb_membership_periods set credits = 8 where membership_id = $1", [m.membership]);
    expect(await canRestartMembership(db, m.client)).toBe(false); // still active
    expect(await cancelOwnMembership(db, m.client, londonToday())).toMatchObject({ ok: true });
    expect(await canRestartMembership(db, m.client)).toBe(true);
    const payments = await sql("select count(*)::int as n from akb_payments where client_id = $1", [m.client]);

    expect(await restartOwnMembership(db, m.client)).toEqual({ ok: true, renewsOn: before.next });
    expect(await sql("select status, cancelled_on from akb_memberships where id = $1", [m.membership])).toEqual([{ status: "active", cancelled_on: null }]);
    expect(await sql("select credits_left from akb_membership_period_balances where membership_id = $1", [m.membership])).toEqual([{ credits_left: 8 }]);
    expect(await sql("select count(*)::int as n from akb_payments where client_id = $1", [m.client])).toEqual(payments);
    expect(await sql("select count(*)::int as n from akb_events where entity_id = $1 and action = 'restarted_by_member'", [m.membership])).toEqual([{ n: 1 }]);
    // A second tap does nothing more.
    expect(await restartOwnMembership(db, m.client)).toEqual({ ok: false });
    // Renewals carry on as for any active member.
    await setUpDirectDebit(s, m);
    await dueIn(m, 3);
    await collectDirectDebits(db, stripe, londonToday(), s.fetchImpl);
    expect(await intentCalls(s, m)).toHaveLength(1);
  });

  it("not once the period's payment was refunded (join again and pay instead)", async () => {
    const s = services();
    const m = await paidMember(s);
    expect(await cancelOwnMembership(db, m.client, londonToday())).toMatchObject({ ok: true });
    const [p] = await sql("select p.charge_id from akb_membership_periods p where p.membership_id = $1", [m.membership]);
    await rpc<null>(db, "akb_void_charge", { p_charge: p.charge_id, p_reason: "Membership cancelled and refunded" });
    expect(await canRestartMembership(db, m.client)).toBe(false);
    expect(await restartOwnMembership(db, m.client)).toEqual({ ok: false });
  });

  it("not once the period has ended", async () => {
    const s = services();
    const m = await paidMember(s);
    expect(await cancelOwnMembership(db, m.client, londonToday())).toMatchObject({ ok: true });
    await sql("update akb_membership_periods set period_start = $2::date - 28, period_end = $2::date - 1 where membership_id = $1", [m.membership, londonToday()]);
    expect(await canRestartMembership(db, m.client)).toBe(false);
  });
});

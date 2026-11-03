import { beforeAll, describe, expect, it } from "vitest";
import { publishedClasses, type PublishedClass } from "./class-sessions";
import { rpc, type Db } from "./coach/db";
import { addDays, londonToday, type DateKey } from "./coach/time";
import { testDb } from "./coach/test-support";
import { notifyNewMembers, sendRenewalLinks, signupStatus, startCheckout } from "./membership-checkout";
import type { MembershipRequest } from "./membership-request";
import { deliverStripeEvent, stripeStandIn, testStripe } from "./stripe/test-support";

/**
 * Joining and paying online, end to end against the real migrations: the
 * join creates a sign-up and a Stripe checkout; a signed webhook (re-read from
 * the Stripe stand-in) records the payment; the database starts the
 * membership; Alex and the member are emailed once; renewals email a pay link once.
 */

const stripe = testStripe;
const RESEND = "http://localhost:3299/emails";
const env = { RESEND_API_KEY: "re_test", BOOKING_NOTIFY_EMAIL: "alex@example.com", BOOKING_FROM_EMAIL: "RAENG <bookings@example.com>", RESEND_API_URL: RESEND, SITE_URL: "https://raeng.example" };

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;

/** Stripe and Resend stand-ins: checkout sessions (idempotent, like Stripe), payments, and sent emails. */
function services() {
  const emails: { to: string[]; subject: string; text: string; key: string }[] = [];
  const stripeApi = stripeStandIn(async (url, init = {}) => {
    if (String(url) === RESEND) {
      const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string };
      const key = (init.headers as Record<string, string>)["Idempotency-Key"];
      if (!emails.some((e) => e.key === key)) emails.push({ ...body, key });
      return Response.json({ id: "email" });
    }
    return db.fetchImpl(url, init);
  });
  return {
    fetchImpl: stripeApi.fetchImpl,
    stripeApi,
    /** The checkout sessions opened so far, as the form Stripe received. */
    get linkCalls() {
      return stripeApi.calls.filter((c) => c.method === "POST" && c.path === "/v1/checkout/sessions").map((c) => c.form);
    },
    emails,
    /** Pays a session; returns its id (what the webhook is about). */
    pay(sessionId: string, amount: number) {
      stripeApi.pay(sessionId, amount);
      return sessionId;
    },
  };
}

function deliver(api: ReturnType<typeof services>, sessionId: string) {
  return deliverStripeEvent(db, api.stripeApi, "checkout.session.completed", { id: sessionId });
}

/** The next date (2 to 8 days on) that a published class runs, so it's inside the first four weeks. */
function upcomingClass(): { cls: PublishedClass; date: DateKey } {
  const classes = publishedClasses();
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let i = 2; i < 9; i++) {
    const date = addDays(londonToday(), i);
    const day = names[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const cls = classes.find((c) => c.day === day);
    if (cls) return { cls, date };
  }
  throw new Error("no class in the next week");
}

let n = 0;
function request(extra: Partial<MembershipRequest> = {}): MembershipRequest {
  n += 1;
  return { plan: "regular", session: "", classDate: "", experience: "new", name: `Joiner ${n}`, email: `joiner${n}@example.com`, phone: "", message: "", submissionId: `sub-${n}`, ...extra } as MembershipRequest;
}

const orderFor = async (signupId: string) =>
  String((await sql("select l.square_order_id from akb_square_payment_links l join akb_membership_signups s on s.charge_id = l.charge_id where s.id = $1", [signupId]))[0].square_order_id);

beforeAll(async () => {
  ({ db, sql } = await testDb());
  await sql("insert into akb_database_role (role) values ('test')");
}, 60_000);

describe("joining and paying online", () => {
  it("opens Stripe's page for the plan's price from content, coming back to the site afterwards", async () => {
    const api = services();
    const data = request({ plan: "regular" });
    const out = await startCheckout(db, stripe, data, null, { agreedAt: new Date().toISOString(), idempotencyKey: `join-key-${n}`, env, fetchImpl: api.fetchImpl });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.url).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_\d+$/);
    const form = api.linkCalls[0];
    expect(form.get("line_items[0][price_data][product_data][name]")).toBe("Regular membership, first 4 weeks");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("6500");
    expect(form.get("line_items[0][price_data][currency]")).toBe("gbp");
    // The payment is made as the member's Stripe customer so the card can be kept for the renewals (with their agreement on the page).
    expect(form.get("customer")).toMatch(/^cus_test_/);
    expect(form.get("payment_intent_data[setup_future_usage]")).toBe("off_session");
    expect(form.get("custom_text[submit][message]")).toContain("renews every 4 weeks until you cancel");
    expect(form.get("success_url")).toBe(`https://raeng.example/memberships/join/done?signup=${out.signupId}`);
    // Nothing starts before Stripe confirms.
    expect(await signupStatus(db, out.signupId)).toMatchObject({ status: "awaiting_payment", plan_name: "Regular", payUrl: out.url });
    expect(await sql("select count(*)::int as n from akb_memberships m join akb_membership_signups s on s.client_id = m.client_id where s.id = $1", [out.signupId])).toEqual([{ n: 0 }]);
    // The same submission again opens the same link, with no second charge.
    const again = await startCheckout(db, stripe, data, null, { agreedAt: new Date().toISOString(), idempotencyKey: `join-key-${n}`, env, fetchImpl: api.fetchImpl });
    expect(again.ok && again.url).toBe(out.url);
  });

  it("starts the membership when Stripe's verified payment arrives, books the first class, and emails Alex and the member once", async () => {
    const api = services();
    const { cls, date } = upcomingClass();
    const data = request({ plan: "starter", session: cls.label, classDate: date });
    const out = await startCheckout(db, stripe, data, cls, { agreedAt: new Date().toISOString(), idempotencyKey: `join-key-${n}`, env, fetchImpl: api.fetchImpl });
    if (!out.ok) throw new Error(out.reason);

    const pid = api.pay(await orderFor(out.signupId), 4000);
    expect((await deliver(api, pid)).status).toBe(200);
    expect(await signupStatus(db, out.signupId)).toMatchObject({ status: "active", first_class: "booked", payUrl: null });
    const [m] = await sql("select m.pay_online, m.credits from akb_memberships m join akb_membership_signups s on s.membership_id = m.id where s.id = $1", [out.signupId]);
    expect(m).toEqual({ pay_online: true, credits: 4 });

    expect(await notifyNewMembers(db, publishedClasses(), env, api.fetchImpl)).toBe(1);
    expect(api.emails.map((x) => x.to[0])).toEqual(["alex@example.com", data.email]);
    expect(api.emails[0].subject).toBe(`New member: ${data.name} (Starter, paid online)`);
    expect(api.emails[1].text).toContain("Your first class is booked");
    expect(api.emails[1].text).toContain("https://raeng.example/account/sign-in");
    // Once only, however often it runs (webhook retries, the daily reconcile).
    expect(await notifyNewMembers(db, publishedClasses(), env, api.fetchImpl)).toBe(0);
    expect(api.emails).toHaveLength(2);
    // A repeated webhook records nothing twice.
    expect((await deliver(api, pid)).status).toBe(200);
    expect(await sql("select count(*)::int as n from akb_payments p join akb_membership_signups s on s.client_id = p.client_id where s.id = $1 and p.provider = 'stripe_test'", [out.signupId])).toEqual([{ n: 1 }]);
  });

  it("an existing member can't join twice", async () => {
    const api = services();
    const data = request();
    const out = await startCheckout(db, stripe, data, null, { agreedAt: new Date().toISOString(), idempotencyKey: `join-key-${n}`, env, fetchImpl: api.fetchImpl });
    if (!out.ok) throw new Error(out.reason);
    await deliver(api, api.pay(await orderFor(out.signupId), 6500));
    const second = await startCheckout(db, stripe, { ...data, submissionId: "another" }, null, { agreedAt: new Date().toISOString(), idempotencyKey: `join-key-${n}-b`, env, fetchImpl: api.fetchImpl });
    expect(second).toEqual({ ok: false, reason: "already_member" });
  });

  it("renewals: a pay link for each new period is emailed once, and the credits wait for it", async () => {
    const api = services();
    const data = request({ plan: "dedicated" });
    const out = await startCheckout(db, stripe, data, null, { agreedAt: new Date().toISOString(), idempotencyKey: `join-key-${n}`, env, fetchImpl: api.fetchImpl });
    if (!out.ok) throw new Error(out.reason);
    await deliver(api, api.pay(await orderFor(out.signupId), 8500));
    // Four weeks on: move the first period back and renew today.
    const [{ membership_id: mid, client_id: cid }] = (await sql("select membership_id, client_id from akb_membership_signups where id = $1", [out.signupId])) as { membership_id: string; client_id: string }[];
    await sql("update akb_membership_periods set period_start = period_start - 28, period_end = period_end - 28 where membership_id = $1", [mid]);
    await sql("update akb_memberships set next_period_on = $2 where id = $1", [mid, londonToday()]);
    // This member has no card on file (as members from before saved cards): they are sent a pay link. A member with a saved card is charged instead (card-renewals.test.ts).
    await sql("update akb_stripe_customers set dd_status = 'pending', payment_method_id = null, card_label = '' where client_id = $1", [cid]);
    expect(await rpc(db, "akb_renew_memberships", { p_today: londonToday() })).toMatchObject({ ok: true });
    expect(await rpc(db, "akb_member_payment_due", { p_client: cid })).toMatchObject({ ok: true, data: { outstanding_pence: 8500 } });

    const sent = await sendRenewalLinks(db, stripe, londonToday(), env, api.fetchImpl);
    expect(sent.sent).toBeGreaterThanOrEqual(1);
    const mail = api.emails.find((x) => x.to[0] === data.email);
    expect(mail?.subject).toBe("Your RAENG Dedicated membership has renewed");
    expect(mail?.text).toMatch(/Pay £85 securely with Stripe to use this period's credits:\nhttps:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_\d+/);
    const before = api.emails.length;
    await sendRenewalLinks(db, stripe, londonToday(), env, api.fetchImpl);
    expect(api.emails.length).toBe(before);
  });
});

describe("a Stripe refund of a membership's first period", () => {
  /** Joins and pays; returns what the refund and the checks need. */
  async function paidMember(api: ReturnType<typeof services>, withClass: boolean) {
    const first = withClass ? upcomingClass() : null;
    const data = request({ plan: "starter", ...(first ? { session: first.cls.label, classDate: first.date } : {}) });
    const out = await startCheckout(db, stripe, data, first?.cls ?? null, { agreedAt: new Date().toISOString(), idempotencyKey: `join-key-${n}`, env, fetchImpl: api.fetchImpl });
    if (!out.ok) throw new Error(out.reason);
    const session = await orderFor(out.signupId);
    const intent = api.stripeApi.pay(session, 4000);
    expect((await deliver(api, session)).status).toBe(200);
    const [row] = await sql(
      "select s.membership_id, s.charge_id, p.id as period_id from akb_membership_signups s join akb_membership_periods p on p.membership_id = s.membership_id where s.id = $1",
      [out.signupId],
    );
    return { intent, membership: String(row.membership_id), charge: String(row.charge_id), period: String(row.period_id), signupId: out.signupId };
  }
  const cancel = (membership: string) => rpc<null>(db, "akb_set_membership_status", { p_membership: membership, p_status: "cancelled", p_on: londonToday() });
  const refund = async (api: ReturnType<typeof services>, intent: string, amount: number) =>
    (await deliverStripeEvent(db, api.stripeApi, "refund.updated", { id: api.stripeApi.refund(intent, amount) })).body;
  const state = async (t: { charge: string; period: string }) => ({
    ...(await sql("select outstanding_pence, voided_at is not null as voided from akb_charge_balances where id = $1", [t.charge]))[0],
    ...(await sql("select credits, credits_left from akb_membership_period_balances where id = $1", [t.period]))[0],
  });

  it("cancelled, then refunded in full: nothing owed and the unused credits end, once", async () => {
    const api = services();
    const t = await paidMember(api, false);
    expect((await cancel(t.membership)).ok).toBe(true);
    const id = api.stripeApi.refund(t.intent, 4000);
    expect((await deliverStripeEvent(db, api.stripeApi, "refund.updated", { id })).body).toEqual({ outcome: "recorded" });
    expect((await deliverStripeEvent(db, api.stripeApi, "refund.updated", { id })).body).toEqual({ outcome: "duplicate" });
    expect(await state(t)).toEqual({ outstanding_pence: 0, voided: true, credits: 0, credits_left: 0 });
    expect(await sql("select detail->>'withdrawn' as withdrawn from akb_events where entity_id = $1 and action = 'credits_withdrawn'", [t.membership])).toEqual([{ withdrawn: "4" }]);
  });

  it("a credit already used (the first class) stays used; only the rest end", async () => {
    const api = services();
    const t = await paidMember(api, true);
    expect((await cancel(t.membership)).ok).toBe(true);
    expect(await refund(api, t.intent, 4000)).toEqual({ outcome: "recorded" });
    expect(await state(t)).toEqual({ outstanding_pence: 0, voided: true, credits: 1, credits_left: 0 });
  });

  it("refunded in part, or while the membership is still running: as before, the fee is owed again for the coach to decide", async () => {
    const api = services();
    const part = await paidMember(api, false);
    expect((await cancel(part.membership)).ok).toBe(true);
    expect(await refund(api, part.intent, 1000)).toEqual({ outcome: "recorded" });
    expect(await state(part)).toEqual({ outstanding_pence: 1000, voided: false, credits: 4, credits_left: 4 });

    const running = await paidMember(api, false);
    expect(await refund(api, running.intent, 4000)).toEqual({ outcome: "recorded" });
    expect(await state(running)).toEqual({ outstanding_pence: 4000, voided: false, credits: 4, credits_left: 4 });
  });

  it("the health and risk tick is kept with the sign-up once, without anything about health", async () => {
    const api = services();
    const t = await paidMember(api, false);
    const { recordJoinWaiver } = await import("./membership-checkout");
    await recordJoinWaiver(db, t.signupId, { version: "2026-10-31", at: "2026-11-03T12:00:00.000Z" });
    await recordJoinWaiver(db, t.signupId, { version: "2026-10-31", at: "2026-11-03T12:00:00.000Z" });
    expect(await sql("select entity, detail from akb_events where entity_id = $1 and action = 'waiver_accepted'", [t.signupId])).toEqual([
      { entity: "membership_signup", detail: { version: "2026-10-31", at: "2026-11-03T12:00:00.000Z" } },
    ]);
  });
});

import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bookingByToken, cancelByToken, classBookingStatus, creditStatus, notifyClassBookings, startClassCheckout } from "./class-checkout";
import { publishedClasses, type PublishedClass } from "./class-sessions";
import { rpc, type Db } from "./coach/db";
import { addDays, londonToday, type DateKey } from "./coach/time";
import { testDb } from "./coach/test-support";
import { refundCancelledClass, retryClassRefunds } from "./class-refunds";
import { cancelPaidPlace } from "./member-auth";
import { deliverStripeEvent, stripeStandIn, testStripe } from "./stripe/test-support";

/**
 * Booking a group class and paying online, end to end against the real
 * migrations: the booking holds a place and opens Stripe's page; a signed
 * webhook (re-read from the Stripe stand-in) records the payment; the database
 * confirms the place; the booker gets a private link to cancel, which (24
 * hours or more before) refunds the payment in full through Stripe (Alex,
 * 2026-11-05), or for a class booked with a class credit, gives the credit back.
 */

const stripe = testStripe;
const RESEND = "http://localhost:3299/emails";
const env = { RESEND_API_KEY: "re_test", BOOKING_NOTIFY_EMAIL: "alex@example.com", BOOKING_FROM_EMAIL: "RAENG <bookings@example.com>", RESEND_API_URL: RESEND, SITE_URL: "https://raeng.example" };

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;

/** Stripe and Resend stand-ins, as in membership-checkout.test.ts. */
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

/** Published classes from `from` days on, in date order. */
function classesFrom(from: number): { cls: PublishedClass; date: DateKey }[] {
  const classes = publishedClasses();
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const out: { cls: PublishedClass; date: DateKey }[] = [];
  for (let i = from; i < from + 14; i++) {
    const date = addDays(londonToday(), i);
    const day = names[new Date(`${date}T12:00:00Z`).getUTCDay()];
    for (const cls of classes.filter((c) => c.day === day)) out.push({ cls, date });
  }
  return out;
}

const orderFor = async (bookingId: string) =>
  String((await sql("select l.square_order_id from akb_square_payment_links l join akb_class_bookings b on b.charge_id = l.charge_id where b.id = $1", [bookingId]))[0].square_order_id);

const tokenFrom = (text: string, path: string) => new RegExp(`${path}\\?(?:token|credit)=([A-Za-z0-9_-]{43})`).exec(text)?.[1] ?? "";

/** What is owed on a charge, and whether it was cancelled. */
const owed = async (charge: string) =>
  (await sql("select outstanding_pence, voided_at is not null as voided from akb_charge_balances where id = $1", [charge]))[0];
const chargeOf = async (bookingId: string) => String((await sql("select charge_id from akb_class_bookings where id = $1", [bookingId]))[0].charge_id);
const refundCalls = (api: ReturnType<typeof services>) => api.stripeApi.calls.filter((c) => c.method === "POST" && c.path === "/v1/refunds");

/**
 * A booking cancelled the way it was before 2026-11-05 (a class credit for 28
 * days instead of a refund), for the credits customers still hold. Returns the
 * credit link's token.
 */
async function cancelledWithCredit(bookingId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const [k] = await sql("select client_id, attendance_id from akb_class_bookings where id = $1", [bookingId]);
  await sql("update akb_class_attendance set status = 'cancelled' where id = $1", [k.attendance_id]);
  await sql("update akb_class_bookings set status = 'cancelled' where id = $1", [bookingId]);
  await sql("insert into akb_class_credits (client_id, source_booking_id, expires_on, token_hash) values ($1, $2, akb_london_today() + 28, $3)", [
    k.client_id,
    bookingId,
    createHash("sha256").update(token).digest("hex"),
  ]);
  return token;
}

/**
 * A returning customer (one past class attended), so the first-class-free
 * offer doesn't apply and the booking is paid: what most of these tests are about.
 */
async function returning(email: string, name = "Returning") {
  const known = await sql("select id from akb_clients where lower(email) = lower($1)", [email]);
  const id = known[0]?.id ?? (await sql("insert into akb_clients (full_name, email) values ($2, lower($1)) returning id", [email, name]))[0].id;
  if ((await sql("select 1 from akb_class_attendance where client_id = $1 and status = 'attended'", [id])).length) return;
  const past = addDays(londonToday(), -30);
  const ses = await sql(
    "insert into akb_class_sessions (slot, class_date, starts_at, duration_minutes) values ('mon-evening', $1, $2, 60) on conflict (slot, class_date) do update set slot = excluded.slot returning id",
    [past, `${past}T18:30:00Z`],
  );
  await sql("insert into akb_class_attendance (class_session_id, client_id, status) values ($1, $2, 'attended')", [ses[0].id, id]);
}

/** A returning customer who has seen "You've trained with RAENG before" and continues to pay. */
const paidCheckout: typeof startClassCheckout = async (db, stripe, booker, cls, date, options) => {
  await returning(booker.email, booker.name);
  return startClassCheckout(db, stripe, booker, cls, date, { ...options, confirmPaid: true });
};

beforeAll(async () => {
  ({ db, sql } = await testDb());
  await sql("insert into akb_database_role (role) values ('test')");
}, 60_000);

describe("booking a group class and paying online", () => {
  it("holds a place, opens Stripe for the class price, and confirms only once Stripe's payment is recorded", async () => {
    const api = services();
    const [{ cls, date }] = classesFrom(3);
    const booker = { name: "Class Payer", email: "class-payer@example.com", phone: "" };
    const out = await paidCheckout(db, stripe, booker, cls, date, { idempotencyKey: "class-key-1", env, fetchImpl: api.fetchImpl });
    expect(out).toMatchObject({ ok: true, confirmed: false });
    if (!out.ok) return;
    const form = api.linkCalls[0];
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("1200");
    expect(form.get("line_items[0][price_data][currency]")).toBe("gbp");
    expect(form.get("customer_email")).toBe(booker.email);
    expect(form.get("success_url")).toBe(`https://raeng.example/book/done?booking=${out.bookingId}`);
    expect(await classBookingStatus(db, out.bookingId, publishedClasses())).toMatchObject({ status: "awaiting_payment", payUrl: out.url });
    // The same submission again opens the same link.
    const again = await paidCheckout(db, stripe, booker, cls, date, { idempotencyKey: "class-key-1", env, fetchImpl: api.fetchImpl });
    expect(again.ok && again.url).toBe(out.url);
    // A second, different booking for the same class is refused.
    expect(await paidCheckout(db, stripe, booker, cls, date, { idempotencyKey: "class-key-2", env, fetchImpl: api.fetchImpl })).toEqual({ ok: false, reason: "already_booked" });

    expect(await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl)).toBe(0);
    expect((await deliver(api, api.pay(await orderFor(out.bookingId), 1200))).status).toBe(200);
    expect((await classBookingStatus(db, out.bookingId, publishedClasses()))?.status).toBe("confirmed");

    // Alex is told (nothing to confirm); the booker gets a private link to cancel. Once each.
    expect(await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl)).toBe(1);
    expect(await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl)).toBe(0);
    const alex = api.emails.find((m) => m.to.includes("alex@example.com"));
    expect(alex?.subject).toMatch(/^Class booked: Class Payer, /);
    expect(alex?.text).toContain("nothing to confirm");
    const mine = api.emails.find((m) => m.to.includes(booker.email));
    expect(mine?.subject).toMatch(/^You're booked: /);
    expect(mine?.text).toContain("Cancel at least 24 hours before");
    const manage = tokenFrom(mine?.text ?? "", "https://raeng.example/book/manage");
    expect(manage).toHaveLength(43);

    // Cancelling in time refunds the payment in full (Alex, 2026-11-05): no class credit, and the fee is cancelled once Stripe's refund is recorded.
    expect(await bookingByToken(db, manage, publishedClasses())).toMatchObject({ status: "confirmed", canCancel: true, refundBack: true, creditBack: false });
    const cancelled = await cancelByToken(db, manage, env, api.fetchImpl, stripe);
    expect(cancelled).toEqual({ ok: true, creditLink: null, refunded: false, refund: { outcome: "requested", amountPence: 1200 } });
    const calls = refundCalls(api);
    expect(calls).toHaveLength(1);
    expect(calls[0].form.get("amount")).toBe("1200");
    expect(calls[0].headers["Idempotency-Key"]).toBe(`class-cancel-refund:${out.bookingId}`);
    expect(await sql("select id from akb_class_credits where source_booking_id = $1", [out.bookingId])).toHaveLength(0);
    expect(await owed(await chargeOf(out.bookingId))).toEqual({ outstanding_pence: 0, voided: true });
    const toThem = api.emails.find((m) => m.to.includes(booker.email) && m.subject.startsWith("Cancelled and refunded: "));
    expect(toThem?.text).toContain("We're refunding your £12.00 to the card you paid with");
    expect(api.emails.find((m) => m.to.includes("alex@example.com") && m.subject.startsWith("Class cancelled: Class Payer"))?.text).toContain("refunded automatically");
    expect((await bookingByToken(db, manage, publishedClasses()))?.status).toBe("cancelled");
    expect(await cancelByToken(db, manage, env, api.fetchImpl, stripe)).toEqual({ ok: false, reason: "not_booked" });
    // Trying the refund again (the daily job, a double tap) does nothing more.
    expect(await refundCancelledClass(db, out.bookingId, stripe, env, api.fetchImpl)).toMatchObject({ outcome: "none" });
    expect(await retryClassRefunds(db, stripe, env, api.fetchImpl)).toBe(0);
    expect(refundCalls(api)).toHaveLength(1);
  });

  it("a class credit still held books a class with nothing to pay; cancelled in time, the credit comes back", async () => {
    const api = services();
    const [a, b, c] = classesFrom(4);
    const booker = { name: "Credit Holder", email: "credit-holder@example.com", phone: "" };
    const out = await paidCheckout(db, stripe, booker, a.cls, a.date, { idempotencyKey: "class-credit-key-1", env, fetchImpl: api.fetchImpl });
    if (!out.ok) throw new Error("booking failed");
    const credit = await cancelledWithCredit(out.bookingId);
    expect(await creditStatus(db, credit)).toEqual({ usable: true, expiresOn: addDays(londonToday(), 28) });
    const withCredit = await paidCheckout(db, stripe, booker, b.cls, b.date, { idempotencyKey: "class-credit-key-2", creditToken: credit, env, fetchImpl: api.fetchImpl });
    expect(withCredit).toMatchObject({ ok: true, confirmed: true });
    if (!withCredit.ok) return;
    expect(withCredit.url).toBe(`https://raeng.example/book/done?booking=${withCredit.bookingId}`);
    // No new Stripe page for the credit booking.
    expect(api.linkCalls).toHaveLength(1);
    expect((await creditStatus(db, credit))?.usable).toBe(false);
    // A used credit can't be used again.
    expect(await paidCheckout(db, stripe, booker, c.cls, c.date, { idempotencyKey: "class-credit-key-3", creditToken: credit, env, fetchImpl: api.fetchImpl })).toEqual({ ok: false, reason: "credit_invalid" });

    // Its booking email says the credit comes back; cancelling in time gives a new credit link (no refund: nothing was paid).
    await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl);
    const mine = api.emails.find((m) => m.to.includes(booker.email) && m.subject.startsWith("You're booked"));
    expect(mine?.text).toContain("you'll get your class credit back");
    const manage = tokenFrom(mine?.text ?? "", "https://raeng.example/book/manage");
    expect(await bookingByToken(db, manage, publishedClasses())).toMatchObject({ creditBack: true, refundBack: false });
    const cancelled = await cancelByToken(db, manage, env, api.fetchImpl, stripe);
    expect(cancelled).toMatchObject({ ok: true, refunded: false });
    expect(cancelled.ok && cancelled.creditLink).toMatch(/^https:\/\/raeng\.example\/book\/group-class\?credit=/);
    expect(cancelled.ok && "refund" in cancelled).toBe(false);
    expect(refundCalls(api)).toHaveLength(0);
  });

  it("an unknown or malformed link finds nothing", async () => {
    expect(await bookingByToken(db, "not-a-token", publishedClasses())).toBeNull();
    expect(await bookingByToken(db, "a".repeat(43), publishedClasses())).toBeNull();
    expect(await creditStatus(db, "b".repeat(43))).toBeNull();
    expect(await classBookingStatus(db, "00000000-0000-4000-8000-000000000000", publishedClasses())).toBeNull();
  });

  it("the hold release runs", async () => {
    const r = await rpc<number>(db, "akb_release_class_holds", {});
    expect(r.ok).toBe(true);
  });
});

describe("a Stripe refund of a class cancelled before 2026-11-05 (with a class credit)", () => {
  /** Books, pays and cancels the old way (with a credit). Returns what the refund needs. */
  async function paidThenCancelled(api: ReturnType<typeof services>, email: string, key: string, at: { cls: PublishedClass; date: DateKey }) {
    const booker = { name: "Refund Test", email, phone: "" };
    const out = await paidCheckout(db, stripe, booker, at.cls, at.date, { idempotencyKey: key, env, fetchImpl: api.fetchImpl });
    if (!out.ok) throw new Error("booking failed");
    const intent = api.stripeApi.pay(await orderFor(out.bookingId), 1200);
    expect((await deliver(api, await orderFor(out.bookingId))).status).toBe(200);
    await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl);
    const credit = await cancelledWithCredit(out.bookingId);
    return { booker, bookingId: out.bookingId, intent, charge: await chargeOf(out.bookingId), credit };
  }
  const refund = async (api: ReturnType<typeof services>, intent: string, amount: number) =>
    (await deliverStripeEvent(db, api.stripeApi, "refund.updated", { id: api.stripeApi.refund(intent, amount) })).body;

  it("in full: the unused credit is withdrawn and the class fee is cancelled, once", async () => {
    const api = services();
    const t = await paidThenCancelled(api, "refund-full@example.com", "refund-key-1", classesFrom(5)[0]);
    expect(await creditStatus(db, t.credit)).toMatchObject({ usable: true });
    const id = api.stripeApi.refund(t.intent, 1200);
    expect((await deliverStripeEvent(db, api.stripeApi, "refund.updated", { id })).body).toEqual({ outcome: "recorded" });
    expect(await deliverStripeEvent(db, api.stripeApi, "refund.updated", { id }).then((r) => r.body)).toEqual({ outcome: "duplicate" });
    expect(await creditStatus(db, t.credit)).toBeNull();
    expect(await owed(t.charge)).toEqual({ outstanding_pence: 0, voided: true });
    expect(await sql("select action from akb_events where entity_id = $1 and action = 'credit_withdrawn'", [t.bookingId])).toHaveLength(1);
    const later = classesFrom(5)[1];
    expect(await paidCheckout(db, stripe, t.booker, later.cls, later.date, { idempotencyKey: "refund-key-1b", creditToken: t.credit, env, fetchImpl: api.fetchImpl })).toEqual({ ok: false, reason: "credit_invalid" });
  });

  it("in part: nothing else changes (the credit stays; what was refunded is owed again)", async () => {
    const api = services();
    const t = await paidThenCancelled(api, "refund-part@example.com", "refund-key-2", classesFrom(6)[0]);
    expect(await refund(api, t.intent, 500)).toEqual({ outcome: "recorded" });
    expect((await creditStatus(db, t.credit))?.usable).toBe(true);
    expect(await owed(t.charge)).toEqual({ outstanding_pence: 500, voided: false });
  });

  it("after the credit booked another class: the fee stays owed, for the coach to decide", async () => {
    const api = services();
    const t = await paidThenCancelled(api, "refund-used@example.com", "refund-key-3", classesFrom(7)[0]);
    const next = classesFrom(7)[1];
    expect(await paidCheckout(db, stripe, t.booker, next.cls, next.date, { idempotencyKey: "refund-key-3b", creditToken: t.credit, env, fetchImpl: api.fetchImpl })).toMatchObject({ ok: true, confirmed: true });
    expect(await refund(api, t.intent, 1200)).toEqual({ outcome: "recorded" });
    expect(await owed(t.charge)).toEqual({ outstanding_pence: 1200, voided: false });
  });

  /** Books and pays (not cancelled). Returns the manage link and what the refund needs. */
  async function paid(api: ReturnType<typeof services>, email: string, key: string, at: { cls: PublishedClass; date: DateKey }) {
    const out = await paidCheckout(db, stripe, { name: "Refund First", email, phone: "" }, at.cls, at.date, { idempotencyKey: key, env, fetchImpl: api.fetchImpl });
    if (!out.ok) throw new Error("booking failed");
    const intent = api.stripeApi.pay(await orderFor(out.bookingId), 1200);
    expect((await deliver(api, await orderFor(out.bookingId))).status).toBe(200);
    await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl);
    const mine = api.emails.filter((m) => m.to.includes(email) && m.subject.startsWith("You're booked")).at(-1);
    const [row] = await sql("select charge_id, client_id, attendance_id from akb_class_bookings where id = $1", [out.bookingId]);
    return { bookingId: out.bookingId, intent, manage: tokenFrom(mine?.text ?? "", "https://raeng.example/book/manage"), charge: String(row.charge_id), clientId: String(row.client_id), place: String(row.attendance_id) };
  }

  it("refunded first, then cancelled by the private link: no credit, the fee is cancelled, and the page and emails say why", async () => {
    const api = services();
    const t = await paid(api, "refund-first@example.com", "refund-key-4", classesFrom(8)[0]);
    expect(await bookingByToken(db, t.manage, publishedClasses())).toMatchObject({ refunded: false, refundBack: true });
    expect(await refund(api, t.intent, 1200)).toEqual({ outcome: "recorded" });
    // Still booked: the refund alone leaves the place and the fee for the coach to decide.
    expect(await owed(t.charge)).toEqual({ outstanding_pence: 1200, voided: false });
    expect(await bookingByToken(db, t.manage, publishedClasses())).toMatchObject({ status: "confirmed", canCancel: true, refunded: true, creditBack: false, refundBack: false });
    expect(await cancelByToken(db, t.manage, env, api.fetchImpl)).toEqual({ ok: true, creditLink: null, refunded: true });
    expect(await sql("select id from akb_class_credits where source_booking_id = $1", [t.bookingId])).toHaveLength(0);
    expect(await owed(t.charge)).toEqual({ outstanding_pence: 0, voided: true });
    const toThem = api.emails.find((m) => m.to.includes("refund-first@example.com") && m.subject.startsWith("Cancelled: "));
    expect(toThem?.text).toContain("already refunded");
    expect(api.emails.find((m) => m.to.includes("alex@example.com") && m.subject.startsWith("Class cancelled: Refund First"))?.text).toContain("class fee is cancelled");
  });

  it("refunded in part, then cancelled in time: the rest is refunded and the fee is cancelled", async () => {
    const api = services();
    const t = await paid(api, "refund-part-first@example.com", "refund-key-5", classesFrom(9)[0]);
    expect(await refund(api, t.intent, 500)).toEqual({ outcome: "recorded" });
    expect(await bookingByToken(db, t.manage, publishedClasses())).toMatchObject({ refunded: false, refundBack: true });
    const out = await cancelByToken(db, t.manage, env, api.fetchImpl, stripe);
    expect(out).toEqual({ ok: true, creditLink: null, refunded: false, refund: { outcome: "requested", amountPence: 700 } });
    expect(refundCalls(api)[0].form.get("amount")).toBe("700");
    expect(await owed(t.charge)).toEqual({ outstanding_pence: 0, voided: true });
  });

  it("refunded first, then cancelled from the account: the same", async () => {
    const api = services();
    const t = await paid(api, "refund-first-account@example.com", "refund-key-6", classesFrom(10)[0]);
    expect(await refund(api, t.intent, 1200)).toEqual({ outcome: "recorded" });
    const overview = await rpc<{ places: { id: string; refunded: boolean; credit_back_if_cancelled: boolean }[] }>(db, "akb_member_overview", { p_client: t.clientId });
    expect(overview.ok && overview.data.places.find((p) => p.id === t.place)).toMatchObject({ refunded: true, credit_back_if_cancelled: false });
    expect(await cancelPaidPlace(db, t.clientId, t.place)).toEqual({ ok: true, data: { credit: false, refunded: true } });
    expect(await sql("select id from akb_class_credits where source_booking_id = $1", [t.bookingId])).toHaveLength(0);
    expect(await owed(t.charge)).toEqual({ outstanding_pence: 0, voided: true });
  });

  it("not refunded, cancelled from the account in time: refunded in full, no credit, and the fee is cancelled", async () => {
    const api = services();
    const t = await paid(api, "no-refund-account@example.com", "refund-key-7", classesFrom(11)[0]);
    const overview = await rpc<{ places: { id: string; how: string; credit_back_if_cancelled: boolean }[] }>(db, "akb_member_overview", { p_client: t.clientId });
    expect(overview.ok && overview.data.places.find((p) => p.id === t.place)).toMatchObject({ how: "paid", credit_back_if_cancelled: true });
    expect(await cancelPaidPlace(db, t.clientId, t.place, stripe, env, api.fetchImpl)).toEqual({
      ok: true,
      data: { credit: false, refunded: false, refund: { outcome: "requested", amountPence: 1200 } },
    });
    expect(await sql("select id from akb_class_credits where source_booking_id = $1", [t.bookingId])).toHaveLength(0);
    expect(await owed(t.charge)).toEqual({ outstanding_pence: 0, voided: true });
  });

  it("the hold release still runs", async () => {
    const r = await rpc<number>(db, "akb_release_class_holds", {});
    expect(r.ok).toBe(true);
  });
});

describe("refunds for paid classes cancelled in time (Alex, 2026-11-05)", () => {
  async function paidBooking(api: ReturnType<typeof services>, email: string, key: string, at: { cls: PublishedClass; date: DateKey }) {
    const out = await paidCheckout(db, stripe, { name: "Refund Rule", email, phone: "" }, at.cls, at.date, { idempotencyKey: key, env, fetchImpl: api.fetchImpl });
    if (!out.ok) throw new Error("booking failed");
    api.stripeApi.pay(await orderFor(out.bookingId), 1200);
    expect((await deliver(api, await orderFor(out.bookingId))).status).toBe(200);
    const [row] = await sql("select client_id, attendance_id from akb_class_bookings where id = $1", [out.bookingId]);
    return { bookingId: out.bookingId, clientId: String(row.client_id), place: String(row.attendance_id) };
  }
  const due = async () => {
    const r = await rpc<string[]>(db, "akb_class_refunds_due", {});
    return r.ok ? r.data : [];
  };

  it("Stripe refuses at first: Alex is told once, the daily job retries with the same key, and it's refunded once", async () => {
    const api = services();
    const t = await paidBooking(api, "refund-retry@example.com", "refund-rule-1", classesFrom(12)[0]);
    api.stripeApi.refuseRefunds(500);
    expect(await cancelPaidPlace(db, t.clientId, t.place, stripe, env, api.fetchImpl)).toEqual({
      ok: true,
      data: { credit: false, refunded: false, refund: { outcome: "retry", amountPence: 1200 } },
    });
    expect(await due()).toContain(t.bookingId);
    expect(await retryClassRefunds(db, stripe, env, api.fetchImpl)).toBe(0);
    const alerts = api.emails.filter((m) => m.to.includes("alex@example.com") && m.subject.startsWith("Refund not made yet"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toContain("Refund Rule (refund-retry@example.com)");
    expect(await owed(await chargeOf(t.bookingId))).toEqual({ outstanding_pence: 0, voided: false });

    api.stripeApi.refuseRefunds(0);
    expect(await retryClassRefunds(db, stripe, env, api.fetchImpl)).toBe(1);
    expect(await retryClassRefunds(db, stripe, env, api.fetchImpl)).toBe(0);
    expect(await due()).not.toContain(t.bookingId);
    const keys = new Set(refundCalls(api).map((c) => c.headers["Idempotency-Key"]));
    expect(keys).toEqual(new Set([`class-cancel-refund:${t.bookingId}`]));
    expect(await owed(await chargeOf(t.bookingId))).toEqual({ outstanding_pence: 0, voided: true });
    expect((await sql("select sum(r.amount_pence)::int as n from akb_refunds r join akb_payments p on p.id = r.payment_id where p.client_id = $1", [t.clientId]))[0].n).toBe(1200);
  });

  it("a payment the site can't refund (no Stripe here): Alex is asked to refund it, once, and it isn't retried", async () => {
    const api = services();
    const t = await paidBooking(api, "refund-manual@example.com", "refund-rule-2", classesFrom(13)[0]);
    expect(await cancelPaidPlace(db, t.clientId, t.place, null, env, api.fetchImpl)).toEqual({
      ok: true,
      data: { credit: false, refunded: false, refund: { outcome: "manual", amountPence: 1200 } },
    });
    expect(api.emails.filter((m) => m.subject === "Refund to make: £12.00")).toHaveLength(1);
    expect(await refundCancelledClass(db, t.bookingId, null, env, api.fetchImpl)).toEqual({ outcome: "manual", amountPence: 1200 });
    expect(api.emails.filter((m) => m.subject === "Refund to make: £12.00")).toHaveLength(1);
    expect(refundCalls(api)).toHaveLength(0);
  });

  it("cancelled less than 24 hours before: nothing back, no refund", async () => {
    const api = services();
    const t = await paidBooking(api, "refund-late@example.com", "refund-rule-3", classesFrom(14)[0]);
    await sql("update akb_class_sessions set starts_at = now() + interval '5 hours' where id = (select class_session_id from akb_class_attendance where id = $1)", [t.place]);
    expect(await cancelPaidPlace(db, t.clientId, t.place, stripe, env, api.fetchImpl)).toEqual({ ok: true, data: { credit: false, refunded: false } });
    expect(refundCalls(api)).toHaveLength(0);
    expect(await due()).not.toContain(t.bookingId);
    expect(await owed(await chargeOf(t.bookingId))).toEqual({ outstanding_pence: 0, voided: false });
  });
});

describe("first class free (Alex, 2026-11-05)", () => {
  const eligible = async (email: string) =>
    (await sql("select akb_first_class_free_eligible(id) as ok from akb_clients where lower(email) = lower($1)", [email]))[0]?.ok;

  it("books a new person's first class with nothing to pay and no Stripe page; the next one is paid", async () => {
    const api = services();
    const [a, b] = classesFrom(5);
    const booker = { name: "New Starter", email: "new-starter@example.com", phone: "" };
    const free = await startClassCheckout(db, stripe, booker, a.cls, a.date, { idempotencyKey: "first-free-key-1", env, fetchImpl: api.fetchImpl });
    expect(free).toMatchObject({ ok: true, confirmed: true, firstClassFree: true });
    if (!free.ok) return;
    expect(free.url).toBe(`https://raeng.example/book/done?booking=${free.bookingId}`);
    expect(api.linkCalls).toHaveLength(0);
    expect(await classBookingStatus(db, free.bookingId, publishedClasses())).toMatchObject({ status: "confirmed", pricePence: 0, firstClassFree: true });
    // The same submission again is the same free booking.
    expect(await startClassCheckout(db, stripe, booker, a.cls, a.date, { idempotencyKey: "first-free-key-1", env, fetchImpl: api.fetchImpl })).toMatchObject({ ok: true, bookingId: free.bookingId, firstClassFree: true });

    // Emails say it's the free first class; the cancel line says how that works.
    expect(await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl)).toBeGreaterThanOrEqual(1);
    const mine = api.emails.find((m) => m.to.includes(booker.email));
    expect(mine?.text).toContain("is confirmed (first class free)");
    expect(mine?.text).toContain("book your free class for another date");
    expect(mine?.text).not.toContain("credit for another class within 4 weeks");
    expect(api.emails.find((m) => m.to.includes("alex@example.com") && m.subject.includes("New Starter"))?.text).toContain("(first class free)");

    expect(await eligible(booker.email)).toBe(false);
    // Now they're not new (email case and spaces don't matter): the form is told first, nothing is booked, no Stripe page.
    const again = { ...booker, email: "  NEW-STARTER@example.com " };
    expect(await startClassCheckout(db, stripe, again, b.cls, b.date, { idempotencyKey: "first-free-key-2", env, fetchImpl: api.fetchImpl })).toEqual({ ok: false, reason: "returning" });
    expect(api.linkCalls).toHaveLength(0);
    // They continue: Stripe for £12.
    const paid = await startClassCheckout(db, stripe, again, b.cls, b.date, { idempotencyKey: "first-free-key-2", confirmPaid: true, env, fetchImpl: api.fetchImpl });
    expect(paid).toMatchObject({ ok: true, confirmed: false });
    expect(api.linkCalls).toHaveLength(1);
    expect(api.linkCalls[0].get("line_items[0][price_data][unit_amount]")).toBe("1200");
  });

  it("cancelled 24 hours or more before: no class credit, and the free class can be booked again", async () => {
    const api = services();
    const [a, b] = classesFrom(6);
    const booker = { name: "Changed Plans", email: "changed-plans@example.com", phone: "" };
    const free = await startClassCheckout(db, stripe, booker, a.cls, a.date, { idempotencyKey: "first-free-key-3", env, fetchImpl: api.fetchImpl });
    if (!free.ok) throw new Error("expected a free booking");
    await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl);
    const manage = tokenFrom(api.emails.find((m) => m.to.includes(booker.email))?.text ?? "", "https://raeng.example/book/manage");
    expect(await bookingByToken(db, manage, publishedClasses())).toMatchObject({ firstClassFree: true, creditBack: false, inTime: true });
    expect(await cancelByToken(db, manage, env, api.fetchImpl)).toEqual({ ok: true, creditLink: null, refunded: false, firstClassFree: true, freeClassBack: true });
    expect((await sql("select count(*)::int as n from akb_class_credits c join akb_clients p on p.id = c.client_id where p.email = $1", [booker.email]))[0].n).toBe(0);
    expect(api.emails.find((m) => m.to.includes(booker.email) && m.subject.startsWith("Cancelled"))?.text).toContain("Your free first class is still yours");
    expect(await eligible(booker.email)).toBe(true);
    expect(await startClassCheckout(db, stripe, booker, b.cls, b.date, { idempotencyKey: "first-free-key-4", env, fetchImpl: api.fetchImpl })).toMatchObject({ ok: true, firstClassFree: true });
  });

  it("cancelled less than 24 hours before, it's used", async () => {
    const api = services();
    const [a, b] = classesFrom(7);
    const booker = { name: "Late Canceller", email: "late-canceller@example.com", phone: "" };
    const free = await startClassCheckout(db, stripe, booker, a.cls, a.date, { idempotencyKey: "first-free-key-5", env, fetchImpl: api.fetchImpl });
    if (!free.ok) throw new Error("expected a free booking");
    await notifyClassBookings(db, publishedClasses(), env, api.fetchImpl);
    const manage = tokenFrom(api.emails.find((m) => m.to.includes(booker.email))?.text ?? "", "https://raeng.example/book/manage");
    // The class is now 3 hours away.
    await sql(
      "update akb_class_sessions set starts_at = now() + interval '3 hours' where id = (select a.class_session_id from akb_class_attendance a join akb_class_bookings k on k.attendance_id = a.id where k.id = $1)",
      [free.bookingId],
    );
    expect(await cancelByToken(db, manage, env, api.fetchImpl)).toEqual({ ok: true, creditLink: null, refunded: false, firstClassFree: true, freeClassBack: false });
    expect(await eligible(booker.email)).toBe(false);
    expect(await startClassCheckout(db, stripe, booker, b.cls, b.date, { idempotencyKey: "first-free-key-6", env, fetchImpl: api.fetchImpl })).toEqual({ ok: false, reason: "returning" });
  });

  it("doesn't apply to someone with a past class, and an abandoned payment doesn't use it", async () => {
    const api = services();
    const [a, b] = classesFrom(8);
    // A previous class place: told first, then pays £12.
    const back = { name: "Been Before", email: "been-before@example.com", phone: "" };
    await returning(back.email, back.name);
    expect(await startClassCheckout(db, stripe, back, a.cls, a.date, { idempotencyKey: "first-free-key-7", env, fetchImpl: api.fetchImpl })).toEqual({ ok: false, reason: "returning" });
    expect(await startClassCheckout(db, stripe, back, a.cls, a.date, { idempotencyKey: "first-free-key-7", confirmPaid: true, env, fetchImpl: api.fetchImpl })).toMatchObject({ ok: true, confirmed: false });
    // An unpaid hold that lapses leaves the offer in place.
    const fresh = await sql("insert into akb_clients (full_name, email) values ('Hold Only', 'hold-only@example.com') returning id");
    const ses = (await sql("select class_session_id from akb_class_attendance limit 1"))[0].class_session_id;
    await sql("insert into akb_class_attendance (class_session_id, client_id, hold_expires_at) values ($1, $2, now() - interval '1 minute')", [ses, fresh[0].id]);
    expect(await eligible("hold-only@example.com")).toBe(true);
    // Two quick submissions with different keys: only one can be free.
    const twice = { name: "Double Tap", email: "double-tap@example.com", phone: "" };
    const first = await startClassCheckout(db, stripe, twice, a.cls, a.date, { idempotencyKey: "first-free-key-8", env, fetchImpl: api.fetchImpl });
    const second = await startClassCheckout(db, stripe, twice, b.cls, b.date, { idempotencyKey: "first-free-key-9", env, fetchImpl: api.fetchImpl });
    expect(first).toMatchObject({ ok: true, firstClassFree: true });
    expect(second).toEqual({ ok: false, reason: "returning" });
  });
});

describe("first class free: who is new (owner, 2026-11-05)", () => {
  const byEmail = async (email: string) => (await sql("select akb_first_class_free_eligible_email($1) as ok", [email]))[0].ok;
  /** A membership started for this email; paid when `amountPence` is given (Alex records the payment against its first period). */
  async function membership(email: string, amountPence?: number) {
    const [c] = await sql("insert into akb_clients (full_name, email) values ('Member Test', lower($1)) returning id", [email]);
    await sql("select akb_start_membership($1, 'regular', 'Regular', 6500, 8, akb_london_today())", [c.id]);
    if (amountPence) {
      const [p] = await sql("select p.charge_id from akb_membership_periods p join akb_memberships m on m.id = p.membership_id where m.client_id = $1", [c.id]);
      await sql(
        "select akb_record_payment($1, 'group', $2::int, akb_london_today(), 'card', '', '', $3, jsonb_build_array(jsonb_build_object('charge_id', $4::uuid, 'amount_pence', $2::int)))",
        [c.id, amountPence, `member-pay-${email}`, p.charge_id],
      );
    }
    return String(c.id);
  }
  const book = (email: string, key: string, at: { cls: PublishedClass; date: DateKey }, api: ReturnType<typeof services>, confirmPaid = false) =>
    startClassCheckout(db, stripe, { name: "Who Is New", email, phone: "" }, at.cls, at.date, { idempotencyKey: key, confirmPaid, env, fetchImpl: api.fetchImpl });

  it("a brand-new email gets the free class", async () => {
    const api = services();
    expect(await byEmail("Brand-New@Example.com ")).toBe(true);
    expect(await book("brand-new@example.com", "who-new-1", classesFrom(15)[0], api)).toMatchObject({ ok: true, confirmed: true, firstClassFree: true });
    expect(api.linkCalls).toHaveLength(0);
  });

  it("an email with an unpaid membership (started, or cancelled with no payment) still gets the free class", async () => {
    const api = services();
    await membership("unpaid-member@example.com");
    expect(await byEmail("unpaid-member@example.com")).toBe(true);
    const cancelled = await membership("unpaid-cancelled@example.com");
    await sql("update akb_memberships set status = 'cancelled', cancelled_on = akb_london_today() where client_id = $1", [cancelled]);
    expect(await byEmail("UNPAID-cancelled@example.com")).toBe(true);
    expect(await book("unpaid-member@example.com", "who-new-2", classesFrom(15)[1], api)).toMatchObject({ ok: true, confirmed: true, firstClassFree: true });
  });

  it("an email with a paid membership pays £12 (refunded later or not)", async () => {
    const api = services();
    const id = await membership("paid-member@example.com", 6500);
    expect(await byEmail("paid-member@example.com")).toBe(false);
    expect(await book("paid-member@example.com", "who-new-3", classesFrom(15)[2], api)).toEqual({ ok: false, reason: "returning" });
    expect(await book("paid-member@example.com", "who-new-3", classesFrom(15)[2], api, true)).toMatchObject({ ok: true, confirmed: false });
    expect(api.linkCalls[0].get("line_items[0][price_data][unit_amount]")).toBe("1200");
    // Still counts once cancelled.
    await sql("update akb_memberships set status = 'cancelled', cancelled_on = akb_london_today() where client_id = $1", [id]);
    expect(await byEmail("paid-member@example.com")).toBe(false);
  });

  it("an email with a previous class place pays £12", async () => {
    const api = services();
    await returning("past-class@example.com");
    expect(await byEmail("past-class@example.com")).toBe(false);
    expect(await book("past-class@example.com", "who-new-4", classesFrom(16)[0], api)).toEqual({ ok: false, reason: "returning" });
    expect(await book("past-class@example.com", "who-new-4", classesFrom(16)[0], api, true)).toMatchObject({ ok: true, confirmed: false });
  });

  it("an email that already used the free class pays £12", async () => {
    const api = services();
    const [a, b] = classesFrom(17);
    expect(await book("used-free@example.com", "who-new-5", a, api)).toMatchObject({ ok: true, firstClassFree: true });
    expect(await byEmail("used-free@example.com")).toBe(false);
    expect(await book("Used-Free@example.com", "who-new-6", b, api)).toEqual({ ok: false, reason: "returning" });
    expect(await book("Used-Free@example.com", "who-new-6", b, api, true)).toMatchObject({ ok: true, confirmed: false });
    expect(api.linkCalls).toHaveLength(1);
  });
});

describe("first class free, cancelled from the account", () => {
  it("gives no class credit and keeps the free class to book again", async () => {
    const api = services();
    const [a] = classesFrom(20);
    const booker = { name: "Account Free", email: "account-free@example.com", phone: "" };
    const free = await startClassCheckout(db, stripe, booker, a.cls, a.date, { idempotencyKey: "first-free-key-account", env, fetchImpl: api.fetchImpl });
    if (!free.ok) throw new Error("expected a free booking");
    const row = (await sql("select client_id, attendance_id from akb_class_bookings where id = $1", [free.bookingId]))[0];
    const out = await cancelPaidPlace(db, String(row.client_id), String(row.attendance_id));
    expect(out).toEqual({ ok: true, data: { credit: false, refunded: false, firstClassFree: true, freeClassBack: true } });
    expect((await sql("select count(*)::int as n from akb_class_credits where client_id = $1", [row.client_id]))[0].n).toBe(0);
  });
});

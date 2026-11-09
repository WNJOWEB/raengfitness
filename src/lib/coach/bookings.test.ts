import { beforeAll, describe, expect, it } from "vitest";
import { addAttendee, addPackage, addPtSession, ensureClassSession, getClassSession, getDefaultCapacity, getPackage, getSlotCapacities, listAttendance, reschedulePtSession, setAttendance, setDefaultCapacity, setPtStatus, setSlotCapacity, updateClassSession } from "./bookings";
import { createClient } from "./clients";
import { isTimetableClass, classOccurrences } from "./classes";
import type { Db } from "./db";
import { listCharges } from "./ledger";
import { addCheckIn, chargeSubscriptionPeriod, createSubscription, getSubscription } from "./online";
import { testDb } from "./test-support";

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;

beforeAll(async () => {
  ({ db, sql } = await testDb());
}, 60_000);

async function newClient() {
  n += 1;
  const r = await createClient(db, { full_name: `Booking ${n}`, email: `booking${n}@example.com`, phone: "", instagram: "", preferred_contact: "", status: "active", notes: "" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data.id;
}

const SAT = { slot: "sat-morning", date: "2026-10-24", startsAt: "2026-10-24T08:00:00.000Z", duration: 60 };

describe("class dates", () => {
  it("accepts only real timetable dates within the window", () => {
    expect(isTimetableClass("2026-10-24", "sat-morning", "2026-10-19")).toBe(true);
    expect(isTimetableClass("2026-10-25", "sat-morning", "2026-10-19")).toBe(false); // a Sunday
    expect(isTimetableClass("2026-10-26", "mon-evening", "2026-10-19")).toBe(true);
    expect(isTimetableClass("2026-10-26", "no-such-slot", "2026-10-19")).toBe(false);
    expect(isTimetableClass("2026-02-30", "mon-evening", "2026-10-19")).toBe(false);
    expect(isTimetableClass("2030-10-26", "mon-evening", "2026-10-19")).toBe(false); // too far ahead
  });

  it("lists classes in time order from the one timetable", () => {
    const week = classOccurrences("2026-10-19", "2026-10-25");
    expect(week.map((c) => `${c.date} ${c.slot.id}`)).toEqual(["2026-10-19 mon-evening", "2026-10-21 wed-evening", "2026-10-24 sat-morning"]);
    // 08:30 UK time is 07:30 UTC in October (BST) and 08:30 UTC in November (GMT).
    expect(week[2].startsAt).toBe("2026-10-24T07:30:00.000Z");
    expect(classOccurrences("2026-11-07", "2026-11-07")[0].startsAt).toBe("2026-11-07T08:30:00.000Z");
  });
});

describe("class attendance", () => {
  it("adds attendees once, charges them, and frees an unpaid charge on cancellation", async () => {
    const c = await newClient();
    const add = await addAttendee(db, { clientId: c, ...SAT, pricePence: 1000, description: "Kettlebell Training" });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(await addAttendee(db, { clientId: c, ...SAT, pricePence: 1000, description: "x" })).toMatchObject({
      ok: false,
      error: { kind: "conflict", constraint: "akb_class_attendance_class_session_id_client_id_key" },
    });
    let charges = await listCharges(db, { clientId: c });
    expect(charges.ok && charges.data.map((ch) => [ch.amount_pence, ch.voided_at])).toEqual([[1000, null]]);

    expect((await setAttendance(db, add.data, "attended")).ok).toBe(true);
    expect((await setAttendance(db, add.data, "cancelled")).ok).toBe(true);
    charges = await listCharges(db, { clientId: c });
    expect(charges.ok && charges.data[0].voided_at).not.toBeNull();
  });

  it("enforces a class's own capacity when one is set", async () => {
    const date = { ...SAT, date: "2026-10-31", startsAt: "2026-10-31T08:00:00.000Z" };
    const id = await ensureClassSession(db, date);
    expect(id.ok).toBe(true);
    if (!id.ok) return;
    // Same row on a second call.
    expect(await ensureClassSession(db, date)).toEqual(id);
    expect((await updateClassSession(db, id.data, { capacity: 1, notes: "" })).ok).toBe(true);
    const a = await newClient();
    const b = await newClient();
    const first = await addAttendee(db, { clientId: a, ...date, pricePence: 1000, description: "x" });
    expect(first.ok).toBe(true);
    expect(await addAttendee(db, { clientId: b, ...date, pricePence: 1000, description: "x" })).toMatchObject({ ok: false, error: { rule: "class_full" } });
    // Nothing half-done: no charge for the refused place.
    const charges = await listCharges(db, { clientId: b });
    expect(charges.ok && charges.data).toEqual([]);
    // A cancellation frees the place.
    if (first.ok) await setAttendance(db, first.data, "cancelled");
    expect((await addAttendee(db, { clientId: b, ...date, pricePence: 1000, description: "x" })).ok).toBe(true);
    const row = await getClassSession(db, "sat-morning", "2026-10-31");
    expect(row.ok && row.data).toMatchObject({ capacity: 1, booked: 1 });
    const list = await listAttendance(db, { sessionIds: [id.data] });
    expect(list.ok && list.data.map((x) => x.status).sort()).toEqual(["booked", "cancelled"]);
  });
});

describe("the usual class size", () => {
  const date = { slot: "sat-morning", date: "2026-11-07", startsAt: "2026-11-07T08:00:00.000Z", duration: 60 };

  it("is 15 until Alex changes it, applies to every class without its own size, and refuses a place once full", async () => {
    expect(await getDefaultCapacity(db)).toBe(15);
    const id = await ensureClassSession(db, date);
    if (!id.ok) throw new Error("no session");
    let row = await getClassSession(db, date.slot, date.date);
    expect(row.ok && row.data).toMatchObject({ capacity: 15, capacity_set: null, booked: 0 });

    expect((await setDefaultCapacity(db, 2)).ok).toBe(true);
    expect(await getDefaultCapacity(db)).toBe(2);
    const [a, b, c] = [await newClient(), await newClient(), await newClient()];
    expect((await addAttendee(db, { clientId: a, ...date, pricePence: 1000, description: "x" })).ok).toBe(true);
    expect((await addAttendee(db, { clientId: b, ...date, pricePence: 1000, description: "x" })).ok).toBe(true);
    expect(await addAttendee(db, { clientId: c, ...date, pricePence: 1000, description: "x" })).toMatchObject({ ok: false, error: { rule: "class_full" } });
    row = await getClassSession(db, date.slot, date.date);
    expect(row.ok && row.data).toMatchObject({ capacity: 2, booked: 2 });

    // A date's own size wins over the usual size; clearing it goes back to the usual size.
    expect((await updateClassSession(db, id.data, { capacity: 3, notes: "" })).ok).toBe(true);
    expect((await addAttendee(db, { clientId: c, ...date, pricePence: 1000, description: "x" })).ok).toBe(true);
    row = await getClassSession(db, date.slot, date.date);
    expect(row.ok && row.data).toMatchObject({ capacity: 3, capacity_set: 3, booked: 3 });
    expect((await updateClassSession(db, id.data, { capacity: null, notes: "" })).ok).toBe(true);
    row = await getClassSession(db, date.slot, date.date);
    expect(row.ok && row.data).toMatchObject({ capacity: 2, capacity_set: null });

    expect((await setDefaultCapacity(db, 15)).ok).toBe(true);
  });

  it("refuses a size outside 1 to 200", async () => {
    expect(await setDefaultCapacity(db, 0)).toMatchObject({ ok: false, error: { rule: "invalid_capacity" } });
    expect(await setDefaultCapacity(db, 201)).toMatchObject({ ok: false, error: { rule: "invalid_capacity" } });
    expect(await getDefaultCapacity(db)).toBe(15);
  });
});

describe("a usual class size for each class time (owner, 2026-11-04)", () => {
  const sat = { slot: "sat-morning", date: "2026-11-14", startsAt: "2026-11-14T09:00:00.000Z", duration: 60 };
  const mon = { slot: "mon-evening", date: "2026-11-16", startsAt: "2026-11-16T18:30:00.000Z", duration: 60 };

  it("a slot's own size applies to that slot only, below a date's own size and above the all-classes size", async () => {
    expect(await getSlotCapacities(db)).toEqual({});
    expect((await setSlotCapacity(db, "sat-morning", 1)).ok).toBe(true);
    expect(await getSlotCapacities(db)).toEqual({ "sat-morning": 1 });
    const [satId, monId] = [await ensureClassSession(db, sat), await ensureClassSession(db, mon)];
    if (!satId.ok || !monId.ok) throw new Error("no session");
    expect(await getClassSession(db, sat.slot, sat.date)).toMatchObject({ ok: true, data: { capacity: 1, capacity_set: null } });
    expect(await getClassSession(db, mon.slot, mon.date)).toMatchObject({ ok: true, data: { capacity: 15, capacity_set: null } });

    const [a, b] = [await newClient(), await newClient()];
    expect((await addAttendee(db, { clientId: a, ...sat, pricePence: 1000, description: "x" })).ok).toBe(true);
    expect(await addAttendee(db, { clientId: b, ...sat, pricePence: 1000, description: "x" })).toMatchObject({ ok: false, error: { rule: "class_full" } });
    // Monday is untouched by Saturday's size.
    expect((await addAttendee(db, { clientId: a, ...mon, pricePence: 1000, description: "x" })).ok).toBe(true);
    expect((await addAttendee(db, { clientId: b, ...mon, pricePence: 1000, description: "x" })).ok).toBe(true);

    // A date's own size wins; clearing the slot's size goes back to the all-classes size.
    expect((await updateClassSession(db, satId.data, { capacity: 2, notes: "" })).ok).toBe(true);
    expect((await addAttendee(db, { clientId: b, ...sat, pricePence: 1000, description: "x" })).ok).toBe(true);
    expect((await updateClassSession(db, satId.data, { capacity: null, notes: "" })).ok).toBe(true);
    expect((await setSlotCapacity(db, "sat-morning", null)).ok).toBe(true);
    expect(await getSlotCapacities(db)).toEqual({});
    expect(await getClassSession(db, sat.slot, sat.date)).toMatchObject({ ok: true, data: { capacity: 15 } });
  });

  it("refuses a size outside 1 to 200 and a made-up slot name", async () => {
    expect(await setSlotCapacity(db, "sat-morning", 0)).toMatchObject({ ok: false, error: { rule: "invalid_capacity" } });
    expect(await setSlotCapacity(db, "sat-morning", 201)).toMatchObject({ ok: false, error: { rule: "invalid_capacity" } });
    expect(await setSlotCapacity(db, "Sat Morning; drop table", 10)).toMatchObject({ ok: false, error: { rule: "invalid_slot" } });
    expect(await getSlotCapacities(db)).toEqual({});
  });
});

describe("one-to-one sessions and packages", () => {
  const at = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour)).toISOString();

  it("refuses overlapping sessions but allows back-to-back and cancelled ones", async () => {
    const c = await newClient();
    const base = { clientId: c, pricePence: 3500, packageId: null, notes: "", description: "One-to-one" };
    expect((await addPtSession(db, { ...base, startsAt: at(2, 10), endsAt: at(2, 11) })).ok).toBe(true);
    expect(await addPtSession(db, { ...base, startsAt: at(2, 10), endsAt: at(2, 11) })).toMatchObject({
      ok: false,
      error: { kind: "conflict", constraint: "akb_pt_sessions_no_overlap" },
    });
    const next = await addPtSession(db, { ...base, startsAt: at(2, 11), endsAt: at(2, 12) });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect((await setPtStatus(db, next.data, "cancelled", "Client ill")).ok).toBe(true);
    // The cancelled slot is free again; its unpaid charge was cancelled too.
    expect((await addPtSession(db, { ...base, startsAt: at(2, 11), endsAt: at(2, 12) })).ok).toBe(true);
    const charges = await listCharges(db, { clientId: c });
    expect(charges.ok && charges.data.filter((ch) => !ch.voided_at).length).toBe(2);
  });

  it("reschedules keeping the history and moving the charge's due date", async () => {
    const c = await newClient();
    const s = await addPtSession(db, { clientId: c, startsAt: at(3, 10), endsAt: at(3, 11), pricePence: 4000, packageId: null, notes: "", description: "One-to-one" });
    if (!s.ok) throw new Error("add");
    expect((await reschedulePtSession(db, s.data, at(5, 9), at(5, 10))).ok).toBe(true);
    const charges = await listCharges(db, { clientId: c });
    expect(charges.ok && charges.data[0].due_on).toBe("2026-11-05");
    const log = await sql("select action, detail->>'from' as from from akb_events where entity_id = $1 order by id", [s.data]);
    expect(log.map((e) => e.action)).toEqual(["booked", "rescheduled"]);
  });

  it("deducts a package place once per session and never past the total", async () => {
    const c = await newClient();
    const k = await addPackage(db, { clientId: c, name: "2 sessions", sessions: 2, pricePence: 6500, purchasedOn: "2026-11-01", expiresOn: null, notes: "" });
    if (!k.ok) throw new Error("package");
    const base = { clientId: c, pricePence: null, packageId: k.data, notes: "", description: "One-to-one" };
    const one = await addPtSession(db, { ...base, startsAt: at(9, 10), endsAt: at(9, 11) });
    const two = await addPtSession(db, { ...base, startsAt: at(10, 10), endsAt: at(10, 11) });
    expect(one.ok && two.ok).toBe(true);
    expect(await addPtSession(db, { ...base, startsAt: at(11, 10), endsAt: at(11, 11) })).toMatchObject({ ok: false, error: { rule: "package_used_up" } });
    let pkg = await getPackage(db, k.data);
    expect(pkg.ok && pkg.data).toMatchObject({ sessions_used: 2, sessions_remaining: 0 });

    // Marking attended twice deducts nothing more.
    if (one.ok) {
      await setPtStatus(db, one.data, "attended", "");
      await setPtStatus(db, one.data, "attended", "");
    }
    pkg = await getPackage(db, k.data);
    expect(pkg.ok && pkg.data).toMatchObject({ sessions_used: 2, sessions_delivered: 1, sessions_remaining: 0 });

    // A cancellation gives the place back.
    if (two.ok) await setPtStatus(db, two.data, "cancelled", "");
    pkg = await getPackage(db, k.data);
    expect(pkg.ok && pkg.data).toMatchObject({ sessions_used: 1, sessions_remaining: 1 });

    // Package sessions carry no per-session charge; the package has one.
    const charges = await listCharges(db, { clientId: c });
    expect(charges.ok && charges.data.map((ch) => [ch.amount_pence, ch.package_id])).toEqual([[6500, k.data]]);

    // Someone else can't use it; uncancelling past the total is refused.
    const other = await newClient();
    expect(await addPtSession(db, { ...base, clientId: other, startsAt: at(12, 10), endsAt: at(12, 11) })).toMatchObject({ ok: false, error: { rule: "package_other_client" } });
    await addPtSession(db, { ...base, startsAt: at(13, 10), endsAt: at(13, 11) });
    if (two.ok) expect(await setPtStatus(db, two.data, "scheduled", "")).toMatchObject({ ok: false, error: { rule: "package_used_up" } });
  });
});

describe("online coaching", () => {
  it("schedules the next check-in and charges each period once", async () => {
    const c = await newClient();
    const sub = await createSubscription(db, c, {
      plan: "Online coaching",
      price_pence: 7900,
      start_on: "2026-10-01",
      end_on: null,
      renews_on: "2026-10-01",
      status: "active",
      check_in_days: 7,
      next_check_in_on: "2026-10-08",
      notes: "",
    });
    if (!sub.ok) throw new Error(JSON.stringify(sub.error));
    expect((await addCheckIn(db, sub.data.id, { checkedInOn: "2026-10-09", summary: "Good week", actions: "Add a swing day" })).ok).toBe(true);
    let row = await getSubscription(db, sub.data.id);
    expect(row.ok && row.data?.next_check_in_on).toBe("2026-10-16");

    expect((await chargeSubscriptionPeriod(db, sub.data.id)).ok).toBe(true);
    row = await getSubscription(db, sub.data.id);
    expect(row.ok && row.data?.renews_on).toBe("2026-11-01");
    expect((await chargeSubscriptionPeriod(db, sub.data.id)).ok).toBe(true);
    row = await getSubscription(db, sub.data.id);
    expect(row.ok && row.data?.renews_on).toBe("2026-12-01");
    const charges = await listCharges(db, { clientId: c });
    expect(charges.ok && charges.data.map((ch) => ch.period_start)).toEqual(["2026-10-01", "2026-11-01"]);
    // Charging the same period twice is refused by the unique key.
    await expect(sql("insert into akb_charges (client_id, service, description, amount_pence, due_on, subscription_id, period_start) values ($1, 'online', 'x', 7900, '2026-10-01', $2, '2026-10-01')", [c, sub.data.id])).rejects.toThrow(/duplicate key/);
  });

  it("won't charge a paused subscription", async () => {
    const c = await newClient();
    const sub = await createSubscription(db, c, { plan: "Online", price_pence: 7900, start_on: "2026-10-01", end_on: null, renews_on: null, status: "paused", check_in_days: 7, next_check_in_on: null, notes: "" });
    if (!sub.ok) throw new Error("sub");
    expect(await chargeSubscriptionPeriod(db, sub.data.id)).toMatchObject({ ok: false, error: { rule: "subscription_inactive" } });
  });
});

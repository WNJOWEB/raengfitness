import { beforeAll, describe, expect, it } from "vitest";
import { addDays, londonToday } from "./time";
import { rpc, type Db } from "./db";
import { testDb } from "./test-support";
import { memberPauseInfo, pauseOwnMembership, undoOwnPause } from "../membership-pause";

/** A member pausing their membership (owner, 2026-11-04; migration 20261122000000) against the real schema. */

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;
const today = londonToday();

beforeAll(async () => {
  ({ db, sql } = await testDb());
}, 60_000);

/** A member whose current period began `daysAgo` days ago (4-week periods, 8 credits). */
async function member(daysAgo = 0) {
  n += 1;
  const [c] = await sql("insert into akb_clients (full_name, email, status) values ($1, $2, 'active') returning id", [`Pause ${n}`, `pause${n}@example.com`]);
  const [m] = await sql("select akb_start_membership($1, 'regular', 'Regular', 6500, 8, $2::date) as id", [c.id, addDays(today, -daysAgo)]);
  return { client: String(c.id), membership: String(m.id) };
}
const row = async (membership: string) => (await sql("select next_period_on::text as next, pause_from::text as pf, pause_until::text as pu, status from akb_memberships where id = $1", [membership]))[0];
const periods = async (membership: string) => Number((await sql("select count(*)::int as n from akb_membership_periods where membership_id = $1", [membership]))[0].n);

describe("pausing", () => {
  it("offers a pause from the end of this period for one period", async () => {
    const m = await member(10); // period -10..+17, next period on +18
    const info = await memberPauseInfo(db, m.client);
    expect(info).toEqual({ ok: true, data: { state: "none", can_pause: true, pause_from: addDays(today, 18), pause_until: addDays(today, 46) } });
  });

  it("moves the renewal on by one period, so nothing is created or charged in the paused weeks", async () => {
    const m = await member(10);
    const res = await pauseOwnMembership(db, m.client);
    expect(res).toMatchObject({ ok: true, data: { pause_from: addDays(today, 18), pause_until: addDays(today, 46), plan_name: "Regular" } });
    expect(await row(m.membership)).toMatchObject({ next: addDays(today, 46), pf: addDays(today, 18), pu: addDays(today, 46), status: "active" });
    expect((await memberPauseInfo(db, m.client))).toMatchObject({ ok: true, data: { state: "scheduled", can_pause: false, reason: "pause_active" } });
    // The daily job makes nothing until the pause ends (a Direct Debit's early run asks for periods up to
    // today + 6 days through the same next_period_on, so it waits too).
    await rpc(db, "akb_renew_memberships", { p_today: addDays(today, 45) });
    expect(await periods(m.membership)).toBe(1);
    // Then it renews as usual, on the day the pause ends.
    await rpc(db, "akb_renew_memberships", { p_today: addDays(today, 46) });
    expect(await periods(m.membership)).toBe(2);
    expect((await sql("select period_start::text as s from akb_membership_periods where membership_id = $1 order by period_start desc limit 1", [m.membership]))[0]).toEqual({ s: addDays(today, 46) });
    expect(await sql("select action from akb_events where entity_id = $1 and action = 'pause_scheduled'", [m.membership])).toHaveLength(1);
  });

  it("only once at a time, and not once the next period is set up", async () => {
    const m = await member(10);
    await pauseOwnMembership(db, m.client);
    expect(await pauseOwnMembership(db, m.client)).toMatchObject({ ok: false, error: { rule: "pause_active" } });
    // A Direct Debit member's next period is set up 6 days early: after that it is too late.
    const late = await member(0); // next period on +28
    await rpc(db, "akb_membership_ensure_periods", { p_membership: late.membership, p_through: addDays(today, 28) });
    expect(await periods(late.membership)).toBe(2);
    expect(await memberPauseInfo(db, late.client)).toMatchObject({ ok: true, data: { can_pause: false, reason: "too_late" } });
    expect(await pauseOwnMembership(db, late.client)).toMatchObject({ ok: false, error: { rule: "pause_too_late" } });
  });

  it("once every 6 months, counted from the start of the last pause", async () => {
    const recent = await member(10);
    await sql("update akb_memberships set pause_from = $2::date, pause_until = $3::date where id = $1", [recent.membership, addDays(today, -100), addDays(today, -72)]);
    const info = await memberPauseInfo(db, recent.client);
    expect(info).toMatchObject({ ok: true, data: { can_pause: false, reason: "too_soon" } });
    expect(await pauseOwnMembership(db, recent.client)).toMatchObject({ ok: false, error: { rule: "pause_too_soon" } });
    const old = await member(10);
    await sql("update akb_memberships set pause_from = $2::date, pause_until = $3::date where id = $1", [old.membership, addDays(today, -300), addDays(today, -272)]);
    expect(await pauseOwnMembership(db, old.client)).toMatchObject({ ok: true });
  });

  it("a pause undone before it begins puts the renewal back and doesn't count towards the 6 months", async () => {
    const m = await member(10);
    await pauseOwnMembership(db, m.client);
    expect(await undoOwnPause(db, m.client)).toEqual({ ok: true, data: { renews_on: addDays(today, 18), began: false } });
    expect(await row(m.membership)).toMatchObject({ next: addDays(today, 18), pf: null, pu: null });
    expect(await pauseOwnMembership(db, m.client)).toMatchObject({ ok: true });
    expect(await undoOwnPause(db, m.client)).toMatchObject({ ok: true });
    expect(await undoOwnPause(db, m.client)).toMatchObject({ ok: false, error: { rule: "no_pause" } });
  });

  it("a running pause can be ended: the membership restarts today and the pause counts", async () => {
    const m = await member(27); // period -27..0, next period on +1
    await pauseOwnMembership(db, m.client);
    // Pretend it began yesterday: it started on day +1, so move the record back two days.
    await sql("update akb_memberships set pause_from = $2::date, pause_until = $3::date, next_period_on = $3::date where id = $1", [m.membership, addDays(today, -1), addDays(today, 27)]);
    expect(await memberPauseInfo(db, m.client)).toMatchObject({ ok: true, data: { state: "paused" } });
    expect(await undoOwnPause(db, m.client)).toEqual({ ok: true, data: { renews_on: today, began: true } });
    await rpc(db, "akb_renew_memberships", { p_today: today });
    expect((await sql("select period_start::text as s from akb_membership_periods where membership_id = $1 order by period_start desc limit 1", [m.membership]))[0]).toEqual({ s: today });
    // It counts as the member's pause: no new one within 6 months.
    expect(await memberPauseInfo(db, m.client)).toMatchObject({ ok: true, data: { can_pause: false, reason: "too_soon" } });
  });

  it("nothing to pause without a running membership", async () => {
    n += 1;
    const [c] = await sql("insert into akb_clients (full_name, email, status) values ('No Plan', $1, 'active') returning id", [`noplan${n}@example.com`]);
    expect(await pauseOwnMembership(db, String(c.id))).toMatchObject({ ok: false, error: { rule: "no_membership" } });
    const cancelled = await member(5);
    await rpc(db, "akb_set_membership_status", { p_membership: cancelled.membership, p_status: "cancelled", p_on: today });
    expect(await pauseOwnMembership(db, cancelled.client)).toMatchObject({ ok: false, error: { rule: "no_membership" } });
  });
});

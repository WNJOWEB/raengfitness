import { beforeAll, describe, expect, it } from "vitest";
import { rpc, type Db } from "./db";
import { testDb } from "./test-support";

/** The credit adjuster (owner, 2026-11-04; migration 20261121000000) against the real schema. */

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;

beforeAll(async () => {
  ({ db, sql } = await testDb());
}, 60_000);

async function member() {
  n += 1;
  const [c] = await sql("insert into akb_clients (full_name, email, status) values ($1, $2, 'active') returning id", [`Credit ${n}`, `credit${n}@example.com`]);
  await sql("select akb_start_membership($1, 'regular', 'Regular', 6500, 8, akb_london_today())", [c.id]);
  const [p] = await sql("select p.id, m.id as membership from akb_membership_periods p join akb_memberships m on m.id = p.membership_id where m.client_id = $1", [c.id]);
  return { client: String(c.id), period: String(p.id), membership: String(p.membership) };
}
const adjust = (period: string, delta: number, reason = "Goodwill") => rpc<number>(db, "akb_adjust_period_credits", { p_period: period, p_delta: delta, p_reason: reason });
const total = async (period: string) => Number((await sql("select credits from akb_membership_periods where id = $1", [period]))[0].credits);

describe("adjusting a member's credits", () => {
  it("adds and takes away, returns the new total, and logs each with its reason", async () => {
    const m = await member();
    expect(await adjust(m.period, 2, "Missed a class because the venue was shut")).toEqual({ ok: true, data: 10 });
    expect(await adjust(m.period, -3, "Booked one too many by mistake")).toEqual({ ok: true, data: 7 });
    expect(await total(m.period)).toBe(7);
    expect(await sql("select detail->>'delta' as delta, detail->>'to' as to, detail->>'reason' as reason from akb_events where entity_id = $1 and action = 'credits_adjusted' order by id", [m.membership])).toEqual([
      { delta: "2", to: "10", reason: "Missed a class because the venue was shut" },
      { delta: "-3", to: "7", reason: "Booked one too many by mistake" },
    ]);
  });

  it("can't take away credits already used, or go past 60", async () => {
    const m = await member();
    // Two classes booked with credits.
    for (const day of [3, 4]) {
      const [s] = await sql("select akb_ensure_class_session('mon-evening', akb_london_today() + $1::integer, now() + make_interval(days => $1::integer), 60) as id", [day]);
      await sql("insert into akb_class_attendance (class_session_id, client_id, membership_period_id) values ($1, $2, $3)", [s.id, m.client, m.period]);
    }
    expect(await adjust(m.period, -6)).toEqual({ ok: true, data: 2 });
    expect(await adjust(m.period, -1)).toMatchObject({ ok: false, error: { rule: "invalid_credits" } });
    expect(await total(m.period)).toBe(2);
    expect(await adjust(m.period, 20)).toEqual({ ok: true, data: 22 });
    for (let i = 0; i < 2; i++) await adjust(m.period, 20);
    expect(await adjust(m.period, 20)).toMatchObject({ ok: false, error: { rule: "invalid_credits" } });
  });

  it("needs a reason and a real change of up to 20, and not a period that has ended or doesn't exist", async () => {
    const m = await member();
    expect(await adjust(m.period, 1, "   ")).toMatchObject({ ok: false, error: { rule: "reason_needed" } });
    expect(await adjust(m.period, 0)).toMatchObject({ ok: false, error: { rule: "invalid_delta" } });
    expect(await adjust(m.period, 21)).toMatchObject({ ok: false, error: { rule: "invalid_delta" } });
    expect(await adjust("00000000-0000-4000-8000-000000000000", 1)).toMatchObject({ ok: false, error: { rule: "not_found" } });
    await sql("update akb_membership_periods set period_start = akb_london_today() - 40, period_end = akb_london_today() - 12 where id = $1", [m.period]);
    expect(await adjust(m.period, 1)).toMatchObject({ ok: false, error: { rule: "period_over" } });
    expect(await total(m.period)).toBe(8);
  });
});

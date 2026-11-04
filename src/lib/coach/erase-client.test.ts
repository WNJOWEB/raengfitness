import { beforeAll, describe, expect, it } from "vitest";
import { rpc, type Db } from "./db";
import { recordPayment } from "./ledger";
import { londonToday } from "./time";
import { testDb } from "./test-support";

/**
 * Deleting a former client's personal details (owner, 2026-11-03; migration
 * 20261117000000) and signing them out everywhere, against the real schema.
 */

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;

beforeAll(async () => {
  ({ db, sql } = await testDb());
}, 60_000);

async function client() {
  n += 1;
  const email = `erase-${n}@example.com`;
  const [c] = await sql("insert into akb_clients (full_name, email, phone, instagram, notes, status) values ('Pat Erase', $1, '07700 900123', 'pat.erase', 'Knee injury in 2025', 'former') returning id", [email]);
  return { id: String(c.id), email };
}

describe("deleting a client's personal details", () => {
  it("removes contact details, notes, messages and sign-ins; keeps payments; once", async () => {
    const c = await client();
    await sql("insert into akb_booking_requests (idempotency_key, kind, service, name, email, phone, message, client_id) values ($1, 'booking', 'Group class', 'Pat Erase', $2, '07700 900123', 'My knee hurts', $3)", [`erase-req-${n}`, c.email, c.id]);
    await sql("insert into akb_member_sessions (client_id, session_hash, expires_at) values ($1, $2, now() + interval '30 days')", [c.id, "a".repeat(64)]);
    await sql("insert into akb_follow_ups (client_id, due_on, note) values ($1, current_date, 'Call Pat about knee')", [c.id]);
    const paid = await recordPayment(db, { clientId: c.id, service: "group", amountPence: 1200, paidOn: londonToday(), method: "cash", reference: "", note: "", key: `erase-pay-${n}`, allocations: [] });
    expect(paid.ok).toBe(true);

    expect((await rpc<null>(db, "akb_erase_client", { p_client: c.id })).ok).toBe(true);
    expect(await sql("select full_name, email, phone, instagram, notes, status, erased_at is not null as erased from akb_clients where id = $1", [c.id])).toEqual([
      { full_name: "Deleted client", email: "", phone: "", instagram: "", notes: "", status: "former", erased: true },
    ]);
    expect(await sql("select name, email, phone, message from akb_booking_requests where idempotency_key = $1", [`erase-req-${n}`])).toEqual([{ name: "Deleted client", email: "", phone: "", message: "" }]);
    expect(await sql("select count(*)::int as n from akb_member_sessions where client_id = $1", [c.id])).toEqual([{ n: 0 }]);
    expect(await sql("select count(*)::int as n from akb_follow_ups where client_id = $1", [c.id])).toEqual([{ n: 0 }]);
    // The money stays (tax records).
    expect(await sql("select amount_pence from akb_payments where client_id = $1", [c.id])).toEqual([{ amount_pence: 1200 }]);
    expect(await sql("select count(*)::int as n from akb_events where client_id = $1 and action = 'erased'", [c.id])).toEqual([{ n: 1 }]);
    // Again: nothing more happens.
    expect((await rpc<null>(db, "akb_erase_client", { p_client: c.id })).ok).toBe(true);
    expect(await sql("select count(*)::int as n from akb_events where client_id = $1 and action = 'erased'", [c.id])).toEqual([{ n: 1 }]);
  });

  it("is refused while a membership or a booking is still running", async () => {
    const c = await client();
    await sql("select akb_start_membership($1, 'regular', 'Regular', 6500, 8, akb_london_today())", [c.id]);
    expect(await rpc<null>(db, "akb_erase_client", { p_client: c.id })).toMatchObject({ ok: false, error: { kind: "rule", rule: "still_active" } });
    expect((await sql("select full_name from akb_clients where id = $1", [c.id]))[0].full_name).toBe("Pat Erase");
  });
});

describe("signing a client out everywhere", () => {
  it("ends every session and says how many", async () => {
    const c = await client();
    for (const h of ["b", "c"]) await sql("insert into akb_member_sessions (client_id, session_hash, expires_at) values ($1, $2, now() + interval '30 days')", [c.id, h.repeat(64)]);
    expect(await rpc<number>(db, "akb_member_end_sessions", { p_client: c.id })).toEqual({ ok: true, data: 2 });
    expect(await rpc<number>(db, "akb_member_end_sessions", { p_client: c.id })).toEqual({ ok: true, data: 0 });
  });
});

describe("staying signed in while active (owner, 2026-11-03)", () => {
  it("each use moves the session's end to 30 days on, up to a year from signing in", async () => {
    const c = await client();
    await sql("update akb_clients set status = 'active' where id = $1", [c.id]);
    await sql("select akb_start_membership($1, 'regular', 'Regular', 6500, 8, akb_london_today())", [c.id]);
    const hash = "d".repeat(64);
    // Signed in 25 days ago, last seen 10 minutes ago: 5 days left.
    await sql("insert into akb_member_sessions (client_id, session_hash, created_at, last_seen_at, expires_at) values ($1, $2, now() - interval '25 days', now() - interval '10 minutes', now() + interval '5 days')", [c.id, hash]);
    expect(await rpc<string | null>(db, "akb_member_session_client", { p_session_hash: hash })).toEqual({ ok: true, data: c.id });
    const [after] = await sql("select round(extract(epoch from expires_at - now()) / 86400) as days from akb_member_sessions where session_hash = $1", [hash]);
    expect(Number(after.days)).toBe(30);

    // Near the year's end: capped at a year after signing in.
    const old = "e".repeat(64);
    await sql("insert into akb_member_sessions (client_id, session_hash, created_at, last_seen_at, expires_at) values ($1, $2, now() - interval '360 days', now() - interval '10 minutes', now() + interval '1 day')", [c.id, old]);
    await rpc<string | null>(db, "akb_member_session_client", { p_session_hash: old });
    const [capped] = await sql("select round(extract(epoch from expires_at - now()) / 86400) as days from akb_member_sessions where session_hash = $1", [old]);
    expect(Number(capped.days)).toBe(5);

    // Unused past its end: over, as before.
    const gone = "f".repeat(64);
    await sql("insert into akb_member_sessions (client_id, session_hash, created_at, last_seen_at, expires_at) values ($1, $2, now() - interval '40 days', now() - interval '31 days', now() - interval '1 day')", [c.id, gone]);
    expect(await rpc<string | null>(db, "akb_member_session_client", { p_session_hash: gone })).toEqual({ ok: true, data: null });
  });
});

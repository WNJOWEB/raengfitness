import { beforeAll, describe, expect, it } from "vitest";
import { addAttendee, ensureClassSession, setAttendance, updateClassSession } from "./bookings";
import { createClient } from "./clients";
import { rpc, type Db } from "./db";
import { testDb } from "./test-support";
import { sha256Hex } from "../member-auth";

/**
 * The waitlist (owner, 2026-11-04; migration 20261120000000) against the real
 * schema: joining only a full class, being offered freed places in order and
 * only as many as are free, offers lapsing after a day, and every way a wait ends.
 */

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;
let dayN = 0;

beforeAll(async () => {
  ({ db, sql } = await testDb());
}, 60_000);

async function person(label = "Wait") {
  n += 1;
  const r = await createClient(db, { full_name: `${label} ${n}`, email: `${label.toLowerCase()}${n}@example.com`, phone: "07700 900123", instagram: "", preferred_contact: "", status: "active", notes: "" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data.id;
}

/** A class with `capacity` places, all taken by new clients. Dates are in the future and all different. */
async function fullClass(capacity: number) {
  dayN += 1;
  const date = new Date(Date.UTC(2027, 0, 1 + dayN * 7)).toISOString().slice(0, 10);
  const when = { slot: "sat-morning", date, startsAt: `${date}T09:00:00.000Z`, duration: 60 };
  const id = await ensureClassSession(db, when);
  if (!id.ok) throw new Error("session");
  expect((await updateClassSession(db, id.data, { capacity, notes: "" })).ok).toBe(true);
  const taken: string[] = [];
  for (let i = 0; i < capacity; i++) {
    const c = await person("Taker");
    const a = await addAttendee(db, { clientId: c, ...when, pricePence: 1000, description: "x" });
    if (!a.ok) throw new Error(JSON.stringify(a.error));
    taken.push(a.data);
  }
  return { ...when, session: id.data, taken };
}

const join = (client: string, c: { slot: string; date: string }) => rpc<{ status: string; position: number; id: string }>(db, "akb_member_waitlist_join", { p_client: client, p_slot: c.slot, p_date: c.date });
const status = async (id: string) => String((await sql("select status from akb_class_waitlist where id = $1", [id]))[0].status);

describe("joining", () => {
  it("only a full class: a free place is booked, not queued", async () => {
    const c = await fullClass(2);
    const w = await person();
    expect((await setAttendance(db, c.taken[0], "cancelled")).ok).toBe(true);
    expect(await join(w, c)).toMatchObject({ ok: false, error: { rule: "not_full" } });
  });

  it("queues in order, says the position, and a second tap changes nothing", async () => {
    const c = await fullClass(1);
    const [a, b] = [await person(), await person()];
    const first = await join(a, c);
    const second = await join(b, c);
    expect(first).toMatchObject({ ok: true, data: { status: "joined", position: 1 } });
    expect(second).toMatchObject({ ok: true, data: { status: "joined", position: 2 } });
    expect(await join(a, c)).toMatchObject({ ok: true, data: { status: "already", position: 1 } });
    expect((await sql("select count(*)::int as n from akb_class_waitlist where class_session_id = $1", [c.session]))[0].n).toBe(2);
  });

  it("not someone already booked, a class that doesn't exist yet, or a cancelled one", async () => {
    const c = await fullClass(1);
    const holder = String((await sql("select client_id from akb_class_attendance where class_session_id = $1", [c.session]))[0].client_id);
    expect(await join(holder, c)).toMatchObject({ ok: false, error: { rule: "already_booked" } });
    expect(await join(await person(), { slot: "sat-morning", date: "2030-01-05" })).toMatchObject({ ok: false, error: { rule: "class_not_found" } });
    await sql("update akb_class_sessions set cancelled_at = now(), cancel_reason = 'x' where id = $1", [c.session]);
    expect(await join(await person(), c)).toMatchObject({ ok: false, error: { rule: "class_cancelled" } });
  });

  it("a visitor joins with their details (a client is made), once per email", async () => {
    const c = await fullClass(1);
    const email = `visitor-${n}@example.com`;
    const hash = await sha256Hex("a".repeat(43));
    const r = await rpc<{ status: string; position: number }>(db, "akb_waitlist_join_public", { p_name: "Vic Visitor", p_email: ` ${email.toUpperCase()} `, p_phone: "07700 900456", p_slot: c.slot, p_date: c.date, p_token_hash: hash });
    expect(r).toMatchObject({ ok: true, data: { status: "joined", position: 1 } });
    expect((await sql("select full_name, status from akb_clients where email = $1", [email]))[0]).toEqual({ full_name: "Vic Visitor", status: "lead" });
    const again = await rpc(db, "akb_waitlist_join_public", { p_name: "Vic Visitor", p_email: email, p_phone: "07700 900456", p_slot: c.slot, p_date: c.date, p_token_hash: await sha256Hex("b".repeat(43)) });
    expect(again).toMatchObject({ ok: true, data: { status: "already" } });
  });
});

describe("a place opens", () => {
  it("offers as many people as there are free places, in order, and emails each once", async () => {
    const c = await fullClass(2);
    const [a, b, d] = [await person(), await person(), await person()];
    const wa = await join(a, c), wb = await join(b, c), wd = await join(d, c);
    if (!wa.ok || !wb.ok || !wd.ok) throw new Error("join");
    expect((await setAttendance(db, c.taken[0], "cancelled")).ok).toBe(true);
    expect([await status(wa.data.id), await status(wb.data.id), await status(wd.data.id)]).toEqual(["offered", "waiting", "waiting"]);
    // A second place: the next one is offered; the first offer is not counted as a free place.
    expect((await setAttendance(db, c.taken[1], "cancelled")).ok).toBe(true);
    expect([await status(wa.data.id), await status(wb.data.id), await status(wd.data.id)]).toEqual(["offered", "offered", "waiting"]);

    const todo = await rpc<{ id: string; offered_at: string; slot: string }[]>(db, "akb_waitlist_to_notify", {});
    const mine = todo.ok ? todo.data.filter((x) => [wa.data.id, wb.data.id].includes(x.id)) : [];
    expect(mine).toHaveLength(2);
    for (const o of mine) await rpc(db, "akb_waitlist_notified", { p_id: o.id, p_offered_at: o.offered_at });
    const after = await rpc<{ id: string }[]>(db, "akb_waitlist_to_notify", {});
    expect(after.ok && after.data.filter((x) => [wa.data.id, wb.data.id].includes(x.id))).toHaveLength(0);
  });

  it("booking the offered place ends the wait; the next person isn't offered a place that's gone", async () => {
    const c = await fullClass(1);
    const [a, b] = [await person(), await person()];
    const wa = await join(a, c), wb = await join(b, c);
    if (!wa.ok || !wb.ok) throw new Error("join");
    expect((await setAttendance(db, c.taken[0], "cancelled")).ok).toBe(true);
    expect(await status(wa.data.id)).toBe("offered");
    expect((await addAttendee(db, { clientId: a, ...c, pricePence: 1000, description: "x" })).ok).toBe(true);
    expect([await status(wa.data.id), await status(wb.data.id)]).toEqual(["booked", "waiting"]);
  });

  it("an offer nobody took within a day lapses and goes to the next person; leaving does the same at once", async () => {
    const c = await fullClass(1);
    const [a, b, d] = [await person(), await person(), await person()];
    const wa = await join(a, c), wb = await join(b, c), wd = await join(d, c);
    if (!wa.ok || !wb.ok || !wd.ok) throw new Error("join");
    await setAttendance(db, c.taken[0], "cancelled");
    expect(await status(wa.data.id)).toBe("offered");
    await sql("update akb_class_waitlist set offered_at = now() - interval '25 hours' where id = $1", [wa.data.id]);
    expect((await rpc<number>(db, "akb_waitlist_refresh", {})).ok).toBe(true);
    expect([await status(wa.data.id), await status(wb.data.id)]).toEqual(["expired", "offered"]);
    expect(await rpc(db, "akb_member_waitlist_leave", { p_client: b, p_id: wb.data.id })).toEqual({ ok: true, data: true });
    expect([await status(wb.data.id), await status(wd.data.id)]).toEqual(["left", "offered"]);
    // Leaving twice does nothing.
    expect(await rpc(db, "akb_member_waitlist_leave", { p_client: b, p_id: wb.data.id })).toEqual({ ok: true, data: false });
  });

  it("making the class bigger offers the new places; a cancelled class ends every wait", async () => {
    const c = await fullClass(1);
    const [a, b] = [await person(), await person()];
    const wa = await join(a, c), wb = await join(b, c);
    if (!wa.ok || !wb.ok) throw new Error("join");
    expect((await updateClassSession(db, c.session, { capacity: 2, notes: "" })).ok).toBe(true);
    expect([await status(wa.data.id), await status(wb.data.id)]).toEqual(["offered", "waiting"]);
    await sql("update akb_class_sessions set cancelled_at = now(), cancel_reason = 'Coach ill' where id = $1", [c.session]);
    expect([await status(wa.data.id), await status(wb.data.id)]).toEqual(["expired", "expired"]);
  });

  it("someone paying for it (a hold) ends their wait too", async () => {
    const c = await fullClass(1);
    const a = await person();
    const wa = await join(a, c);
    if (!wa.ok) throw new Error("join");
    await setAttendance(db, c.taken[0], "cancelled");
    await sql("insert into akb_class_attendance (class_session_id, client_id, status, hold_expires_at) values ($1, $2, 'booked', now() + interval '15 minutes')", [c.session, a]);
    expect(await status(wa.data.id)).toBe("booked");
  });
});

describe("leaving, and the coach's list", () => {
  it("the private link leaves once and says which class; an unknown link finds nothing", async () => {
    const c = await fullClass(1);
    const token = "c".repeat(43);
    const hash = await sha256Hex(token);
    await rpc(db, "akb_waitlist_join_public", { p_name: "Lee Leaver", p_email: `leaver-${n}@example.com`, p_phone: "07700 900789", p_slot: c.slot, p_date: c.date, p_token_hash: hash });
    expect(await rpc(db, "akb_waitlist_leave_token", { p_token_hash: hash })).toMatchObject({ ok: true, data: { slot: c.slot, class_date: c.date, was_waiting: true } });
    expect(await rpc(db, "akb_waitlist_leave_token", { p_token_hash: hash })).toMatchObject({ ok: true, data: { was_waiting: false } });
    expect(await rpc(db, "akb_waitlist_leave_token", { p_token_hash: await sha256Hex("d".repeat(43)) })).toEqual({ ok: true, data: null });
  });

  it("Alex sees who is waiting, in order, and can remove someone (the next is offered)", async () => {
    const c = await fullClass(1);
    const [a, b] = [await person("Alpha"), await person("Beta")];
    const wa = await join(a, c), wb = await join(b, c);
    if (!wa.ok || !wb.ok) throw new Error("join");
    const list = await rpc<{ name: string; status: string }[]>(db, "akb_class_waitlist_list", { p_session: c.session });
    expect(list.ok && list.data.map((x) => [x.name.split(" ")[0], x.status])).toEqual([["Alpha", "waiting"], ["Beta", "waiting"]]);
    await setAttendance(db, c.taken[0], "cancelled");
    expect(await rpc(db, "akb_waitlist_remove", { p_id: wa.data.id })).toEqual({ ok: true, data: true });
    expect([await status(wa.data.id), await status(wb.data.id)]).toEqual(["removed", "offered"]);
  });

  it("erasing a client clears their waitlist entries", async () => {
    const c = await fullClass(1);
    const a = await person();
    const wa = await join(a, c);
    if (!wa.ok) throw new Error("join");
    await sql("update akb_clients set status = 'former' where id = $1", [a]);
    expect((await rpc(db, "akb_erase_client", { p_client: a })).ok).toBe(true);
    expect((await sql("select count(*)::int as n from akb_class_waitlist where client_id = $1", [a]))[0].n).toBe(0);
  });

  it("a member's own list shows their place in the queue, for classes still to come", async () => {
    const c = await fullClass(1);
    const [a, b] = [await person(), await person()];
    await join(a, c);
    await join(b, c);
    const mine = await rpc<{ position: number; status: string; slot: string }[]>(db, "akb_member_waitlist", { p_client: b });
    expect(mine.ok && mine.data).toMatchObject([{ position: 2, status: "waiting", slot: "sat-morning" }]);
  });
});

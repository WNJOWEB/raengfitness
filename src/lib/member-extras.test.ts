import { beforeAll, describe, expect, it } from "vitest";
import { rpc, type Db } from "./coach/db";
import { recordPayment, recordRefund } from "./coach/ledger";
import { addDays, londonToday } from "./coach/time";
import { testDb } from "./coach/test-support";
import { sha256Hex } from "./member-auth";
import { memberPayments, memberReceipt, paidBy } from "./member-payments";
import { confirmEmailChange, dayBeforeSent, dueDayBefore, emailChangedNotice, emailChangeCodeEmail, memberSettings, reminderEmail, setDayBefore, startEmailChange } from "./member-settings";

/**
 * The account extras (owner, 2026-11-03) against the real migrations: the
 * day-before reminder, payment history and receipts, and changing the email.
 */

let db: Db;
let sql: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
let n = 0;

async function client(email = `extras-${++n}@example.com`) {
  const [c] = await sql("insert into akb_clients (full_name, email, status) values ('Sam Extra', $1, 'active') returning id", [email]);
  return String(c.id);
}

beforeAll(async () => {
  ({ db, sql } = await testDb());
}, 60_000);

describe("the day-before reminder", () => {
  it("is its own setting; tomorrow's classes are due once, for those who asked", async () => {
    const id = await client();
    const other = await client();
    for (const who of [id, other]) {
      await sql("select akb_start_membership($1, 'regular', 'Regular', 6500, 8, akb_london_today())", [who]);
      await sql("select akb_member_book_class($1, 'extras-tomorrow', akb_london_today() + 1, now() + interval '1 day 2 hours', 60)", [who]);
    }
    expect((await memberSettings(db, id)).ok && (await memberSettings(db, id))).toMatchObject({ data: { reminder_day_before: false } });
    expect((await setDayBefore(db, id, true)).ok).toBe(true);
    expect(await memberSettings(db, id)).toMatchObject({ data: { reminder_day_before: true, class_reminders: false } });
    const due = await dueDayBefore(db, londonToday());
    const mine = due.ok ? due.data.filter((r) => r.slot === "extras-tomorrow") : [];
    expect(mine).toHaveLength(1);
    expect(mine[0].email).toMatch(/^extras-/);
    // Not the morning-of list (that's today's classes and its own setting).
    await dayBeforeSent(db, mine[0].attendance_id);
    const again = await dueDayBefore(db, londonToday());
    expect(again.ok && again.data.filter((r) => r.slot === "extras-tomorrow")).toHaveLength(0);
    // Not for a date two days off.
    expect((await dueDayBefore(db, addDays(londonToday(), -1))).ok).toBe(true);
  });

  it("says tomorrow, not today", () => {
    const mail = reminderEmail({ attendance_id: "a", name: "Sam Extra", email: "s@example.com", starts_at: "2026-11-09T18:30:00Z", slot: "mon-evening" }, { SITE_URL: "https://raeng.example" }, true);
    expect(mail.subject).toMatch(/ tomorrow at 6:30 pm$/);
    expect(mail.text).toContain("tomorrow at 6:30 pm");
  });
});

describe("payments and receipts", () => {
  it("lists the member's own received payments with refunds, and a receipt only for their own", async () => {
    const id = await client();
    const someoneElse = await client();
    const [charge] = await sql("insert into akb_charges (client_id, service, description, amount_pence, due_on) values ($1, 'group', 'Group class, Monday 9 November 2026, 6:30 pm', 1200, current_date) returning id", [id]);
    const paid = await recordPayment(db, { clientId: id, service: "group", amountPence: 1200, paidOn: londonToday(), method: "cash", reference: "", note: "", key: `extras-pay-${n}`, allocations: [{ charge_id: String(charge.id), amount_pence: 1200 }] });
    if (!paid.ok) throw new Error("payment");
    expect((await recordRefund(db, { paymentId: paid.data, amountPence: 200, refundedOn: londonToday(), note: "", key: `extras-ref-${n}`, chargeId: String(charge.id), voidCharge: false })).ok).toBe(true);
    const other = await recordPayment(db, { clientId: someoneElse, service: "pt", amountPence: 4000, paidOn: londonToday(), method: "bank_transfer", reference: "", note: "", key: `extras-other-${n}`, allocations: [] });
    if (!other.ok) throw new Error("other");

    const list = await memberPayments(db, id);
    expect(list.ok && list.data).toEqual([
      { id: paid.data, paid_on: londonToday(), amount_pence: 1200, method: "cash", provider: "manual", description: "Group class, Monday 9 November 2026, 6:30 pm", refunded_pence: 200 },
    ]);
    const receipt = await memberReceipt(db, id, paid.data);
    expect(receipt.ok && receipt.data).toMatchObject({ amount_pence: 1200, refunds: [{ amount_pence: 200, refunded_on: londonToday() }] });
    // Someone else's payment isn't theirs to see.
    expect(await memberReceipt(db, id, other.data)).toEqual({ ok: true, data: null });
    const theirs = await memberPayments(db, someoneElse);
    expect(theirs.ok && theirs.data[0]).toMatchObject({ description: "1:1 coaching", method: "bank_transfer" });
  });

  it("says how it was paid in plain words", () => {
    expect(paidBy({ method: "card", provider: "stripe" })).toBe("Through Stripe");
    expect(paidBy({ method: "cash", provider: "manual" })).toBe("Cash");
    expect(paidBy({ method: "bank_transfer", provider: "manual" })).toBe("Bank transfer");
  });
});

describe("changing the email", () => {
  it("changes only with the code sent to the new address; a wrong code counts, 5 and it stops", async () => {
    const id = await client("old-address@example.com");
    expect((await startEmailChange(db, id, " New-Address@Example.com ", await sha256Hex("123456"))).ok).toBe(true);
    // Wrong codes: nothing changes.
    for (let i = 0; i < 2; i++) expect(await confirmEmailChange(db, id, await sha256Hex("000000"))).toEqual({ ok: true, data: null });
    expect((await sql("select email from akb_clients where id = $1", [id]))[0].email).toBe("old-address@example.com");
    expect(await confirmEmailChange(db, id, await sha256Hex("123456"))).toEqual({ ok: true, data: { old_email: "old-address@example.com", new_email: "new-address@example.com" } });
    expect((await sql("select email from akb_clients where id = $1", [id]))[0].email).toBe("new-address@example.com");
    // Used: the same code does nothing again.
    expect(await confirmEmailChange(db, id, await sha256Hex("123456"))).toEqual({ ok: true, data: null });
    // The log says it changed, without the addresses.
    expect(await sql("select detail from akb_events where client_id = $1 and action = 'email_changed'", [id])).toEqual([{ detail: { by: "member" } }]);

    const locked = await client();
    await startEmailChange(db, locked, `locked-new-${n}@example.com`, await sha256Hex("654321"));
    for (let i = 0; i < 5; i++) await confirmEmailChange(db, locked, await sha256Hex("111111"));
    expect(await confirmEmailChange(db, locked, await sha256Hex("654321"))).toEqual({ ok: true, data: null });
  });

  it("refuses the same address, one another account has, and more than 5 asks an hour", async () => {
    const id = await client("mine@example.com");
    await client("taken@example.com");
    expect(await startEmailChange(db, id, "MINE@example.com", await sha256Hex("123456"))).toMatchObject({ ok: false, error: { rule: "same_email" } });
    expect(await startEmailChange(db, id, "taken@example.com", await sha256Hex("123456"))).toMatchObject({ ok: false, error: { rule: "email_taken" } });
    for (let i = 0; i < 5; i++) expect((await startEmailChange(db, id, `try-${i}@example.com`, await sha256Hex("123456"))).ok).toBe(true);
    expect(await startEmailChange(db, id, "try-6@example.com", await sha256Hex("123456"))).toMatchObject({ ok: false, error: { rule: "too_many" } });
  });

  it("the emails: the code to the new address, and a note to the old one showing only part of the new", () => {
    expect(emailChangeCodeEmail("482913")).toMatchObject({ subject: "Your RAENG email change code: 482 913" });
    const notice = emailChangedNotice("samuel@example.com");
    expect(notice.text).toContain("sa••••@example.com");
    expect(notice.text).not.toContain("samuel@");
  });

  it("an unknown account can't start a change", async () => {
    const r = await rpc<null>(db, "akb_member_email_change_start", { p_client: "00000000-0000-4000-8000-000000000000", p_new_email: "x@example.com", p_code_hash: "0".repeat(64) });
    expect(r.ok).toBe(false);
  });
});

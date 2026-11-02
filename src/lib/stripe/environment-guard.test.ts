import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "../coach/clients";
import { insert, rpc } from "../coach/db";
import { addCharge } from "../coach/ledger";
import { testDb } from "../coach/test-support";

/**
 * The database-level safeguard (supabase/migrations/20261102000000_akb_stripe.sql):
 * a database with no role marker is production and refuses every Test-mode
 * record; one marked 'test' refuses live ones. Two separate databases.
 */

async function setup(marker: "test" | null) {
  const t = await testDb();
  if (marker) await t.sql(`insert into akb_database_role (role) values ('${marker}')`);
  const c = await createClient(t.db, { full_name: "Guard", email: `guard-${marker}@example.com`, phone: "", instagram: "", preferred_contact: "", status: "active", notes: "" });
  if (!c.ok) throw new Error("client");
  const ch = await addCharge(t.db, { clientId: c.data.id, service: "pt", description: "Session", amountPence: 3500, dueOn: "2026-10-24" });
  if (!ch.ok) throw new Error("charge");
  return { ...t, client: c.data.id, charge: ch.data.id };
}

const payment = (client: string, provider: string) => ({
  client_id: client, service: "pt", amount_pence: 3500, paid_on: "2026-10-24", method: "card",
  idempotency_key: `${provider}:PAY-1`, provider, provider_payment_id: "PAY-1",
});

describe("production database (no marker)", () => {
  let p: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    p = await setup(null);
  }, 60_000);

  it("is production by default", async () => {
    expect(await p.sql("select akb_database_role() as role")).toEqual([{ role: "production" }]);
  });

  it("refuses Test-mode payment links, events and payments, by any route", async () => {
    const link = await insert(p.db, "akb_stripe_payment_links", { environment: "sandbox", charge_id: p.charge, client_id: p.client, amount_pence: 3500 });
    expect(link).toMatchObject({ ok: false, error: { rule: "sandbox_in_production" } });
    const event = await insert(p.db, "akb_stripe_events", { event_id: "evt-sb", environment: "sandbox", type: "checkout.session.completed" });
    expect(event).toMatchObject({ ok: false, error: { rule: "sandbox_in_production" } });
    const pay = await insert(p.db, "akb_payments", payment(p.client, "stripe_sandbox"));
    expect(pay).toMatchObject({ ok: false, error: { rule: "sandbox_in_production" } });
    // Even as the database owner, outside the app.
    await expect(p.sql("insert into akb_stripe_events (event_id, environment, type) values ('evt-sb2', 'sandbox', 'x')")).rejects.toThrow(/sandbox_in_production/);
    const applied = await rpc(p.db, "akb_apply_stripe_session", { p_environment: "sandbox", p_session_id: "cs_test_1", p_session_status: "complete", p_payment_status: "paid", p_payment_intent: "pi_1", p_amount_pence: 3500, p_currency: "gbp", p_paid_on: "2026-10-24" });
    expect(applied).toMatchObject({ ok: true, data: "unknown_session" });
    expect(await p.sql("select count(*)::int as n from akb_payments where provider = 'stripe_sandbox'")).toEqual([{ n: 0 }]);
  });

  it("accepts live records and leaves manual payments alone", async () => {
    expect((await insert(p.db, "akb_stripe_payment_links", { environment: "production", charge_id: p.charge, client_id: p.client, amount_pence: 3500 })).ok).toBe(true);
    expect((await insert(p.db, "akb_payments", payment(p.client, "stripe"))).ok).toBe(true);
    expect((await insert(p.db, "akb_payments", { ...payment(p.client, "manual"), method: "cash", idempotency_key: "cash-1", provider_payment_id: null })).ok).toBe(true);
  });

  it("the site's server role can read the marker but not set it", async () => {
    await p.sql("set role service_role");
    try {
      expect(await p.sql("select akb_database_role() as role")).toEqual([{ role: "production" }]);
      await expect(p.sql("insert into akb_database_role (role) values ('test')")).rejects.toThrow(/permission denied/);
    } finally {
      await p.sql("reset role");
    }
    for (const role of ["anon", "authenticated"]) {
      await p.sql(`set role ${role}`);
      try {
        await expect(p.sql("select * from akb_database_role")).rejects.toThrow(/permission denied/);
      } finally {
        await p.sql("reset role");
      }
    }
  });
});

describe("test database (marked 'test')", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await setup("test");
  }, 60_000);

  it("accepts Test-mode records and refuses live ones", async () => {
    expect((await insert(t.db, "akb_stripe_payment_links", { environment: "sandbox", charge_id: t.charge, client_id: t.client, amount_pence: 3500 })).ok).toBe(true);
    expect((await insert(t.db, "akb_payments", payment(t.client, "stripe_sandbox"))).ok).toBe(true);
    expect(await insert(t.db, "akb_payments", { ...payment(t.client, "stripe"), idempotency_key: "stripe:PAY-2", provider_payment_id: "PAY-2" })).toMatchObject({ ok: false, error: { rule: "live_in_test" } });
    expect(await insert(t.db, "akb_stripe_events", { event_id: "evt-live", environment: "production", type: "checkout.session.completed" })).toMatchObject({ ok: false, error: { rule: "live_in_test" } });
  });

  it("re-running the migration keeps the marker and the data", async () => {
    const migration = readFileSync(new URL("../../../supabase/migrations/20261102000000_akb_stripe.sql", import.meta.url), "utf8");
    const before = await t.sql("select count(*)::int as n from akb_stripe_payment_links");
    await t.exec(migration);
    await t.exec(migration);
    expect(await t.sql("select akb_database_role() as role")).toEqual([{ role: "test" }]);
    expect(await t.sql("select count(*)::int as n from akb_stripe_payment_links")).toEqual(before);
  });

  it("has one marker only", async () => {
    await expect(t.sql("insert into akb_database_role (role) values ('production')")).rejects.toThrow(/duplicate key/);
  });
});

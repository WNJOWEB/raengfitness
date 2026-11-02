import { inList, insert, select, type Db } from "../coach/db";
import { formatPence } from "../coach/money";
import type { Env } from "../env";
import { bookingDeliveryConfig } from "../booking-request";
import { sendNotice } from "../notices";

/**
 * Receipts for payments on a Card link Alex made in the coach portal (a plain
 * charge). Class bookings, membership sign-ups, renewals and Direct Debit
 * collections each have their own emails, so they're skipped here. For each
 * such payment recorded by Stripe's verified webhook (or the reconcile job),
 * the customer gets "we've received your payment" and Alex gets the same,
 * once: a `receipt_sent` row in the event log marks it, so retries and the
 * daily job never send it twice. Best effort; without email settings nothing
 * is marked, so it's tried again once email is set up.
 */
export async function notifyChargePayments(db: Db, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!bookingDeliveryConfig(env)) return 0;
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const payments = await select<{ id: string; client_id: string; amount_pence: number; provider: string }>(db, "akb_payments", [
    ["select", "id,client_id,amount_pence,provider"],
    ["provider", "in.(stripe,stripe_test)"],
    ["status", "eq.received"],
    ["created_at", `gte.${since}`],
    ["order", "created_at.asc"],
    ["limit", "50"],
  ]);
  if (!payments.ok || payments.data.length === 0) return 0;
  const ids = payments.data.map((p) => p.id);

  const done = await select<{ entity_id: string }>(db, "akb_events", [["select", "entity_id"], ["entity", "eq.payment"], ["action", "eq.receipt_sent"], ["entity_id", inList(ids)]]);
  const sentFor = new Set(done.ok ? done.data.map((d) => d.entity_id) : []);
  const pending = payments.data.filter((p) => !sentFor.has(p.id));
  if (pending.length === 0) return 0;

  // Which charge each payment paid, through its link; then drop charges that have their own emails.
  const links = await select<{ paid_payment_id: string; charge_id: string }>(db, "akb_square_payment_links", [
    ["select", "paid_payment_id,charge_id"],
    ["paid_payment_id", inList(pending.map((p) => p.id))],
  ]);
  if (!links.ok) return 0;
  const chargeOf = new Map(links.data.map((l) => [l.paid_payment_id, l.charge_id]));
  const chargeIds = [...new Set(links.data.map((l) => l.charge_id))];
  if (chargeIds.length === 0) return 0;
  const owned = new Set<string>();
  for (const [table, column] of [["akb_class_bookings", "charge_id"], ["akb_membership_signups", "charge_id"], ["akb_membership_periods", "charge_id"]] as const) {
    const rows = await select<Record<string, string | null>>(db, table, [["select", column], [column, inList(chargeIds)]]);
    if (!rows.ok) return 0; // can't tell which are plain charges: send nothing rather than guess
    for (const r of rows.data) if (r[column]) owned.add(r[column] as string);
  }

  const charges = await select<{ id: string; description: string }>(db, "akb_charges", [["select", "id,description"], ["id", inList(chargeIds)]]);
  const clients = await select<{ id: string; full_name: string; email: string }>(db, "akb_clients", [["select", "id,full_name,email"], ["id", inList([...new Set(pending.map((p) => p.client_id))])]]);
  if (!charges.ok || !clients.ok) return 0;

  let sent = 0;
  for (const p of pending) {
    const chargeId = chargeOf.get(p.id);
    if (!chargeId || owned.has(chargeId)) continue;
    const person = clients.data.find((c) => c.id === p.client_id);
    if (!person) continue;
    const what = charges.data.find((c) => c.id === chargeId)?.description || "your payment";
    const amount = formatPence(p.amount_pence);
    const test = p.provider.includes("test");
    const hasEmail = Boolean(person.email);
    const result = await sendNotice(
      {
        label: "payment-receipt",
        key: `payment-receipt/${p.id}`,
        customer: hasEmail ? { email: person.email, subject: `We've received your payment: ${amount}`, text: `Thank you. We've received your card payment of ${amount} for ${what}.` } : undefined,
        alex: {
          subject: `Payment received: ${person.full_name}, ${amount}`,
          text: `${person.full_name}${hasEmail ? ` (${person.email})` : ""} paid ${amount} by card for ${what}${test ? " (Stripe test payment)" : ""}. It's recorded against their charge.${hasEmail ? "" : "\n\nThey have no email address on file, so no receipt was sent to them. Add one to their client record to send receipts."}`,
          replyTo: hasEmail ? person.email : undefined,
        },
      },
      env,
      fetchImpl,
    );
    // Marked only when every email that could go did, so a failed one is tried again (the key stops a repeat of the one that did).
    if ((result.customer || !hasEmail) && result.alex) {
      const marked = await insert(db, "akb_events", { client_id: p.client_id, entity: "payment", entity_id: p.id, action: "receipt_sent", detail: {} });
      if (marked.ok) sent += 1;
    }
  }
  return sent;
}

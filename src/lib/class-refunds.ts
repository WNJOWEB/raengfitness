import { rpc, selectOne, type Db } from "./coach/db";
import { formatPence } from "./coach/money";
import type { Env } from "./env";
import { sendNotice } from "./notices";
import { createRefund } from "./stripe/api";
import type { StripeConfig } from "./stripe/config";
import { syncRefund } from "./stripe/sync";

/**
 * Refunds for paid group classes cancelled 24 hours or more before (Alex,
 * 2026-11-05: "anyone who cancels with at least 24 hours notice will get
 * their credit, refund and free introduction class back").
 *
 * The cancel functions mark the booking `refund_due`; this asks Stripe for a
 * refund of whatever of the payment is still unrefunded, with one
 * idempotency key per booking, so retries and double taps can't refund twice.
 * The refund is then mirrored into the ledger by `syncRefund` (and again by
 * the signed webhook), which cancels the class fee once all of it is back.
 * Nothing here trusts the browser: the amount and the payment come from the
 * database.
 *
 * - "requested": Stripe accepted it.
 * - "retry": Stripe refused or didn't answer; the daily job tries again (up to
 *   5 times) and Alex is emailed once.
 * - "manual": the payment was recorded by hand (cash, transfer) or isn't a
 *   Stripe payment in this environment; Alex is emailed to refund it.
 * - "none": nothing to refund (not due, already requested, or nothing left).
 */
export type RefundOutcome = "requested" | "retry" | "manual" | "none";

interface RefundInfo {
  booking_id: string;
  client_id: string;
  due: boolean;
  requested: boolean;
  provider: string | null;
  provider_payment_id: string | null;
  method: string | null;
  remaining_pence: number;
}

const providerFor = (stripe: StripeConfig) => (stripe.environment === "production" ? "stripe" : "stripe_test");

export async function refundCancelledClass(
  db: Db,
  bookingId: string,
  stripe: StripeConfig | null,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ outcome: RefundOutcome; amountPence: number }> {
  const info = await rpc<RefundInfo | null>(db, "akb_class_refund_info", { p_booking: bookingId });
  if (!info.ok || !info.data) return { outcome: "retry", amountPence: 0 };
  const r = info.data;
  if (!r.due || r.requested || r.remaining_pence <= 0) return { outcome: "none", amountPence: r.remaining_pence };
  const amountPence = r.remaining_pence;

  const byStripe = stripe !== null && r.provider === providerFor(stripe) && /^pi_/.test(r.provider_payment_id ?? "");
  if (!byStripe) {
    // Recorded by hand, or a Stripe payment we can't reach from here: Alex refunds it.
    const tell = await rpc<boolean>(db, "akb_class_refund_mark", { p_booking: bookingId, p_refund_id: null, p_manual: true });
    if (tell.ok && tell.data) await alertAlex(db, r, amountPence, "manual", env, fetchImpl);
    return { outcome: "manual", amountPence };
  }

  const refund = await createRefund(
    stripe,
    { paymentIntentId: r.provider_payment_id!, amountPence, idempotencyKey: `class-cancel-refund:${bookingId}`, metadata: { booking_id: bookingId, reason: "cancelled_in_time" } },
    fetchImpl,
  );
  if (!refund.ok) {
    console.error(`Class refund not accepted by Stripe (status ${refund.status ?? "none"})`);
    const tell = await rpc<boolean>(db, "akb_class_refund_mark", { p_booking: bookingId, p_refund_id: null, p_manual: false });
    if (tell.ok && tell.data) await alertAlex(db, r, amountPence, "retry", env, fetchImpl);
    return { outcome: "retry", amountPence };
  }
  await rpc<boolean>(db, "akb_class_refund_mark", { p_booking: bookingId, p_refund_id: refund.data.id, p_manual: false });
  // Mirror it now (the webhook does it too; both are idempotent).
  await syncRefund(db, stripe, refund.data.id, fetchImpl).catch(() => null);
  return { outcome: "requested", amountPence };
}

/** Daily: retries refunds Stripe didn't accept the first time. Returns how many were accepted. */
export async function retryClassRefunds(db: Db, stripe: StripeConfig | null, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const due = await rpc<string[]>(db, "akb_class_refunds_due", {});
  if (!due.ok) return 0;
  let done = 0;
  for (const id of due.data) {
    const out = await refundCancelledClass(db, id, stripe, env, fetchImpl);
    if (out.outcome === "requested") done++;
  }
  return done;
}

/** What the customer is told about the money. */
export function refundSentence(outcome: RefundOutcome, amountPence: number): string {
  const amount = amountPence > 0 ? `your ${formatPence(amountPence)}` : "your payment";
  return outcome === "manual"
    ? `Alex will refund ${amount} and let you know when it's done.`
    : `We're refunding ${amount} to the card you paid with. Depending on your bank, it can take a few working days to show.`;
}

/** Alex's line about the money. */
export function refundSentenceForAlex(outcome: RefundOutcome, amountPence: number): string {
  const amount = formatPence(amountPence);
  return outcome === "requested"
    ? `It was 24 hours or more before the class, so their ${amount} card payment has been refunded automatically.`
    : outcome === "manual"
      ? `It was 24 hours or more before the class, so they're owed a refund of ${amount}. The payment wasn't by card online, so please refund it yourself.`
      : `It was 24 hours or more before the class, so they're owed a refund of ${amount}. Stripe didn't accept the refund just now; the site will try again tomorrow.`;
}

async function alertAlex(db: Db, r: RefundInfo, amountPence: number, outcome: "manual" | "retry", env: Env, fetchImpl: typeof fetch) {
  const person = await selectOne<{ full_name: string; email: string | null }>(db, "akb_clients", r.client_id);
  const who = person.ok && person.data ? `${person.data.full_name}${person.data.email ? ` (${person.data.email})` : ""}` : "A customer";
  await sendNotice(
    {
      label: "class-refund",
      key: `class-refund/${r.booking_id}/${outcome}`,
      alex: {
        subject: outcome === "manual" ? `Refund to make: ${formatPence(amountPence)}` : `Refund not made yet: ${formatPence(amountPence)}`,
        text:
          outcome === "manual"
            ? `${who} cancelled a paid group class 24 hours or more before, so it's refunded in full. The payment (${r.method ?? "recorded by hand"}) wasn't taken by card online, so the site can't refund it. Please refund ${formatPence(amountPence)} to them, then record the refund on their payment in the coach area.\n\nBooking: ${r.booking_id}`
            : `${who} cancelled a paid group class 24 hours or more before, so it's refunded in full, but Stripe didn't accept the refund of ${formatPence(amountPence)} just now. The site will try again each day. If it's still not done in a couple of days, refund it in the Stripe Dashboard; it's recorded here automatically.\n\nBooking: ${r.booking_id}`,
      },
    },
    env,
    fetchImpl,
  );
}

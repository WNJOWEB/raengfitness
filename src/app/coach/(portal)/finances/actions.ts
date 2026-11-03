"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { paymentMethods } from "@/content/payments";
import { failure, type ActionState } from "@/lib/coach/action-state";
import { getClient } from "@/lib/coach/clients";
import { actionContext } from "@/lib/coach/context";
import { isUuid } from "@/lib/coach/db";
import { dbMessage } from "@/lib/coach/errors";
import { allocatePayment, getCharge, getPayment, listCharges, planAllocations, recordPayment, recordRefund, SERVICE_KEYS, setPaymentStatus } from "@/lib/coach/ledger";
import { formatPence } from "@/lib/coach/money";
import { formatDate } from "@/lib/coach/time";
import { sendNotice } from "@/lib/notices";
import { addDays } from "@/lib/coach/time";
import { FormReader } from "@/lib/coach/validate";

const CHECK = "Please check the highlighted fields.";
const METHODS = paymentMethods.map((m) => m.value);

/**
 * Records money received (cash or bank transfer, entered by the coach). The
 * form carries a one-off key, so a double submit records one payment. The
 * money is set against the chosen charge first, then (if asked) the client's
 * oldest charges; anything left is their credit.
 */
export async function recordPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const chargeId = form.id("charge", { label: "a charge" });
  const amount = form.pounds("amount", { label: "the amount", required: true });
  const paidOn = form.date("paid_on", { label: "the payment date", required: true });
  const method = form.oneOf("method", METHODS, { label: "how they paid", required: true });
  const service = form.oneOf("service", SERVICE_KEYS, { label: "the service", required: true });
  const apply = form.oneOf("apply", ["charge", "oldest", "none"] as const, { label: "what it pays for", required: true });
  const reference = form.text("reference", { label: "the reference", max: 200 });
  const note = form.text("note", { label: "the note", max: 1000, multiline: true });
  const key = String(formData.get("key") ?? "");
  if (paidOn && (paidOn > ctx.today || paidOn < addDays(ctx.today, -3 * 365))) form.error("paid_on", "Enter a date that isn't in the future.");
  if (apply === "charge" && !chargeId) form.error("apply", "There's no charge chosen: pick “Oldest charges first” or “Don't set it against anything”.");
  if (!isUuid(key)) return failure("This form has expired. Refresh the page and try again.");
  if (!form.ok || amount === null || !method || !service || !apply) return failure(CHECK, form.errors);

  const client = await getClient(ctx.db, clientId);
  if (!client.ok) return failure(dbMessage(client.error));
  if (!client.data) return failure("That client no longer exists.", { client: "Choose a client." });
  const open = await listCharges(ctx.db, { clientId, openOnly: true });
  if (!open.ok) return failure(dbMessage(open.error));

  let allocations: { charge_id: string; amount_pence: number }[] = [];
  if (apply === "charge") {
    const charge = open.data.find((c) => c.id === chargeId);
    if (!charge) return failure("That charge is already paid or cancelled. Refresh and try again.", { apply: "Choose another option." });
    allocations = [{ charge_id: charge.id, amount_pence: Math.min(amount, charge.outstanding_pence) }];
  } else if (apply === "oldest") {
    allocations = planAllocations(amount, open.data).allocations;
  }

  const result = await recordPayment(ctx.db, { clientId, service, amountPence: amount, paidOn, method, reference, note, key, allocations });
  if (!result.ok) return failure(dbMessage(result.error));
  // A receipt for the client (best effort; the payment is recorded). The key is this form's one-off key, so a double submit emails once.
  const receiptTo = client.data.email;
  if (receiptTo) {
    const how = paymentMethods.find((m) => m.value === method)?.label.toLowerCase() ?? "payment";
    const forWhat = allocations.length === 1 ? open.data.find((c) => c.id === allocations[0].charge_id)?.description : "";
    after(() =>
      sendNotice({
      label: "payment-recorded-by-coach",
      key: `payment-recorded/${result.data}`,
      customer: {
        email: receiptTo,
        subject: `We've received your payment: ${formatPence(amount)}`,
        text: `Thank you. We've recorded your ${how} payment of ${formatPence(amount)}, received on ${formatDate(paidOn as Parameters<typeof formatDate>[0])}${forWhat ? ` for ${forWhat}` : ""}.`,
      },
      }).catch(() => null),
    );
  }
  redirect(`/coach/finances/payments/${result.data}?done=recorded`);
}

export async function allocateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const paymentId = form.id("payment", { label: "a payment", required: true });
  const chargeId = form.id("charge", { label: "a charge", required: true });
  const amount = form.pounds("amount", { label: "the amount", required: true });
  if (!form.ok || amount === null) return failure(CHECK, form.errors);
  const [payment, charge] = await Promise.all([getPayment(ctx.db, paymentId), getCharge(ctx.db, chargeId)]);
  if (!payment.ok) return failure(dbMessage(payment.error));
  if (!charge.ok) return failure(dbMessage(charge.error));
  if (!payment.data || !charge.data) return failure("That payment or charge no longer exists.");
  if (amount > payment.data.unallocated_pence) return failure(CHECK, { amount: `Only ${formatPence(payment.data.unallocated_pence)} of this payment is free.` });
  if (amount > charge.data.outstanding_pence) return failure(CHECK, { amount: `Only ${formatPence(charge.data.outstanding_pence)} is owed on that charge.` });
  const result = await allocatePayment(ctx.db, paymentId, chargeId, amount);
  if (!result.ok) return failure(dbMessage(result.error));
  redirect(`/coach/finances/payments/${paymentId}?done=allocated`);
}

export async function refundAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const paymentId = form.id("payment", { label: "a payment", required: true });
  const amount = form.pounds("amount", { label: "the refund", required: true });
  const refundedOn = form.date("refunded_on", { label: "the refund date", required: true });
  const chargeId = form.id("charge", { label: "a charge" });
  const voidCharge = form.checked("void_charge");
  const note = form.text("note", { label: "the reason", max: 1000, multiline: true, required: true });
  const key = String(formData.get("key") ?? "");
  if (refundedOn && refundedOn > ctx.today) form.error("refunded_on", "A refund can't be in the future.");
  if (voidCharge && !chargeId) form.error("charge", "Choose the charge to cancel.");
  if (!isUuid(key)) return failure("This form has expired. Refresh the page and try again.");
  if (!form.ok || amount === null) return failure(CHECK, form.errors);
  const payment = await getPayment(ctx.db, paymentId);
  if (!payment.ok) return failure(dbMessage(payment.error));
  if (!payment.data) return failure("That payment no longer exists.");
  if (amount > payment.data.amount_pence - payment.data.refunded_pence) return failure(CHECK, { amount: `At most ${formatPence(payment.data.amount_pence - payment.data.refunded_pence)} can be refunded.` });
  const result = await recordRefund(ctx.db, { paymentId, amountPence: amount, refundedOn, note, key, chargeId: chargeId || null, voidCharge });
  if (!result.ok) {
    if (result.error.rule === "refund_needs_charge") return failure(dbMessage(result.error), { charge: "Choose the charge this refund is for." });
    return failure(dbMessage(result.error));
  }
  redirect(`/coach/finances/payments/${paymentId}?done=refunded`);
}

export async function paymentStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const paymentId = form.id("payment", { label: "a payment", required: true });
  const status = form.oneOf("status", ["failed", "void"] as const, { label: "a status", required: true });
  const reason = form.text("reason", { label: "the reason", max: 300, required: true });
  if (!form.ok || !status) return failure(CHECK, form.errors);
  const result = await setPaymentStatus(ctx.db, paymentId, status, reason);
  if (!result.ok) return failure(dbMessage(result.error));
  redirect(`/coach/finances/payments/${paymentId}?done=${status}`);
}

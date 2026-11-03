"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { membershipPlans } from "@/content/memberships";
import { failure, success, type ActionState } from "@/lib/coach/action-state";
import { getClient } from "@/lib/coach/clients";
import { actionContext } from "@/lib/coach/context";
import { dbMessage } from "@/lib/coach/errors";
import { getMembership, MEMBERSHIP_STATUSES, returnCredit, setMembershipStatus, startMembership, payWithCredit } from "@/lib/coach/memberships";
import { formatDate } from "@/lib/coach/time";
import { getRequest } from "@/lib/coach/requests";
import { sendNotice } from "@/lib/notices";
import { stripeConfig } from "@/lib/stripe/config";
import { endUnusedDirectDebit } from "@/lib/stripe/direct-debit";
import { FormReader } from "@/lib/coach/validate";

const CHECK = "Please check the highlighted fields.";
const PLAN_IDS = membershipPlans.map((p) => p.id);

/** Starts a membership on a published plan: its first period, credits and charge. */
export async function startMembershipAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const plan = form.oneOf("plan", PLAN_IDS, { label: "a plan", required: true });
  const startOn = form.date("start_on", { label: "the start date", required: true });
  const requestId = form.id("request", { label: "the request" });
  const notes = form.text("notes", { label: "the notes", max: 2000, multiline: true });
  if (!form.ok || !plan) return failure(CHECK, form.errors);
  const client = await getClient(ctx.db, clientId);
  if (!client.ok) return failure(dbMessage(client.error));
  if (!client.data) return failure("That client no longer exists.", { client: "Choose a client." });
  if (requestId) {
    const request = await getRequest(ctx.db, requestId);
    if (!request.ok) return failure(dbMessage(request.error));
  }
  const result = await startMembership(ctx.db, { clientId, plan, startOn, requestId: requestId || null, notes });
  if (!result.ok) return failure(dbMessage(result.error));
  redirect(`/coach/memberships/${result.data}?done=started`);
}

/** Pause, resume or cancel. */
export async function membershipStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const id = form.id("membership", { label: "a membership", required: true });
  const status = form.oneOf("status", MEMBERSHIP_STATUSES, { label: "a status", required: true });
  const on = form.date("on", { label: "the date" }) || ctx.today;
  if (!form.ok || !status) return failure(CHECK, form.errors);
  const found = await getMembership(ctx.db, id);
  if (!found.ok) return failure(dbMessage(found.error));
  if (!found.data) return failure("That membership no longer exists.");
  const result = await setMembershipStatus(ctx.db, id, status, on);
  if (!result.ok) return failure(dbMessage(result.error));
  // Cancelled: the member's Direct Debit is cancelled with Stripe too (owner, 2026-11-03; the daily job retries).
  const stripe = status === "cancelled" ? stripeConfig() : null;
  if (stripe) {
    const clientId = found.data.client_id;
    after(() => endUnusedDirectDebit(ctx.db, stripe, clientId).then(() => undefined, () => undefined));
  }
  // The member is told what Alex did to their membership, after the reply (best effort; the change itself has happened).
  const person = await getClient(ctx.db, found.data.client_id);
  if (person.ok && person.data) {
    const plan = `${found.data.plan_name} membership`;
    const nextOn = found.data.next_period_on;
    const words =
      status === "active"
        ? { subject: "Your RAENG membership is back on", text: `Your ${plan} has been restarted. New periods and credits continue from the next renewal${nextOn ? ` (${formatDate(nextOn as Parameters<typeof formatDate>[0])})` : ""}.` }
        : status === "paused"
          ? { subject: "Your RAENG membership is paused", text: `Your ${plan} has been paused. No new periods or payments are taken until it's restarted. Credits you've already been given stay usable until the end of their period.` }
          : { subject: "Your RAENG membership is cancelled", text: `Your ${plan} has been cancelled and nothing more will be taken. Credits you've already been given stay usable until the end of their period.` };
    const email = person.data.email;
    after(() =>
      sendNotice({
        label: `membership-${status}-by-coach`,
        key: `membership-${status}-by-coach/${id}/${on}/${new Date().toISOString().slice(0, 16)}`,
        customer: { email, ...words },
      }).catch(() => null),
    );
  }
  refresh();
  return success(status === "active" ? "Resumed." : status === "paused" ? "Paused: no new periods until you resume it." : "Cancelled: no new periods. Credits already given stay usable in their period.");
}

/** Pays for a class place with the member's credit. */
export async function payWithCreditAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const attendance = form.id("attendance", { label: "a place", required: true });
  if (!form.ok) return failure(CHECK, form.errors);
  const result = await payWithCredit(ctx.db, attendance);
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success("Paid with a membership credit.");
}

/** Gives a forfeited credit back. */
export async function returnCreditAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const attendance = form.id("attendance", { label: "a place", required: true });
  if (!form.ok) return failure(CHECK, form.errors);
  const result = await returnCredit(ctx.db, attendance);
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success("Credit returned; the place is cancelled.");
}

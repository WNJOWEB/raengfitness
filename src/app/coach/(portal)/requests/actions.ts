"use server";

import { redirect } from "next/navigation";
import { failure, type ActionState } from "@/lib/coach/action-state";
import { listAttendance, setAttendance, listPtSessions, setPtStatus } from "@/lib/coach/bookings";
import { classChargeDescription, classDurationMinutes, findSlot, isTimetableClass, occurrence } from "@/lib/coach/classes";
import { getClient } from "@/lib/coach/clients";
import { actionContext } from "@/lib/coach/context";
import { dbMessage } from "@/lib/coach/errors";
import { confirmRequest, getRequest, markNotified, setRequestStatus, type ConfirmBooking } from "@/lib/coach/requests";
import { addDays, formatDateTime, londonToUtc } from "@/lib/coach/time";
import { payWithCredit, periodOn } from "@/lib/coach/memberships";
import { FormReader } from "@/lib/coach/validate";
import { decisionMessage } from "@/lib/coach/notify";
import { sendNotice } from "@/lib/notices";

/**
 * Booking request decisions. Each checks the coach's session first
 * (actionContext), validates on the server, and changes the request only from
 * a state where that decision makes sense, so a stale page or a double click
 * can't overwrite an earlier decision.
 */

const NOT_FOUND = failure("That request no longer exists. Go back to the inbox.");

export async function confirmRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const { db, today } = ctx;
  const form = new FormReader(formData);
  const requestId = form.id("request", { label: "a request", required: true });
  const choice = String(formData.get("client") ?? "");
  const note = form.text("note", { label: "the note", max: 1000, multiline: true });
  const bookingKind = form.oneOf("booking", ["class", "pt", "none"] as const, { label: "what to book", required: true });
  if (!form.ok) return failure("Please check the highlighted fields.", form.errors);

  const request = await getRequest(db, requestId);
  if (!request.ok) return failure(dbMessage(request.error));
  if (!request.data) return NOT_FOUND;
  if (!["new", "awaiting"].includes(request.data.status)) return failure("This request has already been decided. Refresh to see it.");

  // Who: an existing client (chosen explicitly) or a new one.
  let clientId: string | null = null;
  let newClient: { full_name: string; email: string; phone: string } | null = null;
  if (choice === "new") {
    const fullName = form.text("full_name", { label: "their name", max: 100, required: true });
    const email = form.email("email");
    const phone = form.phone("phone");
    newClient = { full_name: fullName, email, phone };
  } else if (/^[0-9a-f-]{36}$/i.test(choice)) {
    const client = await getClient(db, choice);
    if (!client.ok) return failure(dbMessage(client.error));
    if (!client.data) form.error("client", "That client no longer exists. Choose again.");
    clientId = choice;
  } else {
    form.error("client", "Choose an existing client or create a new one.");
  }

  // What: a class place, a one-to-one session, or nothing yet.
  let booking: ConfirmBooking = { kind: "none" };
  let useCredit = false;
  if (bookingKind === "class") {
    const [date = "", slotId = ""] = String(formData.get("class") ?? "").split("|");
    const slot = findSlot(slotId);
    useCredit = formData.get("credit") === "on";
    const price = useCredit ? 0 : form.pounds("class_price", { label: "the class price", allowZero: true, required: true });
    if (useCredit) {
      // Checked before anything is saved: their period must cover the class and have a credit left.
      const period = clientId && date ? await periodOn(db, clientId, date) : null;
      if (period && !period.ok) return failure(dbMessage(period.error));
      if (!period?.data) form.error("credit", "They have no membership period covering that class. Untick to charge the price.");
      else if (period.data.credits_left <= 0) form.error("credit", "No credits left in their current period. Untick to charge the price.");
    }
    if (!slot || !isTimetableClass(date, slotId, today)) form.error("class", "Choose a class from the timetable.");
    else if (date < today) form.error("class", "That class has already happened. Choose an upcoming one.");
    if (form.ok && slot) {
      const occ = occurrence(date, slot);
      booking = { kind: "class", slot: slot.id, date, starts_at: occ.startsAt, duration: classDurationMinutes(slot), price_pence: price ?? 0, description: classChargeDescription(date, slot) };
    }
  } else if (bookingKind === "pt") {
    const date = form.date("pt_date", { label: "the session date", required: true });
    const time = form.time("pt_time", { label: "the start time", required: true });
    const minutes = form.int("pt_minutes", { label: "the length in minutes", min: 15, max: 240, required: true });
    const packageId = form.id("pt_package", { label: "a package" });
    const price = packageId ? null : form.pounds("pt_price", { label: "the session price", allowZero: true, required: true });
    if (date && date < addDays(today, -365)) form.error("pt_date", "Enter a date within the last year or in the future.");
    if (packageId && !clientId) form.error("pt_package", "A package can only be used by an existing client.");
    if (form.ok) {
      const startsAt = londonToUtc(date, time);
      const endsAt = new Date(Date.parse(startsAt) + (minutes ?? 60) * 60_000).toISOString();
      booking = { kind: "pt", starts_at: startsAt, ends_at: endsAt, price_pence: price, package_id: packageId || null, description: "One-to-one session" };
    }
  }
  if (!form.ok) return failure("Please check the highlighted fields.", form.errors);

  const result = await confirmRequest(db, { requestId, clientId, newClient, booking, note });
  if (!result.ok) return failure(dbMessage(result.error));
  // Tell them it's confirmed, in the same words Alex's "Let them know" box suggests (best effort; he can still send it by hand).
  const who = await getClient(db, result.data.client_id);
  const booked =
    booking.kind === "class" && findSlot(booking.slot)
      ? `Kettlebell Training, ${formatDateTime(booking.starts_at)}`
      : booking.kind === "pt"
        ? `one-to-one session, ${formatDateTime(booking.starts_at)}`
        : undefined;
  if (who.ok && who.data && booked) {
    const message = decisionMessage({ name: request.data.name, status: "confirmed", summary: request.data.summary, service: request.data.service, decision_note: note }, booked);
    const sent = await sendNotice({ label: "request-confirmed", key: `request-confirmed/${requestId}`, customer: { email: who.data.email, subject: message.subject, text: message.body } });
    if (sent.customer) await markNotified(db, requestId);
  }
  if (useCredit && result.data.booked_id) {
    const credit = await payWithCredit(db, result.data.booked_id);
    redirect(`/coach/requests/${requestId}?done=${credit.ok ? "confirmed-credit" : "confirmed-no-credit"}`);
  }
  redirect(`/coach/requests/${requestId}?done=confirmed`);
}

async function simpleDecision(formData: FormData, status: "awaiting" | "declined" | "completed" | "cancelled", messages: { stale: string }): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const { db } = ctx;
  const form = new FormReader(formData);
  const requestId = form.id("request", { label: "a request", required: true });
  const note = form.text("note", { label: "the note", max: 1000, multiline: true, required: status === "declined" });
  if (!form.ok) return failure("Please check the highlighted fields.", form.errors);

  const before = await getRequest(db, requestId);
  if (!before.ok) return failure(dbMessage(before.error));
  if (!before.data) return NOT_FOUND;

  const result = await setRequestStatus(db, requestId, status, note);
  if (!result.ok) return failure(dbMessage(result.error));
  if (!result.data) return failure(messages.stale);
  const wasConfirmed = before.data.status === "confirmed";

  // Cancelling a confirmed request also cancels what it booked (unpaid charges are cancelled with it).
  if (status === "cancelled" && before.data.status === "confirmed") {
    const [places, sessions] = await Promise.all([
      before.data.client_id ? listAttendance(db, { clientId: before.data.client_id }) : Promise.resolve({ ok: true as const, data: [] }),
      before.data.client_id ? listPtSessions(db, { clientId: before.data.client_id }) : Promise.resolve({ ok: true as const, data: [] }),
    ]);
    if (!places.ok || !sessions.ok) return failure("The request was cancelled, but its booking couldn't be found. Cancel the class place or session by hand.");
    for (const place of places.data.filter((p) => p.request_id === requestId && p.status === "booked")) {
      const r = await setAttendance(db, place.id, "cancelled");
      if (!r.ok) return failure(`The request was cancelled, but the class place wasn't: ${dbMessage(r.error)}`);
    }
    for (const s of sessions.data.filter((p) => p.request_id === requestId && p.status === "scheduled")) {
      const r = await setPtStatus(db, s.id, "cancelled", note || "Request cancelled");
      if (!r.ok) return failure(`The request was cancelled, but the session wasn't: ${dbMessage(r.error)}`);
    }
  }
  // Tell the requester about a decision that affects them (the decline uses Alex's own suggested wording, including his note).
  if (status === "declined" || (status === "cancelled" && wasConfirmed)) {
    const what = before.data.kind === "online" ? "online coaching enquiry" : "booking request";
    const message =
      status === "declined"
        ? decisionMessage({ name: before.data.name, status: "declined", summary: before.data.summary, service: before.data.service, decision_note: note }, undefined)
        : {
            subject: `Your ${before.data.service.toLowerCase()} booking is cancelled`,
            body: [`Hi ${before.data.name.trim().split(/\s+/)[0] || "there"},`, "", `Your ${what} has been cancelled, and what was booked with it is cancelled too.${note ? `\n\n${note}` : ""}`, "", "Message me if you'd like to rearrange."].join("\n"),
          };
    const sent = await sendNotice({ label: `request-${status}`, key: `request-${status}/${requestId}`, customer: { email: before.data.email, subject: message.subject, text: message.body } });
    if (sent.customer) await markNotified(db, requestId);
  }
  redirect(`/coach/requests/${requestId}?done=${status}`);
}

export async function awaitingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return simpleDecision(formData, "awaiting", { stale: "Only new requests can be marked as awaiting a response." });
}

export async function declineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return simpleDecision(formData, "declined", { stale: "This request has already been decided. Refresh to see it." });
}

export async function cancelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return simpleDecision(formData, "cancelled", { stale: "This request can't be cancelled from its current state. Refresh to see it." });
}

export async function completeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return simpleDecision(formData, "completed", { stale: "Only confirmed requests can be completed." });
}

export async function notifiedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const requestId = form.id("request", { label: "a request", required: true });
  if (!form.ok) return NOT_FOUND;
  const result = await markNotified(ctx.db, requestId);
  if (!result.ok) return failure(dbMessage(result.error));
  if (!result.data) return NOT_FOUND;
  redirect(`/coach/requests/${requestId}?done=told`);
}

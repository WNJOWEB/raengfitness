"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { failure, success, type ActionState } from "@/lib/coach/action-state";
import { addAttendee, ATTENDANCE_STATUSES, cancelClass, ensureClassSession, getAttendance, listAttendance, removeFromWaitlist, setAttendance, setAttendanceNotes, setDefaultCapacity, setSlotCapacity, updateClassSession } from "@/lib/coach/bookings";
import { classChargeDescription, classDurationMinutes, classSlots, findSlot, isTimetableClass, occurrence, slotLabel } from "@/lib/coach/classes";
import { getClient } from "@/lib/coach/clients";
import { actionContext } from "@/lib/coach/context";
import { dbMessage } from "@/lib/coach/errors";
import { ATTENDANCE_STATUS } from "@/lib/coach/labels";
import { FormReader } from "@/lib/coach/validate";
import { classWhen } from "@/lib/class-checkout";
import { sendNotice } from "@/lib/notices";
import { afterPlacesChange } from "@/lib/waitlist";
import { adjustCredits, payWithCredit, periodOn } from "@/lib/coach/memberships";

const CHECK = "Please check the highlighted fields.";

/** "2026-10-24|sat-morning" -> a checked timetable class, or null. */
function readClass(form: FormReader, raw: string, today: string) {
  const [date = "", slotId = ""] = raw.split("|");
  const slot = findSlot(slotId);
  if (!slot || !isTimetableClass(date, slotId, today)) {
    form.error("class", "Choose a class from the timetable.");
    return null;
  }
  return { date, slot };
}

export async function addAttendeeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const useCredit = form.checked("credit");
  const price = useCredit ? 0 : form.pounds("price", { label: "the price", required: true, allowZero: true });
  const chosen = readClass(form, String(formData.get("class") ?? ""), ctx.today);
  if (!form.ok || !chosen || price === null) return failure(CHECK, form.errors);
  const client = await getClient(ctx.db, clientId);
  if (!client.ok) return failure(dbMessage(client.error));
  if (!client.data) return failure("That client no longer exists.", { client: "Choose a client." });
  // A member's place: check there's a credit before adding them, so nobody is added unpaid by mistake.
  if (useCredit) {
    const period = await periodOn(ctx.db, clientId, chosen.date);
    if (!period.ok) return failure(dbMessage(period.error));
    if (!period.data) return failure(dbMessage({ kind: "rule", code: "P0001", rule: "no_membership" }), { credit: "No membership period covers this class." });
    if (period.data.credits_left < 1) return failure(dbMessage({ kind: "rule", code: "P0001", rule: "no_credits" }), { credit: "No credits left in this period." });
  }
  const occ = occurrence(chosen.date, chosen.slot);
  const result = await addAttendee(ctx.db, {
    clientId,
    slot: chosen.slot.id,
    date: chosen.date,
    startsAt: occ.startsAt,
    duration: classDurationMinutes(chosen.slot),
    pricePence: price,
    description: classChargeDescription(chosen.date, chosen.slot),
  });
  if (!result.ok) return failure(dbMessage(result.error));
  if (useCredit) {
    const paid = await payWithCredit(ctx.db, result.data);
    refresh();
    if (!paid.ok) return failure(`${client.data.full_name} was added, but the credit couldn't be used: ${dbMessage(paid.error)}`);
    return success(`${client.data.full_name} added, paid with a membership credit.`);
  }
  refresh();
  return success(`${client.data.full_name} added${price > 0 ? ", with the class charge" : ""}.`);
}

export async function setAttendanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const id = form.id("attendance", { label: "a place", required: true });
  const status = form.oneOf("status", ATTENDANCE_STATUSES, { label: "a status", required: true });
  if (!form.ok || !status) return failure("That change isn't possible.");
  const before = await getAttendance(ctx.db, id);
  if (!before.ok) return failure(dbMessage(before.error));
  if (!before.data) return failure("That place no longer exists.");
  const result = await setAttendance(ctx.db, id, status);
  if (!result.ok) return failure(dbMessage(result.error));
  // A cancelled place may free one for the waitlist.
  if (status === "cancelled") after(() => afterPlacesChange(ctx.db));
  refresh();
  return success(`Marked ${ATTENDANCE_STATUS[status].toLowerCase()}${status === "cancelled" ? ". An unpaid charge for it was cancelled too" : ""}.`);
}

/** Cancels the whole class (coach's decision): places cancelled, credits returned, unpaid charges cancelled. */
export async function cancelClassAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const chosen = readClass(form, String(formData.get("class") ?? ""), ctx.today);
  const reason = form.text("reason", { label: "the reason", max: 500, multiline: true });
  if (!form.ok || !chosen) return failure(CHECK, form.errors);
  const occ = occurrence(chosen.date, chosen.slot);
  const id = await ensureClassSession(ctx.db, { slot: chosen.slot.id, date: chosen.date, startsAt: occ.startsAt, duration: classDurationMinutes(chosen.slot) });
  if (!id.ok) return failure(dbMessage(id.error));
  // Who is booked now, before the places are cancelled, so each person can be told.
  const booked = await listAttendance(ctx.db, { sessionIds: [id.data] });
  const result = await cancelClass(ctx.db, id.data, reason);
  if (!result.ok) return failure(dbMessage(result.error));
  const n = result.data;
  const attendees = booked.ok ? booked.data.filter((p) => p.status === "booked") : [];
  // Everyone is emailed after the reply, one at a time (one tap no longer waits for a dozen emails).
  if (attendees.length > 0) {
    const when = classWhen(chosen.date, chosen.slot);
    after(async () => {
      for (const place of attendees) {
        try {
          const person = await getClient(ctx.db, place.client_id);
          if (!person.ok || !person.data) continue;
          await sendNotice({
            label: "class-cancelled-by-coach",
            key: `class-cancelled/${place.id}`,
            customer: {
              email: person.data.email,
              subject: `Class cancelled: ${when}`,
              text: `The group class on ${when} has been cancelled by Alex, so your place is cancelled.${reason ? `\n\nReason: ${reason}` : ""}\n\nAny membership credit you used has been returned to your account. If you paid for this class by card and can't make another date, reply to this email and we'll refund your payment to your card.`,
            },
          });
        } catch {
          console.error("Class cancellation email failed");
        }
      }
    });
  }
  refresh();
  const emailed = attendees.length > 0 ? ` They're being emailed now.` : "";
  return success(`Class cancelled. ${n === 0 ? "Nobody was booked." : `${n} ${n === 1 ? "place" : "places"} cancelled; members' credits are back and unpaid class charges are cancelled.${emailed || " Let each person know."}${emailed ? " Anyone who paid for the class needs sorting out by you." : ""}`}`);
}

export async function updateClassAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const chosen = readClass(form, String(formData.get("class") ?? ""), ctx.today);
  const capacity = form.int("capacity", { label: "the capacity", min: 1, max: 200 });
  const notes = form.text("notes", { label: "the notes", max: 1000, multiline: true });
  if (!form.ok || !chosen) return failure(CHECK, form.errors);
  const occ = occurrence(chosen.date, chosen.slot);
  const id = await ensureClassSession(ctx.db, { slot: chosen.slot.id, date: chosen.date, startsAt: occ.startsAt, duration: classDurationMinutes(chosen.slot) });
  if (!id.ok) return failure(dbMessage(id.error));
  const result = await updateClassSession(ctx.db, id.data, { capacity, notes });
  if (!result.ok) return failure(dbMessage(result.error));
  // A bigger class frees places for the waitlist.
  after(() => afterPlacesChange(ctx.db));
  refresh();
  return success(capacity ? `Saved. This class holds ${capacity}.` : "Saved. This class uses the usual class size.");
}

/** The usual class size, for every class without its own. */
export async function setDefaultCapacityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const size = form.int("size", { label: "the class size", min: 1, max: 200, required: true });
  if (!form.ok || size === null) return failure(CHECK, form.errors);
  const result = await setDefaultCapacity(ctx.db, size);
  if (!result.ok) return failure(dbMessage(result.error));
  after(() => afterPlacesChange(ctx.db));
  refresh();
  return success(`Saved. Classes now hold ${size} unless you set a different size for a date.`);
}

/** A usual size for each class time (owner, 2026-11-04); an empty box removes it, so that time uses the all-classes size. */
export async function setSlotCapacitiesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const sizes = classSlots().map((s) => ({ slot: s.id, size: form.int(`slot-${s.id}`, { label: `the size for ${slotLabel(s)}`, min: 1, max: 200 }) }));
  if (!form.ok) return failure(CHECK, form.errors);
  for (const { slot, size } of sizes) {
    const result = await setSlotCapacity(ctx.db, slot, size);
    if (!result.ok) return failure(dbMessage(result.error));
  }
  after(() => afterPlacesChange(ctx.db));
  refresh();
  return success("Saved. Each class time now uses its own size, or the size for every class where it's empty.");
}

/** Alex's private note on one person's place (owner, 2026-11-04). Empty clears it. */
export async function saveAttendanceNotesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const id = form.id("attendance", { label: "a place", required: true });
  const notes = form.text("notes", { label: "the note", max: 1000, multiline: true });
  if (!form.ok || !id) return failure(CHECK, form.errors);
  const result = await setAttendanceNotes(ctx.db, id, notes ?? "");
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success(notes ? "Note saved." : "Note cleared.");
}

/** The credit adjuster (owner, 2026-11-04): add or take away credits on a member's current period, with a reason. */
export async function adjustCreditsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const period = form.id("period", { label: "a membership period", required: true });
  const delta = form.int("delta", { label: "the change", min: -20, max: 20, required: true });
  const reason = form.text("reason", { label: "the reason", max: 200, required: true });
  if (!form.ok || !period || delta === null || !reason) return failure(CHECK, form.errors);
  if (delta === 0) return failure("Choose how many credits to add or take away.");
  const result = await adjustCredits(ctx.db, period, delta, reason);
  if (!result.ok) {
    const rule = result.error.kind === "rule" ? result.error.rule : null;
    return failure(
      rule === "invalid_credits"
        ? "That would take it below the credits already used, or above 60."
        : rule === "period_over"
          ? "That period has ended."
          : dbMessage(result.error),
    );
  }
  refresh();
  return success(`Done. They now have ${result.data} credits this period.`);
}

/** Takes someone off a class's waitlist. */
export async function removeFromWaitlistAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const id = form.id("entry", { label: "a waitlist place", required: true });
  if (!form.ok || !id) return failure("That place on the waitlist no longer exists.");
  const result = await removeFromWaitlist(ctx.db, id);
  if (!result.ok) return failure(dbMessage(result.error));
  after(() => afterPlacesChange(ctx.db));
  refresh();
  return success(result.data ? "Taken off the waitlist." : "They're not on the waitlist any more.");
}

"use server";

import { refresh } from "next/cache";
import { failure, success, type ActionState } from "@/lib/coach/action-state";
import { addAttendee, ATTENDANCE_STATUSES, cancelClass, ensureClassSession, getAttendance, listAttendance, setAttendance, setDefaultCapacity, updateClassSession } from "@/lib/coach/bookings";
import { classChargeDescription, classDurationMinutes, findSlot, isTimetableClass, occurrence } from "@/lib/coach/classes";
import { getClient } from "@/lib/coach/clients";
import { actionContext } from "@/lib/coach/context";
import { dbMessage } from "@/lib/coach/errors";
import { ATTENDANCE_STATUS } from "@/lib/coach/labels";
import { FormReader } from "@/lib/coach/validate";
import { classWhen } from "@/lib/class-checkout";
import { sendNotice } from "@/lib/notices";
import { payWithCredit, periodOn } from "@/lib/coach/memberships";

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
  let told = 0;
  if (booked.ok) {
    const when = classWhen(chosen.date, chosen.slot);
    for (const place of booked.data.filter((p) => p.status === "booked")) {
      const person = await getClient(ctx.db, place.client_id);
      if (!person.ok || !person.data) continue;
      const sent = await sendNotice({
        label: "class-cancelled-by-coach",
        key: `class-cancelled/${place.id}`,
        customer: {
          email: person.data.email,
          subject: `Class cancelled: ${when}`,
          text: `The group class on ${when} has been cancelled by Alex, so your place is cancelled.${reason ? `\n\nReason: ${reason}` : ""}\n\nAny membership credit you used has been returned to your account. If you paid for this class by card and can't make another date, reply to this email and we'll refund your payment to your card.`,
        },
      });
      if (sent.customer) told += 1;
    }
  }
  refresh();
  const emailed = told > 0 ? ` ${told} ${told === 1 ? "person has" : "people have"} been emailed.` : "";
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
  refresh();
  return success(`Saved. Classes now hold ${size} unless you set a different size for a date.`);
}

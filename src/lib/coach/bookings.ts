import { defaultClassCapacity } from "@/content/classes";
import { inList, rpc, select, selectOne, update, type Db, type DbResult } from "./db";
import type { Attendance, AttendanceStatus, ClassSessionRow, Package, PtSession, PtStatus } from "./types";

/* ------------------------------------------------------------------ classes */

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ["booked", "attended", "no_show", "cancelled"];

/** Class rows (with headcounts) between two dates. Dates without a row have no bookings yet. */
export function listClassSessions(db: Db, from: string, to: string): Promise<DbResult<ClassSessionRow[]>> {
  return select<ClassSessionRow>(db, "akb_class_overview", [["class_date", `gte.${from}`], ["class_date", `lte.${to}`], ["order", "starts_at.asc"]]);
}

export async function getClassSession(db: Db, slot: string, date: string): Promise<DbResult<ClassSessionRow | null>> {
  const result = await select<ClassSessionRow>(db, "akb_class_overview", [["slot", `eq.${slot}`], ["class_date", `eq.${date}`], ["limit", "1"]]);
  return result.ok ? { ok: true, data: result.data[0] ?? null } : result;
}

/** The usual class size (the portal setting; 12 until Alex changes it, and if it can't be read). */
export async function getDefaultCapacity(db: Db): Promise<number> {
  const result = await rpc<number>(db, "akb_default_class_capacity", {});
  return result.ok && Number.isInteger(result.data) && result.data > 0 ? result.data : defaultClassCapacity;
}

export function setDefaultCapacity(db: Db, capacity: number): Promise<DbResult<null>> {
  return rpc<null>(db, "akb_set_default_class_capacity", { p_capacity: capacity });
}

/** The slots that have a usual size of their own ({"mon-evening": 12}); a slot not listed uses the all-classes size (migration 20261119000000). */
export async function getSlotCapacities(db: Db): Promise<Record<string, number>> {
  const result = await rpc<Record<string, number>>(db, "akb_slot_capacities", {});
  return result.ok && result.data && typeof result.data === "object" ? result.data : {};
}

/** Sets a slot's usual size; null removes it. */
export function setSlotCapacity(db: Db, slot: string, capacity: number | null): Promise<DbResult<null>> {
  return rpc<null>(db, "akb_set_slot_capacity", { p_slot: slot, p_capacity: capacity });
}

/** The class row for a timetable date, created if needed. Only call for a date checked with isTimetableClass. */
export function ensureClassSession(db: Db, args: { slot: string; date: string; startsAt: string; duration: number }): Promise<DbResult<string>> {
  return rpc<string>(db, "akb_ensure_class_session", { p_slot: args.slot, p_date: args.date, p_starts_at: args.startsAt, p_duration: args.duration });
}

export async function updateClassSession(db: Db, id: string, patch: { capacity: number | null; notes: string }): Promise<DbResult<null>> {
  const result = await update(db, "akb_class_sessions", [["id", `eq.${id}`]], { ...patch, updated_at: new Date().toISOString() });
  return result.ok ? { ok: true, data: null } : result;
}

/** Cancels a whole class: every booked place, with members' credits returned. Returns how many places. */
export function cancelClass(db: Db, id: string, reason: string): Promise<DbResult<number>> {
  return rpc<number>(db, "akb_cancel_class", { p_session: id, p_reason: reason });
}

export function listAttendance(db: Db, opts: { sessionIds?: string[]; clientId?: string }): Promise<DbResult<Attendance[]>> {
  const query: [string, string][] = [];
  if (opts.sessionIds) query.push(["class_session_id", inList(opts.sessionIds)]);
  if (opts.clientId) query.push(["client_id", `eq.${opts.clientId}`]);
  query.push(["order", "created_at.asc"], ["limit", "1000"]);
  return select<Attendance>(db, "akb_class_attendance", query);
}

export function getAttendance(db: Db, id: string): Promise<DbResult<Attendance | null>> {
  return selectOne<Attendance>(db, "akb_class_attendance", id);
}

/** Adds someone to a class and raises the class charge (one transaction). */
export function addAttendee(
  db: Db,
  args: { clientId: string; slot: string; date: string; startsAt: string; duration: number; pricePence: number; description: string; requestId?: string | null },
): Promise<DbResult<string>> {
  return rpc<string>(db, "akb_add_attendee", {
    p_client: args.clientId,
    p_slot: args.slot,
    p_date: args.date,
    p_starts_at: args.startsAt,
    p_duration: args.duration,
    p_price_pence: args.pricePence,
    p_description: args.description,
    p_request: args.requestId ?? null,
  });
}

export function setAttendance(db: Db, id: string, status: AttendanceStatus): Promise<DbResult<null>> {
  return rpc<null>(db, "akb_set_attendance", { p_attendance: id, p_status: status });
}

export function classSessionsByIds(db: Db, ids: string[]): Promise<DbResult<ClassSessionRow[]>> {
  return select<ClassSessionRow>(db, "akb_class_overview", [["id", inList(ids)]]);
}

/* ------------------------------------------------------------- one-to-one */

export const PT_STATUSES: readonly PtStatus[] = ["scheduled", "attended", "no_show", "cancelled"];

export function listPtSessions(db: Db, opts: { from?: string; to?: string; clientId?: string; status?: PtStatus[]; packageId?: string; order?: "asc" | "desc"; limit?: number } = {}): Promise<DbResult<PtSession[]>> {
  const query: [string, string][] = [];
  if (opts.from) query.push(["starts_at", `gte.${opts.from}`]);
  if (opts.to) query.push(["starts_at", `lt.${opts.to}`]);
  if (opts.clientId) query.push(["client_id", `eq.${opts.clientId}`]);
  if (opts.packageId) query.push(["package_id", `eq.${opts.packageId}`]);
  if (opts.status) query.push(["status", `in.(${opts.status.join(",")})`]);
  query.push(["order", `starts_at.${opts.order ?? "asc"}`], ["limit", String(opts.limit ?? 500)]);
  return select<PtSession>(db, "akb_pt_sessions", query);
}

export function getPtSession(db: Db, id: string): Promise<DbResult<PtSession | null>> {
  return selectOne<PtSession>(db, "akb_pt_sessions", id);
}

/** Books a session (and its charge unless it uses a package) in one transaction. */
export function addPtSession(
  db: Db,
  args: { clientId: string; startsAt: string; endsAt: string; pricePence: number | null; packageId: string | null; requested?: string; notes: string; description: string; requestId?: string | null },
): Promise<DbResult<string>> {
  return rpc<string>(db, "akb_add_pt_session", {
    p_client: args.clientId,
    p_starts_at: args.startsAt,
    p_ends_at: args.endsAt,
    p_price_pence: args.pricePence,
    p_package: args.packageId,
    p_requested: args.requested ?? "",
    p_notes: args.notes,
    p_description: args.description,
    p_request: args.requestId ?? null,
  });
}

export function reschedulePtSession(db: Db, id: string, startsAt: string, endsAt: string): Promise<DbResult<null>> {
  return rpc<null>(db, "akb_reschedule_pt_session", { p_session: id, p_starts_at: startsAt, p_ends_at: endsAt });
}

export function setPtStatus(db: Db, id: string, status: PtStatus, reason: string): Promise<DbResult<null>> {
  return rpc<null>(db, "akb_set_pt_status", { p_session: id, p_status: status, p_reason: reason });
}

export async function updatePtNotes(db: Db, id: string, notes: string): Promise<DbResult<null>> {
  const result = await update(db, "akb_pt_sessions", [["id", `eq.${id}`]], { notes, updated_at: new Date().toISOString() });
  return result.ok ? { ok: true, data: null } : result;
}

/* ----------------------------------------------------------------- packages */

export function listPackages(db: Db, opts: { clientId?: string; activeOnly?: boolean; ids?: string[] } = {}): Promise<DbResult<Package[]>> {
  const query: [string, string][] = [];
  if (opts.clientId) query.push(["client_id", `eq.${opts.clientId}`]);
  if (opts.activeOnly) query.push(["status", "eq.active"]);
  if (opts.ids) query.push(["id", inList(opts.ids)]);
  query.push(["order", "purchased_on.desc"], ["limit", "500"]);
  return select<Package>(db, "akb_package_balances", query);
}

export function getPackage(db: Db, id: string): Promise<DbResult<Package | null>> {
  return selectOne<Package>(db, "akb_package_balances", id);
}

export function addPackage(
  db: Db,
  args: { clientId: string; name: string; sessions: number; pricePence: number; purchasedOn: string; expiresOn: string | null; notes: string },
): Promise<DbResult<string>> {
  return rpc<string>(db, "akb_add_package", {
    p_client: args.clientId,
    p_name: args.name,
    p_sessions: args.sessions,
    p_price_pence: args.pricePence,
    p_purchased_on: args.purchasedOn,
    p_expires_on: args.expiresOn,
    p_notes: args.notes,
  });
}

export async function cancelPackage(db: Db, id: string): Promise<DbResult<null>> {
  const result = await update(db, "akb_packages", [["id", `eq.${id}`]], { status: "cancelled", updated_at: new Date().toISOString() });
  return result.ok ? { ok: true, data: null } : result;
}

/* --------------------------------------------------------------- waitlist */

export interface WaitlistPerson {
  id: string;
  status: "waiting" | "offered";
  created_at: string;
  offered_at: string | null;
  client_id: string;
  name: string;
  email: string;
  phone: string;
}

/** Who is waiting for a full class, in the order they joined (migration 20261120000000). */
export async function listWaitlist(db: Db, sessionId: string): Promise<DbResult<WaitlistPerson[]>> {
  return rpc<WaitlistPerson[]>(db, "akb_class_waitlist_list", { p_session: sessionId });
}

/** Alex takes someone off a waitlist; the next person is offered a freed offer. */
export function removeFromWaitlist(db: Db, id: string): Promise<DbResult<boolean>> {
  return rpc<boolean>(db, "akb_waitlist_remove", { p_id: id });
}

/** Alex's private note on one person's place in a class (never shown to them). */
export async function setAttendanceNotes(db: Db, id: string, notes: string): Promise<DbResult<null>> {
  const result = await update(db, "akb_class_attendance", [["id", `eq.${id}`]], { notes, updated_at: new Date().toISOString() });
  return result.ok ? { ok: true, data: null } : result;
}

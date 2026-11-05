import { groupClass, timetable } from "@/content/classes";
import { getService } from "@/content/services";
import type { ClassSession, Weekday } from "@/content/types";
import { poundsToPence } from "./money";
import { addDays, addMonths, formatClock, formatDate, isDateKey, londonToUtc, weekday, type DateKey } from "./time";

/**
 * Group class dates for the portal, from the one timetable in
 * src/content/classes.ts (the same one the public site and /book use).
 */

const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface ClassOccurrence {
  date: DateKey;
  slot: ClassSession;
  /** UTC ISO instant of the start, from UK local time. */
  startsAt: string;
}

export function classSlots(): readonly ClassSession[] {
  return timetable.sessions;
}

export function findSlot(id: string): ClassSession | undefined {
  return timetable.sessions.find((s) => s.id === id);
}

/** How far back and ahead the portal accepts class dates. */
export const CLASS_DATE_LIMITS = { pastMonths: 24, futureMonths: 12 } as const;

/**
 * Server check: is this a real class in the timetable (right weekday for the
 * slot) within the portal's window? Used before anything is written.
 */
export function isTimetableClass(date: string, slotId: string, today: DateKey): boolean {
  const slot = findSlot(slotId);
  if (!slot || !isDateKey(date)) return false;
  if (date < addMonths(today, -CLASS_DATE_LIMITS.pastMonths) || date > addMonths(today, CLASS_DATE_LIMITS.futureMonths)) return false;
  return WEEKDAYS[weekday(date)] === slot.day;
}

export function occurrence(date: DateKey, slot: ClassSession): ClassOccurrence {
  return { date, slot, startsAt: londonToUtc(date, slot.start) };
}

/** Every class from `from` to `to` inclusive, in time order. */
export function classOccurrences(from: DateKey, to: DateKey): ClassOccurrence[] {
  const list: ClassOccurrence[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = WEEKDAYS[weekday(date)];
    for (const slot of timetable.sessions.filter((s) => s.day === day).sort((a, b) => a.start.localeCompare(b.start))) {
      list.push(occurrence(date, slot));
    }
  }
  return list;
}

/** "Saturday 10:15 am" */
export function slotLabel(slot: ClassSession): string {
  return `${slot.day} ${formatClock(slot.start)}`;
}

export function classDurationMinutes(slot: ClassSession): number {
  return slot.durationMinutes ?? 60;
}

export const CLASS_NAME = groupClass.name;

/** Default prices for the portal's forms, from the published prices (the coach can change them). */
export function defaultPrices(): { classPence: number; ptPence: number; onlinePence: number; packagePence: number; packageSessions: number } {
  const price = (id: Parameters<typeof getService>[0], i = 0) => getService(id).prices[i]?.amountGbp ?? 0;
  return {
    classPence: poundsToPence(price("group-classes")),
    ptPence: poundsToPence(price("one-to-one")),
    onlinePence: poundsToPence(price("online-coaching")),
    // "Four sessions: £130 per month" (the published one-to-one offer).
    packagePence: poundsToPence(price("one-to-one", 1)),
    packageSessions: 4,
  };
}

/** Description used on a class place's charge. */
export function classChargeDescription(date: DateKey, slot: ClassSession): string {
  return `${slot.name ?? CLASS_NAME}, ${formatDate(date)}, ${formatClock(slot.start)}`;
}

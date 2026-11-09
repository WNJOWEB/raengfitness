import type { ClassSession, TimeOfDay, Weekday } from "@/content/types";
import { addDays, fromDateKey, toDateKey, weekdayIndex, type DateKey } from "./dates";
import type { AvailabilityWindow, DayAvailability } from "./types";

/**
 * Real group class dates: every session in the confirmed weekly timetable
 * over the next four weeks. No capacity is known, so every date can be
 * requested and Alex confirms each place himself.
 */

export const CLASS_WINDOW_DAYS = 28;

const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Only the fields the browser needs (`id`, the timetable slot, to mark full classes). */
export type ClassSlot = Pick<ClassSession, "day" | "start"> & { id?: string };

export function classSlotId(date: DateKey, time: TimeOfDay): string {
  return `class-${date}-${time}`;
}

/**
 * The timetable class behind a calendar time: `slotId` is "class-<date>-<time>"
 * (classSlotId) and `date` its day, so the class is the one on that weekday at
 * that time. Its `id` ("mon-evening") is what class sizes, places left and the
 * waitlist are keyed by. Null when there's no such class.
 */
export function classForSlot<T extends ClassSlot>(classes: readonly T[], slotId: string, date: DateKey): T | null {
  const day = WEEKDAYS[weekdayIndex(date)];
  return classes.find((c) => classSlotId(date, c.start) === slotId && c.day === day) ?? null;
}

/**
 * `full`: "slot|date" keys of classes that have reached the capacity Alex set
 * (lib/class-capacity.ts); they show as fully booked and can't be chosen.
 * `cancelled`: classes Alex cancelled; they aren't offered at all.
 */
export function classAvailability(sessions: readonly ClassSlot[], today: DateKey, full: ReadonlySet<string> = new Set(), cancelled: ReadonlySet<string> = new Set()): AvailabilityWindow {
  const from = addDays(today, 1);
  const to = addDays(today, CLASS_WINDOW_DAYS);
  const days: DayAvailability[] = [];
  for (let i = 1; i <= CLASS_WINDOW_DAYS; i++) {
    const date = addDays(today, i);
    const day = WEEKDAYS[weekdayIndex(date)];
    const todays = sessions.filter((s) => s.day === day && !(s.id && cancelled.has(`${s.id}|${date}`))).sort((a, b) => a.start.localeCompare(b.start));
    if (todays.length === 0) continue;
    days.push({ date, slots: todays.map((s) => ({ id: classSlotId(date, s.start), time: s.start, available: !(s.id && full.has(`${s.id}|${date}`)) })) });
  }
  return { source: "live", from, to, days };
}

/** Server check: is `date` a real class day for `session` within the booking window (with a day's slack for time zones)? */
export function isClassDate(date: string, session: ClassSlot, today: DateKey): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(fromDateKey(date)) !== date) return false;
  if (date < addDays(today, 0) || date > addDays(today, CLASS_WINDOW_DAYS + 1)) return false;
  return WEEKDAYS[weekdayIndex(date)] === session.day;
}

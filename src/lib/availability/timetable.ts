import type { ClassSession, TimeOfDay, Weekday } from "@/content/types";
import { addDays, fromDateKey, toDateKey, weekdayIndex, type DateKey } from "./dates";
import { classSpacesKey, isFull, type ClassSpaces } from "../class-spaces";
import type { AvailabilityWindow, DayAvailability } from "./types";

/**
 * Real group class dates: every session in the confirmed weekly timetable
 * over the next four weeks. Where places are known (class-spaces.ts) a full
 * class can't be chosen; otherwise every date can be requested and Alex
 * confirms each place himself.
 */

export const CLASS_WINDOW_DAYS = 28;

const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Only the fields the browser needs. */
export type ClassSlot = Pick<ClassSession, "day" | "start" | "name"> & { id?: string };

export function classSlotId(date: DateKey, time: TimeOfDay): string {
  return `class-${date}-${time}`;
}

export function classAvailability(sessions: readonly ClassSlot[], today: DateKey, spaces: ClassSpaces | null = null): AvailabilityWindow {
  const from = addDays(today, 1);
  const to = addDays(today, CLASS_WINDOW_DAYS);
  const days: DayAvailability[] = [];
  for (let i = 1; i <= CLASS_WINDOW_DAYS; i++) {
    const date = addDays(today, i);
    const day = WEEKDAYS[weekdayIndex(date)];
    const todays = sessions.filter((s) => s.day === day).sort((a, b) => a.start.localeCompare(b.start));
    if (todays.length === 0) continue;
    days.push({
      date,
      slots: todays.map((s) => {
        const places = s.id ? spaces?.[classSpacesKey(date, s.id)] : undefined;
        return {
          id: classSlotId(date, s.start),
          time: s.start,
          available: places ? !isFull(places) : true,
          ...(s.name ? { name: s.name } : {}),
          ...(places ? { places } : {}),
        };
      }),
    });
  }
  return { source: "live", from, to, days };
}

/** Server check: is `date` a real class day for `session` within the booking window (with a day's slack for time zones)? */
export function isClassDate(date: string, session: ClassSlot, today: DateKey): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(fromDateKey(date)) !== date) return false;
  if (date < addDays(today, 0) || date > addDays(today, CLASS_WINDOW_DAYS + 1)) return false;
  return WEEKDAYS[weekdayIndex(date)] === session.day;
}

import { groupClass } from "@/content/classes";
import { listClassSessions } from "@/lib/coach/bookings";
import { classOccurrences } from "@/lib/coach/classes";
import { coachDb } from "@/lib/coach/db";
import { addDays, londonToday } from "@/lib/coach/time";
import type { Env } from "./env";
import { classSpacesKey, type ClassPlaces, type ClassSpaces } from "./class-spaces";

/**
 * Places taken and capacity for every timetable class in a date range, read
 * with the server's Supabase key. Only counts leave this module: never names,
 * notes or any other detail of who is booked. A class with no row yet has no
 * places taken; capacity is the class's own when Alex has set one, else the
 * default in content/classes.ts.
 *
 * Null when places can't be read (Supabase isn't set up or didn't answer):
 * callers then show no space counts and never invent them.
 */
export async function loadClassSpaces(from: string, to: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<ClassSpaces | null> {
  const db = coachDb(env, fetchImpl);
  if (!db) return null;
  const rows = await listClassSessions(db, from, to);
  if (!rows.ok) return null;
  const spaces: ClassSpaces = {};
  for (const o of classOccurrences(from, to)) {
    const row = rows.data.find((r) => r.slot === o.slot.id && r.class_date === o.date);
    spaces[classSpacesKey(o.date, o.slot.id)] = { capacity: row?.capacity ?? groupClass.capacity, booked: row?.booked ?? 0 };
  }
  return spaces;
}

/** The window the booking page offers (tomorrow to four weeks ahead), with a day's slack either side for time zones. */
export function bookingSpacesWindow(): { from: string; to: string } {
  const start = londonToday();
  return { from: addDays(start, -1), to: addDays(start, 30) };
}

/** Places on one class, or null when unknown. */
export async function loadClassPlaces(date: string, slotId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<ClassPlaces | null> {
  const spaces = await loadClassSpaces(date, date, env, fetchImpl);
  return spaces?.[classSpacesKey(date, slotId)] ?? null;
}

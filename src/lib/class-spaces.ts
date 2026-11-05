import type { DateKey } from "./availability/dates";

/**
 * Places left on a group class. Pure and browser-safe: the numbers are
 * loaded on the server (class-spaces-server.ts) and passed to the booking
 * page, so no keys or personal data ever reach the browser.
 */

export interface ClassPlaces {
  /** Places on the class. */
  capacity: number;
  /** Confirmed places taken (a request is not a place until Alex confirms it). */
  booked: number;
}

/** Keyed by classSpacesKey(date, slotId). */
export type ClassSpaces = Record<string, ClassPlaces>;

export function classSpacesKey(date: DateKey, slotId: string): string {
  return `${date}|${slotId}`;
}

export function spacesRemaining(places: ClassPlaces): number {
  return Math.max(0, places.capacity - places.booked);
}

export function isFull(places: ClassPlaces): boolean {
  return spacesRemaining(places) === 0;
}

/** "10/15 spaces available" or, when none are left, "15/15 Full" (Alex's wording). */
export function formatSpaces(places: ClassPlaces): string {
  return isFull(places)
    ? `${places.capacity}/${places.capacity} Full`
    : `${spacesRemaining(places)}/${places.capacity} spaces available`;
}

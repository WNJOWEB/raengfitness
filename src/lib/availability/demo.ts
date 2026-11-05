import type { TimeOfDay } from "@/content/types";
import type { BookableService } from "@/lib/booking-options";
import { addDays, weekdayIndex, type DateKey } from "./dates";
import type { AvailabilityProvider, AvailabilityWindow, DayAvailability } from "./types";

/**
 * DEMONSTRATION DATA ONLY. Invented sample dates and times so Alex can try
 * the booking interface before real availability is connected. It is NOT
 * Alex's timetable (deliberately different days from the timetable in
 * content/classes.ts), implies nothing about capacity, and is only served
 * when booking demo mode is on (never on Vercel production; see
 * isBookingDemoEnabled in lib/booking.ts). Selections from it are never sent
 * or booked.
 */

export const DEMO_WINDOW_DAYS = 28;

/** Weekday (0 = Monday) → sample start times. Days not listed have no sessions. */
const PATTERNS: Record<BookableService, Partial<Record<number, TimeOfDay[]>>> = {
  "group-class": { 1: ["19:00"], 3: ["19:00"], 6: ["10:00"] },
  "one-to-one": { 0: ["07:00", "12:30", "17:30"], 2: ["07:00", "12:30", "17:30"], 4: ["07:00", "12:30"] },
  "small-group": { 1: ["18:00"], 5: ["09:30"] },
};

/**
 * Deterministic "taken" pattern so the demo always shows some fully booked
 * dates and some taken times, without randomness that would confuse testing.
 */
function isTaken(service: BookableService, occurrence: number, slotIndex: number): boolean {
  if (occurrence % 4 === 1) return true; // every fourth session day is fully booked
  return service === "one-to-one" && (occurrence + slotIndex) % 3 === 0;
}

export function demoAvailability(service: BookableService, today: DateKey): AvailabilityWindow {
  const from = addDays(today, 1);
  const to = addDays(today, DEMO_WINDOW_DAYS);
  const days: DayAvailability[] = [];
  let occurrence = 0;
  for (let i = 1; i <= DEMO_WINDOW_DAYS; i++) {
    const date = addDays(today, i);
    const times = PATTERNS[service][weekdayIndex(date)];
    if (!times) continue;
    days.push({
      date,
      slots: times.map((time, slotIndex) => ({
        id: `demo-${service}-${date}-${time}`,
        time,
        available: !isTaken(service, occurrence, slotIndex),
      })),
    });
    occurrence++;
  }
  return { source: "demo", from, to, days };
}

export const demoAvailabilityProvider: AvailabilityProvider = {
  source: "demo",
  getAvailability: async (service, today) => demoAvailability(service, today),
};

import type { Timetable } from "./types";

/**
 * Group class timetable. Class names, descriptions and times updated
 * 2026-11-05 from Alex's latest timetable (RAENG website changes): Monday
 * 18:30 KB HIIT, Wednesday 18:30 Double KB, Saturday 09:00 KB Mix. Slot ids
 * are kept from the earlier timetable so existing class dates and bookings in
 * the coach portal still line up. The 60-minute length was confirmed for the
 * earlier timetable (2026-10-17); Alex to confirm it still applies. See CORE.md.
 */
export const timetable: Timetable = {
  status: "confirmed",
  sessions: [
    {
      id: "mon-evening",
      day: "Monday",
      start: "18:30",
      durationMinutes: 60,
      name: "KB HIIT",
      description: "Kettlebell conditioning and full-body training to build strength and fitness.",
    },
    {
      id: "wed-evening",
      day: "Wednesday",
      start: "18:30",
      durationMinutes: 60,
      name: "Double KB",
      description: "Build strength, coordination and control using two kettlebells.",
    },
    {
      id: "sat-morning",
      day: "Saturday",
      start: "09:00",
      durationMinutes: 60,
      name: "KB Mix",
      description: "A varied session combining strength, conditioning and kettlebell skills.",
    },
  ],
};

/**
 * How Alex describes group classes in general (his class listing, supplied by
 * the project owner 2026-10-17). Used where a class has no description of its own.
 */
export const groupClass = {
  name: "Kettlebell Training",
  description:
    "A 60-minute kettlebell training session designed to build strength, conditioning and movement quality. Suitable for all experience levels, with exercises scaled to your ability.",
  payment: "Pay by bank transfer or cash.",
  /**
   * Places per class (15, from Alex's website changes; Alex to confirm).
   * Shown to visitors as "N Spaces Remaining" or "Full", never as booked/capacity. The coach can set a
   * different capacity for a single date in the portal.
   */
  capacity: 15,
} as const;

import type { Timetable } from "./types";

/**
 * Group class timetable as supplied by the client.
 *
 * Confirmed for publication by the project owner on 2026-10-15; the
 * 60-minute length on 2026-10-17 (Alex's own class listing); Saturday moved to
 * 9:00 am by the owner on 2026-10-22, then to 8:30 am on 2026-11-09 (Alex). See CORE.md.
 * Class names, taglines and descriptions: as shown in Alex's mockup, checked against it 2026-11-09 (Single KB, Double KB, KB Mix).
 */
export const timetable: Timetable = {
  status: "confirmed",
  sessions: [
    { id: "mon-evening", day: "Monday", start: "18:30", durationMinutes: 60, name: "Single KB", tagline: "Full-body strength & conditioning.", description: "Build strength, develop technique and improve fitness using a single kettlebell. Focus on fundamental movements, strength development and conditioning." },
    { id: "wed-evening", day: "Wednesday", start: "18:30", durationMinutes: 60, name: "Double KB", tagline: "Strength, power & technique.", description: "Take your training further with two kettlebells. Develop strength, coordination and control through movements such as squats, cleans, presses and carries." },
    { id: "sat-morning", day: "Saturday", start: "08:30", durationMinutes: 60, name: "KB Mix", tagline: "Strength, movement & conditioning.", description: "A varied full-body session combining single and double kettlebell exercises. Build strength, improve movement and develop overall fitness through a mix of training styles." },
  ],
};

/**
 * The usual group class size (owner, 2026-10-29: 12 for now, then 15 as in Alex's mockup). Alex changes it
 * in the coach portal (stored in the database); this is what applies until he
 * does, and if the database can't be read.
 */
export const defaultClassCapacity = 15;

/**
 * How Alex describes every group class (his class listing, supplied by the
 * project owner 2026-10-17). Shown when someone picks a class date.
 */
export const groupClass = {
  name: "Kettlebell Training",
  description:
    "A 60-minute kettlebell training session designed to build strength, conditioning and movement quality. Suitable for all experience levels, with exercises scaled to your ability.",
  payment: "Pay by bank transfer or cash.",
  /** Shown with the length on the chosen class in the booking form (owner, 2026-10-28; the description says the same). */
  level: "All levels",
  /** The same, as the short labels on /classes. */
  paymentMethods: ["Bank transfer", "Cash"],
} as const;

/**
 * Booking a group class and paying online (owner's decisions, 2026-10-27):
 * the place is held for 15 minutes while paying. Cancelling 24 hours or more
 * before refunds the payment in full (Alex, 2026-11-05; it was a credit for
 * another class before then); later, or not turning up, the class is used.
 * The database enforces the same rule (migrations 20261029000000 and
 * 20261124000000). Shown only where online payment is on.
 */
export const onlineClassBooking = {
  payment: "Pay online when you book.",
  paymentMethods: ["Pay online when you book"],
  hold: "Your place is held for 15 minutes while you pay.",
  cancel:
    "Cancel at least 24 hours before and you'll get your money back in full. Later than that, or if you don't turn up, there's no refund.",
  /** For a class booked with a class credit. */
  cancelCredit:
    "Cancel at least 24 hours before and you'll get your class credit back. Later than that, or if you don't turn up, the credit is used.",
} as const;

/**
 * Asked for by Alex (2026-11-09): arrive 10 minutes early so classes start on
 * time and beginners have time to go over the basic movements. Used in the
 * group class confirmations (pay-online and member credit bookings).
 */
export const arriveEarlyMinutes = 10;

export const arriveEarlyNote = `Please arrive ${arriveEarlyMinutes} minutes early so we can start on time. If you're new, this gives Alex time to go over the basic movements with you.`;

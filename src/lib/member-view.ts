import { addDays, formatLongDate, weekdayIndex, type DateKey } from "@/lib/availability/dates";
import type { PublishedClass } from "@/lib/class-sessions";
import { fullKey, type FullClasses } from "@/lib/class-capacity";
import { daysBetween, formatClock, formatDayMonth, londonToUtc, startOfWeek, toLondon } from "@/lib/coach/time";
import type { MemberOverview, MemberPlace } from "@/lib/member-auth";
import type { WaitlistEntry } from "@/lib/waitlist";

/**
 * The members area's view model (owner's members design, 2026-10-28): what
 * Home, Book and Plan show, worked out from the member's own data. Pure, so
 * the rules are unit-tested; the pages only lay it out.
 */

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Morning", "Afternoon" or "Evening", in UK time. */
export function greeting(now: Date): string {
  const hour = Number(toLondon(now).time.slice(0, 2));
  return hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
}

/** The first word of the name on the account, for the greeting and avatar. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** "Saturday 31 October, 9:00 am" from a timestamp. */
export function longWhen(iso: string): string {
  const { date, time } = toLondon(iso);
  return `${formatLongDate(date)}, ${formatClock(time)}`;
}

/** "Sat 31 Oct, 9:00 am" from a timestamp. */
export function shortWhen(iso: string): string {
  const { date, time } = toLondon(iso);
  return `${WEEKDAYS[weekdayIndex(date)].slice(0, 3)} ${formatDayMonth(date)}, ${formatClock(time)}`;
}

/** "in 6 days", "tomorrow", "in 3 h", "in 40 min" or "starting now", by UK calendar days. */
export function countdown(iso: string, now: Date): string {
  const days = daysBetween(toLondon(now).date, toLondon(iso).date);
  if (days > 1) return `In ${days} days`;
  if (days === 1) return "Tomorrow";
  const minutes = Math.round((Date.parse(iso) - now.getTime()) / 60_000);
  if (minutes >= 60) return `In ${Math.floor(minutes / 60)} h`;
  return minutes > 0 ? `In ${minutes} min` : "Starting now";
}

/** Booked places still to come, soonest first. */
export function upcomingPlaces(o: MemberOverview, now: Date): MemberPlace[] {
  return o.places
    .filter((p) => p.status === "booked" && Date.parse(p.starts_at) > now.getTime())
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

/** Classes in the last 4 weeks that have happened (or were missed), latest first. */
export function pastPlaces(o: MemberOverview, now: Date): MemberPlace[] {
  return o.places
    .filter((p) => (p.status === "attended" || p.status === "no_show" || p.status === "booked") && Date.parse(p.starts_at) <= now.getTime())
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
}

/**
 * What a class card can do:
 * - book: with a membership credit; use-credit: with a class credit; pay: go
 *   to the booking page and pay (no membership, no class credit).
 * - booked: theirs, still to come (tap to cancel); attended / missed / past.
 * - full, cancelled (by the coach), next-period (after this period ends, or
 *   before the next one starts), no-credits, pay-first (period unpaid).
 */
export type SlotState =
  | "book"
  | "use-credit"
  | "pay"
  | "booked"
  | "attended"
  | "missed"
  | "past"
  | "full"
  | "waitlist"
  | "waitlisted"
  | "cancelled"
  | "next-period"
  | "no-credits"
  | "pay-first";

export const SLOT_LABEL: Record<SlotState, string> = {
  book: "Book",
  "use-credit": "Use credit",
  pay: "Book",
  booked: "Booked",
  attended: "Attended",
  missed: "Missed",
  past: "Past",
  full: "Full",
  waitlist: "Waitlist",
  waitlisted: "On waitlist",
  cancelled: "Cancelled",
  "next-period": "Next period",
  "no-credits": "No credits",
  "pay-first": "Pay first",
};

export interface WeekSlot {
  slot: string;
  date: DateKey;
  startsAt: string;
  /** "MON" */
  day: string;
  /** "2" */
  dayNumber: string;
  /** "6:30 pm" */
  time: string;
  /** "Monday 2 November, 6:30 pm" */
  label: string;
  state: SlotState;
  /** Their place on it, when booked. */
  place: MemberPlace | null;
}

export interface Week {
  /** "This week", "Next week", then "9–14 Nov". */
  label: string;
  slots: WeekSlot[];
}

function weekRange(dates: DateKey[]): string {
  const first = formatDayMonth(dates[0]);
  const last = formatDayMonth(dates[dates.length - 1]);
  const [d1, m1] = first.split(" ");
  const [d2, m2] = last.split(" ");
  return m1 === m2 ? `${d1}–${d2} ${m2}` : `${first}–${last}`;
}

/**
 * Every published class from this week to the end of the booking window,
 * week by week, each with what the member can do with it.
 */
export function bookingWeeks(
  o: MemberOverview,
  args: { today: DateKey; now: Date; classes: PublishedClass[]; windowDays: number; full: FullClasses; paymentDue: boolean; waitlist?: readonly WaitlistEntry[] },
): Week[] {
  const { today, now, classes, windowDays, full, paymentDue } = args;
  const onWaitlist = new Map((args.waitlist ?? []).map((w) => [fullKey(w.slot, w.class_date), w]));
  const last = addDays(today, windowDays);
  const places = new Map(o.places.filter((p) => p.status !== "cancelled").map((p) => [`${p.slot}|${p.class_date}`, p]));
  const credit = o.class_credits[0] ?? null;
  const fullKeys: readonly string[] = full.keys;
  const cancelledKeys: readonly string[] = full.cancelled;
  const weeks: Week[] = [];
  for (let monday = startOfWeek(today), i = 0; monday <= last; monday = addDays(monday, 7), i++) {
    const slots: WeekSlot[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(monday, d);
      if (date > last) break;
      for (const c of classes) {
        if (WEEKDAYS[weekdayIndex(date)] !== c.day) continue;
        const startsAt = londonToUtc(date, c.start);
        const place = places.get(`${c.id}|${date}`) ?? null;
        const key = fullKey(c.id, date);
        let state: SlotState;
        if (Date.parse(startsAt) <= now.getTime()) state = place ? (place.status === "no_show" ? "missed" : "attended") : "past";
        else if (place?.status === "booked") state = "booked";
        else if (cancelledKeys.includes(key)) state = "cancelled";
        // A full class can be joined on the waitlist (owner, 2026-11-04); someone already on it sees that instead.
        else if (fullKeys.includes(key)) state = onWaitlist.has(key) ? "waitlisted" : "waitlist";
        else if (o.membership && o.membership.status !== "cancelled") {
          if (!o.period || date < o.period.start || date > o.period.end) state = "next-period";
          else if (paymentDue) state = "pay-first";
          else if (o.period.left <= 0) state = "no-credits";
          else state = "book";
        } else if (o.membership && o.period && o.period.left > 0 && date >= o.period.start && date <= o.period.end) {
          // Cancelled: the credits already paid for are used first, until the period ends (owner, 2026-11-03).
          state = "book";
        } else {
          // No membership, or a cancelled one with nothing left: pay as you go (a class credit first).
          state = credit && date <= credit.expires_on ? "use-credit" : "pay";
        }
        slots.push({
          slot: c.id,
          date,
          startsAt,
          day: c.day.slice(0, 3).toUpperCase(),
          dayNumber: String(Number(date.slice(8))),
          time: formatClock(c.start),
          label: `${formatLongDate(date)}, ${formatClock(c.start)}`,
          state,
          place,
        });
      }
    }
    if (slots.length === 0) continue;
    weeks.push({ label: i === 0 ? "This week" : i === 1 ? "Next week" : weekRange(slots.map((s) => s.date)), slots });
  }
  return weeks;
}

/** How far through the credit period today is, 0 to 100. */
export function periodProgress(period: { start: string; end: string }, today: DateKey): number {
  const total = daysBetween(period.start, period.end) + 1;
  const done = daysBetween(period.start, today) + 1;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/**
 * Whether the account works as a membership (credits) or pay as you go
 * (owner, 2026-11-03): a cancelled membership counts only while its paid
 * period still has credits to use.
 */
export function usesCredits(o: Pick<MemberOverview, "membership" | "period">): boolean {
  if (!o.membership) return false;
  if (o.membership.status !== "cancelled") return true;
  return Boolean(o.period && o.period.left > 0);
}

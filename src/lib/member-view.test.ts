import { describe, expect, it } from "vitest";
import type { PublishedClass } from "./class-sessions";
import type { MemberOverview, MemberPlace } from "./member-auth";
import { bookingWeeks, countdown, firstName, greeting, periodProgress, upcomingPlaces, usesCredits } from "./member-view";

const classes: PublishedClass[] = [
  { id: "mon-evening", label: "Monday 6:30 pm", day: "Monday", start: "18:30", durationMinutes: 60 },
  { id: "wed-evening", label: "Wednesday 6:30 pm", day: "Wednesday", start: "18:30", durationMinutes: 60 },
  { id: "sat-morning", label: "Saturday 9:00 am", day: "Saturday", start: "09:00", durationMinutes: 60 },
];

// Wednesday 28 October 2026, 6:50 pm in London (GMT).
const now = new Date("2026-10-28T18:50:00Z");
const today = "2026-10-28";

function place(over: Partial<MemberPlace>): MemberPlace {
  return {
    id: "p1",
    class_date: "2026-11-04",
    starts_at: "2026-11-04T18:30:00Z",
    slot: "wed-evening",
    status: "booked",
    late_cancel: false,
    with_credit: true,
    how: "credit",
    class_cancelled: false,
    can_cancel: true,
    credit_back_if_cancelled: true,
    ...over,
  };
}

function member(over: Partial<MemberOverview> = {}): MemberOverview {
  return {
    client: { name: "Jamie Sample", email: "jamie@example.com", phone: "" },
    membership: {
      plan: "regular",
      plan_name: "Regular",
      status: "active",
      price_pence: 6500,
      credits: 8,
      start_on: "2026-10-28",
      cancelled_on: null,
      renews_on: "2026-11-25",
    },
    period: { start: "2026-10-28", end: "2026-11-24", credits: 8, used: 1, left: 7 },
    places: [place({})],
    class_credits: [],
    paid_classes_28d: 0,
    ...over,
  };
}

const none = { known: true as const, keys: [], cancelled: [] };
const args = { today, now, classes, windowDays: 28, full: none, paymentDue: false };

describe("greeting and names", () => {
  it("says the part of the day in UK time", () => {
    expect(greeting(new Date("2026-10-28T08:00:00Z"))).toBe("Morning");
    expect(greeting(new Date("2026-10-28T13:00:00Z"))).toBe("Afternoon");
    expect(greeting(now)).toBe("Evening");
    // 11:30 pm UTC on 31 March is 00:30 BST: morning.
    expect(greeting(new Date("2026-03-31T23:30:00Z"))).toBe("Morning");
  });
  it("uses the first word of the name", () => {
    expect(firstName("  Jamie Sample ")).toBe("Jamie");
    expect(firstName("")).toBe("");
  });
});

describe("countdown", () => {
  it("counts UK calendar days, then hours and minutes on the day", () => {
    expect(countdown("2026-11-04T18:30:00Z", now)).toBe("In 7 days");
    expect(countdown("2026-10-29T09:00:00Z", now)).toBe("Tomorrow");
    expect(countdown("2026-10-28T21:30:00Z", new Date("2026-10-28T18:00:00Z"))).toBe("In 3 h");
    expect(countdown("2026-10-28T18:30:00Z", new Date("2026-10-28T18:05:00Z"))).toBe("In 25 min");
  });
});

describe("bookingWeeks for a member", () => {
  const weeks = bookingWeeks(member(), args);

  it("labels this week, next week, then date ranges", () => {
    expect(weeks.map((w) => w.label)).toEqual(["This week", "Next week", "9–14 Nov", "16–21 Nov", "23–25 Nov"]);
  });

  it("marks past, booked, bookable and next-period classes", () => {
    const states = Object.fromEntries(weeks.flatMap((w) => w.slots).map((s) => [`${s.slot}|${s.date}`, s.state]));
    expect(states["mon-evening|2026-10-26"]).toBe("past");
    expect(states["wed-evening|2026-10-28"]).toBe("past"); // 6:30 pm has gone at 6:50 pm
    expect(states["sat-morning|2026-10-31"]).toBe("book");
    expect(states["wed-evening|2026-11-04"]).toBe("booked");
    expect(states["mon-evening|2026-11-23"]).toBe("book"); // last day of the period
    expect(states["wed-evening|2026-11-25"]).toBe("next-period");
  });

  it("shows full and cancelled classes, no credits and an unpaid period", () => {
    const full = { known: true as const, keys: ["sat-morning|2026-10-31"], cancelled: ["mon-evening|2026-11-02"] };
    const s = bookingWeeks(member(), { ...args, full }).flatMap((w) => w.slots);
    expect(s.find((x) => x.date === "2026-10-31")?.state).toBe("full");
    expect(s.find((x) => x.date === "2026-11-02")?.state).toBe("cancelled");
    const noneLeft = bookingWeeks(member({ period: { start: "2026-10-28", end: "2026-11-24", credits: 8, used: 8, left: 0 } }), args).flatMap((w) => w.slots);
    expect(noneLeft.find((x) => x.date === "2026-10-31")?.state).toBe("no-credits");
    const unpaid = bookingWeeks(member(), { ...args, paymentDue: true }).flatMap((w) => w.slots);
    expect(unpaid.find((x) => x.date === "2026-10-31")?.state).toBe("pay-first");
  });

  it("gives each card its day, number and time", () => {
    const sat = weeks[0].slots.find((s) => s.slot === "sat-morning")!;
    expect(sat).toMatchObject({ day: "SAT", dayNumber: "31", time: "9:00 am", label: "Saturday 31 October, 9:00 am", startsAt: "2026-10-31T09:00:00.000Z" });
  });
});

describe("bookingWeeks without a membership", () => {
  it("offers a class credit until it runs out, then paying", () => {
    const o = member({ membership: null, period: null, places: [], class_credits: [{ id: "c1", expires_on: "2026-11-07" }] });
    const s = bookingWeeks(o, args).flatMap((w) => w.slots);
    expect(s.find((x) => x.date === "2026-11-07")?.state).toBe("use-credit");
    expect(s.find((x) => x.date === "2026-11-09")?.state).toBe("pay");
  });
});

describe("upcomingPlaces and periodProgress", () => {
  it("lists booked places still to come, soonest first", () => {
    const o = member({
      places: [place({ id: "b", starts_at: "2026-11-07T09:00:00Z" }), place({ id: "a", starts_at: "2026-11-04T18:30:00Z" }), place({ id: "old", starts_at: "2026-10-26T18:30:00Z", status: "attended" })],
    });
    expect(upcomingPlaces(o, now).map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("is 0 to 100 through the period", () => {
    expect(periodProgress({ start: "2026-10-28", end: "2026-11-24" }, "2026-10-28")).toBe(4);
    expect(periodProgress({ start: "2026-10-28", end: "2026-11-24" }, "2026-11-24")).toBe(100);
    expect(periodProgress({ start: "2026-10-28", end: "2026-11-24" }, "2026-12-01")).toBe(100);
  });
});

describe("after cancelling the membership (owner, 2026-11-03: the account becomes pay as you go)", () => {
  const cancelled = (period: MemberOverview["period"], extra: Partial<MemberOverview> = {}) =>
    member({ membership: { ...member().membership!, status: "cancelled", cancelled_on: "2026-10-28", renews_on: null }, period, places: [], ...extra });
  const states = (o: MemberOverview) => new Set(bookingWeeks(o, args).flatMap((w) => w.slots).filter((s) => s.state !== "past").map((s) => s.state));

  it("credits still to use: booked with credits in the paid period, pay as you go after it ends", () => {
    const o = cancelled({ start: "2026-10-28", end: "2026-11-24", credits: 8, used: 1, left: 7 });
    expect(usesCredits(o)).toBe(true);
    const slots = bookingWeeks(o, args).flatMap((w) => w.slots).filter((s) => s.state !== "past");
    expect(slots.filter((s) => s.date <= "2026-11-24").every((s) => s.state === "book")).toBe(true);
    expect(slots.filter((s) => s.date > "2026-11-24").every((s) => s.state === "pay")).toBe(true);
    expect(states(o).has("next-period")).toBe(false);
  });

  it("no credits left (used, or ended by a refund): every class is Book and pay, never 'No credits'", () => {
    const o = cancelled({ start: "2026-10-28", end: "2026-11-24", credits: 0, used: 0, left: 0 });
    expect(usesCredits(o)).toBe(false);
    expect([...states(o)]).toEqual(["pay"]);
  });

  it("the period over: pay as you go, or a class credit first", () => {
    expect([...states(cancelled(null))]).toEqual(["pay"]);
    const withCredit = cancelled(null, { class_credits: [{ id: "c1", expires_on: "2026-12-31" }] });
    expect([...states(withCredit)]).toEqual(["use-credit"]);
  });

  it("an active member with no credits is unchanged", () => {
    const o = member({ period: { start: "2026-10-28", end: "2026-11-24", credits: 8, used: 8, left: 0 } });
    expect(usesCredits(o)).toBe(true);
    expect(states(o).has("pay")).toBe(false);
  });
});

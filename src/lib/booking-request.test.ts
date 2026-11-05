import { describe, expect, it } from "vitest";
import {
  MIN_FILL_MS,
  bookingDeliveryConfig,
  bookingEmail,
  describePreferences,
  isBookingFormEnabled,
  parseBookingRequest,
} from "./booking-request";
import { addDays, formatLongDate, fromDateKey, toDateKey, weekdayIndex } from "./availability/dates";
import type { PublishedClass } from "./class-sessions";

const NOW = 1_800_000_000_000;
const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
};
const valid = {
  service: "one-to-one",
  option: "single",
  days: ["mon", "wed"],
  times: ["evening"],
  experience: "warrior",
  name: "Sam Example",
  email: "Sam@Example.com",
  phone: "07700 900123",
  message: "See you soon",
  website: "",
  startedAt: String(NOW - 20_000),
  submissionId: "abc-123",
};
const CLASSES = [
  { id: "mon-evening", label: "Monday 6:30 pm", day: "Monday", start: "18:30", durationMinutes: 60 },
  { id: "sat-morning", label: "Saturday 10:15 am", day: "Saturday", start: "10:15", durationMinutes: 60 },
] as const satisfies PublishedClass[];
// Real class dates relative to NOW.
const today = toDateKey(new Date(NOW));
const nextDate = (weekday: number) => {
  for (let i = 1; i <= 7; i++) if (weekdayIndex(addDays(today, i)) === weekday) return addDays(today, i);
  throw new Error("unreachable");
};

describe("parseBookingRequest", () => {
  it("accepts a preference request and normalises it", () => {
    const result = parseBookingRequest(form(valid), { now: NOW });
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.data).toMatchObject({ service: "one-to-one", days: ["mon", "wed"], times: ["evening"], email: "sam@example.com", session: "" });
    }
  });

  it("allows phone, message and time of day to be blank", () => {
    expect(parseBookingRequest(form({ ...valid, phone: "", message: "", times: [] }), { now: NOW }).kind).toBe("valid");
  });

  it("requires at least one day when no class times are published", () => {
    const result = parseBookingRequest(form({ ...valid, service: "group-class", days: [] }), { now: NOW });
    expect(result.kind === "invalid" && result.errors.when).toBeTruthy();
  });

  it("requires a real upcoming class date for group classes once the timetable is confirmed", () => {
    const groupForm = { ...valid, service: "group-class", days: [], times: [] };
    const opts = { now: NOW, classes: CLASSES };
    const monday = nextDate(0);
    expect(parseBookingRequest(form({ ...groupForm, session: "Monday 6:30 pm", classDate: monday }), opts).kind).toBe("valid");
    for (const bad of [
      { session: "Tuesday 5:00 am", classDate: monday }, // not a class
      { session: "Monday 6:30 pm", classDate: nextDate(1) }, // wrong weekday
      { session: "Monday 6:30 pm", classDate: addDays(monday, -14) }, // in the past
      { session: "Monday 6:30 pm", classDate: addDays(monday, 70) }, // beyond the window
      { session: "Monday 6:30 pm", classDate: "2026-02-31" }, // not a date
      { session: "Monday 6:30 pm", classDate: "" },
    ]) {
      const result = parseBookingRequest(form({ ...groupForm, ...bad }), opts);
      expect(result.kind === "invalid" && result.errors.when, JSON.stringify(bad)).toBeTruthy();
    }
  });

  it("ignores unknown day and time values", () => {
    const result = parseBookingRequest(form({ ...valid, days: ["mon", "funday"], times: ["midnight"] }), { now: NOW });
    expect(result.kind === "valid" && result.data.days).toEqual(["mon"]);
    expect(result.kind === "valid" && result.data.times).toEqual([]);
  });

  it("reports each invalid field", () => {
    const result = parseBookingRequest(
      form({ ...valid, service: "massage", days: [], experience: "expert", name: "", email: "nope", phone: "abc" }),
      { now: NOW },
    );
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(Object.keys(result.errors).sort()).toEqual(["email", "experience", "name", "phone", "service", "when"]);
    }
  });

  it("enforces length limits", () => {
    const result = parseBookingRequest(form({ ...valid, name: "x".repeat(101), message: "y".repeat(1001) }), { now: NOW });
    expect(result.kind === "invalid" && result.errors.name && result.errors.message).toBeTruthy();
  });

  it("treats a filled honeypot or an instant submission as spam", () => {
    expect(parseBookingRequest(form({ ...valid, website: "http://spam" }), { now: NOW }).kind).toBe("spam");
    expect(parseBookingRequest(form({ ...valid, startedAt: String(NOW - MIN_FILL_MS + 1) }), { now: NOW }).kind).toBe("spam");
  });

  it("never accepts a demonstration slot", () => {
    expect(parseBookingRequest(form({ ...valid, slot: "demo-one-to-one-2026-10-20-07:00" }), { now: NOW }).kind).toBe("demo");
  });

  it("strips newlines from single-line fields (no header injection)", () => {
    const result = parseBookingRequest(form({ ...valid, name: "Sam\r\nBcc: evil@example.com" }), { now: NOW });
    expect(result.kind === "valid" && result.data.name).toBe("Sam Bcc: evil@example.com");
  });
});

describe("1:1 option and small group enquiries", () => {
  it("requires 1:1 requests to choose a single session or the monthly package", () => {
    const missing = parseBookingRequest(form({ ...valid, option: "" }), { now: NOW });
    expect(missing.kind === "invalid" && missing.errors.option).toBeTruthy();
    const bogus = parseBookingRequest(form({ ...valid, option: "free" }), { now: NOW });
    expect(bogus.kind === "invalid" && bogus.errors.option).toBeTruthy();
    const monthly = parseBookingRequest(form({ ...valid, option: "monthly" }), { now: NOW });
    expect(monthly.kind === "valid" && monthly.data.option).toBe("monthly");
  });

  it("does not ask for a 1:1 option on other services, and drops one that is sent", () => {
    const result = parseBookingRequest(form({ ...valid, service: "small-group", option: "monthly" }), { now: NOW });
    expect(result.kind === "valid" && result.data).toMatchObject({ service: "small-group", option: "" });
  });

  it("accepts a small group enquiry with preferred days and times, as its own service", () => {
    const result = parseBookingRequest(form({ ...valid, service: "small-group", option: "" }), { now: NOW, classes: CLASSES });
    if (result.kind !== "valid") throw new Error("expected valid");
    expect(result.data).toMatchObject({ service: "small-group", days: ["mon", "wed"], session: "", classDate: "" });
    const email = bookingEmail(result.data);
    expect(email.subject).toBe("Small group coaching enquiry from Sam Example");
    expect(email.text).toContain("Service: Small group coaching enquiry");
    expect(email.text).not.toContain("Option:");
  });

  it("still needs a day for a small group enquiry", () => {
    const result = parseBookingRequest(form({ ...valid, service: "small-group", days: [] }), { now: NOW });
    expect(result.kind === "invalid" && result.errors.when).toBeTruthy();
  });
});

describe("bookingEmail", () => {
  it("is plain text, marked as a request, with every field", () => {
    const result = parseBookingRequest(form(valid), { now: NOW });
    if (result.kind !== "valid") throw new Error("expected valid");
    const email = bookingEmail(result.data);
    expect(email.subject).toBe("1:1 personal coaching booking request: Sam Example");
    expect(email.text).toContain("Option: Single 1:1 session");
    expect(email.text).toContain("Preferred: Mon and Wed · Evening");
    expect(email.text).toContain("Experience: Intermediate");
    expect(email.text).toContain("not a confirmed booking");
  });

  it("names the class date and time when one was chosen", () => {
    const saturday = nextDate(5);
    const result = parseBookingRequest(
      form({ ...valid, service: "group-class", session: "Saturday 10:15 am", classDate: saturday, days: [] }),
      { now: NOW, classes: CLASSES },
    );
    if (result.kind !== "valid") throw new Error("expected valid");
    const year = fromDateKey(saturday).getFullYear();
    expect(bookingEmail(result.data).text).toContain(`Class: ${formatLongDate(saturday)} ${year}, 10:15 am`);
  });
});

describe("describePreferences", () => {
  it("summarises days and times in plain words", () => {
    expect(describePreferences(["mon", "wed", "sat"], [])).toBe("Mon, Wed and Sat · Any time");
    expect(describePreferences(["tue"], ["morning", "evening"])).toBe("Tue · Morning and Evening");
  });
});

describe("bookingDeliveryConfig", () => {
  const env = {
    RESEND_API_KEY: "re_test",
    BOOKING_NOTIFY_EMAIL: "alex@example.com",
    BOOKING_FROM_EMAIL: "Alex K Bells <bookings@example.com>",
  };

  it("is enabled only when every setting is present and valid", () => {
    expect(bookingDeliveryConfig(env)?.endpoint).toBe("https://api.resend.com/emails");
    expect(isBookingFormEnabled({ ...env, RESEND_API_KEY: "" })).toBe(false);
    expect(isBookingFormEnabled({ ...env, BOOKING_NOTIFY_EMAIL: "not-an-email" })).toBe(false);
    expect(isBookingFormEnabled({ ...env, BOOKING_FROM_EMAIL: "Alex <nope>" })).toBe(false);
    expect(isBookingFormEnabled({})).toBe(false);
  });

  it("is also enabled by Supabase storage alone", () => {
    expect(isBookingFormEnabled({ SUPABASE_URL: "https://ref.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" })).toBe(true);
  });

  it("only allows endpoint overrides that are https or localhost", () => {
    expect(bookingDeliveryConfig({ ...env, RESEND_API_URL: "http://localhost:3299/emails" })?.endpoint).toBe(
      "http://localhost:3299/emails",
    );
    expect(isBookingFormEnabled({ ...env, RESEND_API_URL: "http://evil.example/emails" })).toBe(false);
  });
});

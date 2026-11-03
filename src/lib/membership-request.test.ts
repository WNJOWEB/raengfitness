import { describe, expect, it } from "vitest";
import { describeFirstClass, membershipEmail, membershipSummary, parseMembershipRequest } from "./membership-request";
import { addDays, toDateKey, weekdayIndex } from "./availability/dates";
import type { PublishedClass } from "./class-sessions";

const NOW = 1_800_000_000_000;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const CLASSES = [
  { id: "mon-evening", label: "Monday 6:30 pm", day: "Monday", start: "18:30", durationMinutes: 60 },
  { id: "sat-morning", label: "Saturday 9:00 am", day: "Saturday", start: "09:00", durationMinutes: 60 },
] as const satisfies PublishedClass[];
const today = toDateKey(new Date(NOW));
const nextSaturday = (() => {
  for (let i = 1; i <= 7; i++) if (weekdayIndex(addDays(today, i)) === 5) return addDays(today, i);
  throw new Error("unreachable");
})();
const valid = {
  plan: "regular",
  experience: "rookie",
  name: "Sam Example",
  email: "Sam@Example.com",
  phone: "07700 900123",
  message: "",
  agree: "yes",
  waiver: "yes",
  website: "",
  startedAt: String(NOW - 20_000),
  submissionId: "join-1",
};
const opts = { now: NOW, classes: CLASSES };

describe("parseMembershipRequest", () => {
  it("accepts a join request without a first class", () => {
    const result = parseMembershipRequest(form(valid), opts);
    expect(result).toMatchObject({ kind: "valid", data: { plan: "regular", session: "", classDate: "", email: "sam@example.com" } });
  });

  it("accepts a real upcoming first class", () => {
    const result = parseMembershipRequest(form({ ...valid, session: "Saturday 9:00 am", classDate: nextSaturday }), opts);
    expect(result).toMatchObject({ kind: "valid", data: { session: "Saturday 9:00 am", classDate: nextSaturday } });
  });

  it("refuses a first class that isn't on the timetable or is in the past", () => {
    expect(parseMembershipRequest(form({ ...valid, session: "Sunday 9:00 am", classDate: nextSaturday }), opts)).toMatchObject({ kind: "invalid", errors: { when: expect.any(String) } });
    expect(parseMembershipRequest(form({ ...valid, session: "Saturday 9:00 am", classDate: "2020-01-04" }), opts)).toMatchObject({ kind: "invalid", errors: { when: expect.any(String) } });
  });

  it("requires a real plan and agreement to the terms", () => {
    const result = parseMembershipRequest(form({ ...valid, plan: "platinum", agree: "" }), opts);
    expect(result).toMatchObject({ kind: "invalid", errors: { plan: expect.any(String), agree: expect.any(String) } });
  });

  it("requires a phone number and the health and risk tick, as a class booking does", () => {
    const result = parseMembershipRequest(form({ ...valid, phone: "", waiver: "" }), opts);
    expect(result).toMatchObject({ kind: "invalid", errors: { phone: expect.any(String), waiver: expect.any(String) } });
  });

  it("keeps which health and risk wording was ticked, and when", () => {
    const result = parseMembershipRequest(form(valid), opts);
    expect(result).toMatchObject({ kind: "valid", data: { phone: "07700 900123", waiver: { version: expect.any(String), at: new Date(NOW).toISOString() } } });
  });

  it("validates the details like a booking request", () => {
    const result = parseMembershipRequest(form({ ...valid, name: "", email: "not-an-email", experience: "" }), opts);
    expect(result).toMatchObject({ kind: "invalid", errors: { name: expect.any(String), email: expect.any(String), experience: expect.any(String) } });
  });

  it("treats a filled honeypot or an instant submission as spam", () => {
    expect(parseMembershipRequest(form({ ...valid, website: "x" }), opts).kind).toBe("spam");
    expect(parseMembershipRequest(form({ ...valid, startedAt: String(NOW - 500) }), opts).kind).toBe("spam");
  });
});

describe("membership request text", () => {
  const data = { plan: "regular", session: "", classDate: "", experience: "rookie", name: "Sam", email: "sam@example.com", phone: "07700 900123", message: "", submissionId: "x", waiver: { version: "2026-10-31", at: "2026-10-26T12:00:00.000Z" } } as const;

  it("says when the first class is left for later", () => {
    expect(describeFirstClass(data)).toBe("Book later");
    expect(membershipSummary(data)).toBe("Regular membership · first class to book later");
  });

  it("tells Alex the plan, the agreement and that nothing has been paid", () => {
    const email = membershipEmail(data, "2026-10-26T12:00:00.000Z");
    expect(email.subject).toBe("Regular membership request: Sam");
    expect(email.text).toContain("Regular membership (£65 every 4 weeks, 8 class credits)");
    expect(email.text).toContain("Agreed to the membership terms and class cancellation policy: 2026-10-26T12:00:00.000Z");
    expect(email.text).toContain("Agreed to the participation and risk terms (version 2026-10-31): 2026-10-26T12:00:00.000Z");
    expect(email.text).toContain("Nothing has been paid.");
  });
});

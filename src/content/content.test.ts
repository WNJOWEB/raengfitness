import { describe, expect, it } from "vitest";
import { services } from "./services";
import { timetable } from "./classes";
import { faq } from "./faq";
import { journey } from "./journey";
import { coach } from "./coach";
import { aboutQuote } from "./about";
import { testimonials } from "./community";

// Guards against accidental publication: anything not yet approved by the
// client must stay provisional. Update deliberately when Alex confirms.
describe("content approval state", () => {
  it("publishes only the prices confirmed by the project owner", () => {
    const confirmed = services
      .flatMap((s) => s.prices.map((p) => `${s.id}:${p.label}:${p.amountGbp}:${p.status}`))
      .sort();
    expect(confirmed).toEqual([
      "group-classes:Per class:12:confirmed",
      "one-to-one:Monthly package:130:confirmed",
      "one-to-one:Single 1:1 session:35:confirmed",
      "online-coaching:Monthly:79:confirmed",
    ]);
  });

  it("publishes the timetable confirmed on 2026-10-15", () => {
    expect(timetable.status).toBe("confirmed");
    expect(timetable.sessions.map((s) => `${s.day} ${s.start}`)).toEqual(["Monday 18:30", "Wednesday 18:30", "Saturday 09:00"]);
    expect(timetable.sessions.every((s) => s.durationMinutes === 60)).toBe(true);
  });

  it("derives the timetable FAQ status from the timetable", () => {
    // The times question was removed (Alex, 2026-11-05); nothing in the FAQ depends on the timetable now.
    expect(faq.every((f) => f.status === "confirmed")).toBe(true);
  });

  it("never publishes Alex's journey with placeholders or missing photos", () => {
    if (journey.status !== "confirmed") return;
    // Every piece of text in the section, nested or not.
    const texts: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === "string") texts.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(journey);
    for (const text of texts) expect(text, "replace every [bracketed] placeholder first").not.toMatch(/\[[^\]]+\]/);
    expect(journey.before && journey.after, "add both photos").toBeTruthy();
  });

  it("has unique ids within each list", () => {
    for (const ids of [services.map((s) => s.id), timetable.sessions.map((s) => s.id), faq.map((f) => f.id)]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps unsupplied RAENG content out of the site", () => {
    // Nothing has been supplied for these slots; none may be published until Alex confirms it.
    expect(testimonials.filter((t) => t.status === "confirmed")).toEqual([]);
    // The quote is Alex's own words from his launch post (Instagram, 26 Oct 2026).
    expect(aboutQuote?.text).toBe("Be part of something bigger than just a workout.");
    for (const field of [coach.background, coach.qualifications, coach.philosophy, coach.motivation]) {
      expect(field === null || field.status === "provisional").toBe(true);
    }
  });
});

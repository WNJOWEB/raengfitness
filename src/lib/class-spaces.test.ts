import { describe, expect, it } from "vitest";
import { classAvailability } from "./availability/timetable";
import { classSpacesKey, formatSpaces, isFull, spacesRemaining } from "./class-spaces";
import { loadClassSpaces } from "./class-spaces-server";

describe("formatSpaces", () => {
  it("shows places left in Alex's wording", () => {
    expect(formatSpaces({ capacity: 15, booked: 5 })).toBe("10/15 spaces available");
    expect(formatSpaces({ capacity: 15, booked: 14 })).toBe("1/15 spaces available");
    expect(formatSpaces({ capacity: 15, booked: 0 })).toBe("15/15 spaces available");
  });

  it("says Full when none are left, even if over-booked", () => {
    expect(formatSpaces({ capacity: 15, booked: 15 })).toBe("15/15 Full");
    expect(formatSpaces({ capacity: 15, booked: 17 })).toBe("15/15 Full");
    expect(isFull({ capacity: 15, booked: 17 })).toBe(true);
    expect(spacesRemaining({ capacity: 15, booked: 17 })).toBe(0);
  });
});

describe("classAvailability with places", () => {
  const sessions = [
    { id: "mon-evening", day: "Monday", start: "18:30", name: "KB HIIT" },
    { id: "wed-evening", day: "Wednesday", start: "18:30", name: "Double KB" },
  ] as const;
  // Friday 16 October 2026: next Monday is the 19th, Wednesday the 21st.
  const today = "2026-10-16";

  it("marks a full class unavailable and carries names and places", () => {
    const window = classAvailability(sessions, today, {
      [classSpacesKey("2026-10-19", "mon-evening")]: { capacity: 15, booked: 15 },
      [classSpacesKey("2026-10-21", "wed-evening")]: { capacity: 15, booked: 5 },
    });
    expect(window.days[0].slots[0]).toMatchObject({ name: "KB HIIT", available: false, places: { capacity: 15, booked: 15 } });
    expect(window.days[1].slots[0]).toMatchObject({ name: "Double KB", available: true, places: { capacity: 15, booked: 5 } });
  });

  it("leaves every date open and shows no counts when places are unknown", () => {
    const slot = classAvailability(sessions, today, null).days[0].slots[0];
    expect(slot.available).toBe(true);
    expect(slot.places).toBeUndefined();
  });
});

describe("loadClassSpaces", () => {
  const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" };

  it("returns null without Supabase, so no counts are invented", async () => {
    expect(await loadClassSpaces("2026-10-19", "2026-10-25", {})).toBeNull();
  });

  it("returns null when the database does not answer", async () => {
    const down = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await loadClassSpaces("2026-10-19", "2026-10-25", env, down)).toBeNull();
  });

  it("defaults to 15 places with none taken, uses a class's own capacity, and exposes counts only", async () => {
    const rows = [
      { id: "1", slot: "wed-evening", class_date: "2026-10-21", starts_at: "x", duration_minutes: 60, capacity: 8, notes: "private note", booked: 3, attended: 0 },
    ];
    const ok = (async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;
    const spaces = await loadClassSpaces("2026-10-19", "2026-10-25", env, ok);
    expect(spaces).toEqual({
      "2026-10-19|mon-evening": { capacity: 15, booked: 0 },
      "2026-10-21|wed-evening": { capacity: 8, booked: 3 },
      "2026-10-24|sat-morning": { capacity: 15, booked: 0 },
    });
    expect(JSON.stringify(spaces)).not.toContain("private");
  });
});

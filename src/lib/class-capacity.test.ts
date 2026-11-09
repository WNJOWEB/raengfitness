import { describe, expect, it } from "vitest";
import { classAvailability } from "./availability/timetable";
import { fullClasses, fullKey } from "./class-capacity";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_x",
};
const respond = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe("full classes", () => {
  it("marks a class full only when its capacity is reached", async () => {
    const rows = [
      {
        slot: "mon-evening",
        class_date: "2026-11-02",
        capacity: 10,
        booked: 10,
        cancelled_at: null,
      },
      {
        slot: "wed-evening",
        class_date: "2026-11-04",
        capacity: 10,
        booked: 9,
        cancelled_at: null,
      },
      {
        slot: "sat-morning",
        class_date: "2026-11-07",
        capacity: 1,
        booked: 3,
        cancelled_at: null,
      },
      {
        slot: "mon-evening",
        class_date: "2026-11-09",
        capacity: null,
        booked: 4,
        cancelled_at: null,
      },
    ];
    expect(await fullClasses("2026-10-30", env, respond(200, rows))).toEqual({
      known: true,
      keys: ["mon-evening|2026-11-02", "sat-morning|2026-11-07"],
      cancelled: [],
      left: {
        "mon-evening|2026-11-02": 0,
        "wed-evening|2026-11-04": 1,
        "sat-morning|2026-11-07": 0,
      },
    });
  });

  it("lists classes the coach cancelled separately (never as full)", async () => {
    const rows = [
      {
        slot: "wed-evening",
        class_date: "2026-11-04",
        capacity: 1,
        booked: 0,
        cancelled_at: "2026-10-31T09:00:00Z",
      },
    ];
    expect(await fullClasses("2026-10-30", env, respond(200, rows))).toEqual({
      known: true,
      keys: [],
      cancelled: ["wed-evening|2026-11-04"],
      left: {},
    });
  });

  it("is unknown (nothing full) when the database isn't configured or doesn't answer", async () => {
    expect(await fullClasses("2026-10-30", {}, respond(200, []))).toEqual({
      known: false,
      keys: [],
      cancelled: [],
    });
    expect(await fullClasses("2026-10-30", env, respond(503, {}))).toEqual({
      known: false,
      keys: [],
      cancelled: [],
    });
    const broken = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    expect(await fullClasses("2026-10-30", env, broken)).toEqual({
      known: false,
      keys: [],
      cancelled: [],
    });
  });

  it("asks only for capacity and cancellation data in the booking window, with the secret key", async () => {
    let seen = "";
    let key = "";
    const spy = (async (url: string, init?: RequestInit) => {
      seen = url;
      key = String((init?.headers as Record<string, string>).apikey);
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    await fullClasses("2026-10-30", env, spy);
    expect(seen).toContain(
      "/rest/v1/akb_class_overview?select=slot%2Cclass_date%2Ccapacity%2Cbooked%2Ccancelled_at",
    );
    expect(seen).toContain("class_date=gte.2026-10-30");
    expect(key).toBe("sb_secret_x");
  });

  it("shows a full class as fully booked in the calendar", () => {
    const sessions = [
      { id: "mon-evening", day: "Monday", start: "18:30" },
    ] as const;
    const w = classAvailability(
      sessions,
      "2026-10-30",
      new Set([fullKey("mon-evening", "2026-11-02")]),
    );
    const slot = (date: string) =>
      w.days.find((d) => d.date === date)?.slots[0];
    expect(slot("2026-11-02")?.available).toBe(false);
    expect(slot("2026-11-09")?.available).toBe(true);
  });

  it("leaves a cancelled class out of the calendar", () => {
    const sessions = [
      { id: "mon-evening", day: "Monday", start: "18:30" },
    ] as const;
    const w = classAvailability(
      sessions,
      "2026-10-30",
      new Set(),
      new Set([fullKey("mon-evening", "2026-11-02")]),
    );
    expect(w.days.map((d) => d.date)).not.toContain("2026-11-02");
    expect(w.days.map((d) => d.date)).toContain("2026-11-09");
  });
});

import { describe, expect, it } from "vitest";
import { calendarFeedUrl, deviceLabel, feedToken, reminderEmail, webcalUrl } from "./member-settings";

describe("deviceLabel", () => {
  it("names the device and browser family only", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone, Safari");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")).toBe("Mac, Chrome");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")).toBe("Windows, Edge");
    expect(deviceLabel("Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0")).toBe("Android, Firefox");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1")).toBe("iPhone, Chrome");
  });

  it("is empty when the browser says nothing, and never exceeds the database's 60 characters", () => {
    expect(deviceLabel(null)).toBe("");
    expect(deviceLabel("curl/8.0")).toBe("");
    expect(deviceLabel("x".repeat(5000)).length).toBeLessThanOrEqual(60);
  });
});

describe("the calendar link", () => {
  const env = { VERCEL_ENV: "production", SITE_URL: "https://raeng.example" };
  const token = "t".repeat(43);

  it("points at the site's own address, as a .ics", () => {
    expect(calendarFeedUrl(token, env)).toBe(`https://raeng.example/account/calendar/feed/${token}.ics`);
  });

  it("can be opened by calendar apps through webcal", () => {
    expect(webcalUrl("https://raeng.example/account/calendar/feed/x.ics")).toBe("webcal://raeng.example/account/calendar/feed/x.ics");
  });

  it("gives the token back with or without .ics", () => {
    expect(feedToken(`${token}.ics`)).toBe(token);
    expect(feedToken(token)).toBe(token);
  });
});

describe("the reminder email", () => {
  const env = { VERCEL_ENV: "production", SITE_URL: "https://raeng.example" };
  // 6:30 pm in London on 2 November 2026 (GMT).
  const email = reminderEmail({ attendance_id: "a", name: "Nitisat Sample", email: "n@example.com", starts_at: "2026-11-02T18:30:00.000Z", slot: "none" }, env);

  it("says which class, today, at the London time", () => {
    expect(email.subject).toContain("today at 6:30 pm");
    expect(email.text).toContain("Hi Nitisat,");
    expect(email.text).toContain("today at 6:30 pm");
  });

  it("links to the account and to turning reminders off, on the site's own address", () => {
    expect(email.text).toContain("https://raeng.example/account\n");
    expect(email.text).toContain("https://raeng.example/account/notifications");
  });
});

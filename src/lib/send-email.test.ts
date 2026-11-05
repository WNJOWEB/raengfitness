import { describe, expect, it, vi } from "vitest";
import { idempotencyKey, sendEmail } from "./send-email";

const config = { apiKey: "re_test", to: "alex@example.com", from: "bookings@example.com", endpoint: "https://api.resend.com/emails" };
const email = { subject: "S", text: "T", replyTo: "sam@example.com", idempotencyKey: "k" };

describe("sendEmail", () => {
  it("posts the documented Resend payload and reports success", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await sendEmail(config, email, fetchImpl as unknown as typeof fetch)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toBe("k");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: "bookings@example.com",
      to: ["alex@example.com"],
      reply_to: "sam@example.com",
      subject: "S",
      text: "T",
    });
    // Alex's alerts keep their text as written; every email also goes as HTML in RAENG's layout.
    expect(body.html).toContain("<!doctype html>");
  });

  it("reports provider errors and network failures as failures", async () => {
    const rejected = vi.fn(async () => new Response("{}", { status: 422 }));
    expect(await sendEmail(config, email, rejected as unknown as typeof fetch)).toEqual({ ok: false, status: 422 });
    const offline = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await sendEmail(config, email, offline as unknown as typeof fetch)).toEqual({ ok: false, status: null });
  });
});

describe("customer emails", () => {
  it("add RAENG's sign-off and contact details to the text, and send a branded HTML version", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendEmail(config, { ...email, to: "sam@example.com", text: "Your place is booked." }, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.text).toMatch(/^Your place is booked\.\n\nThanks,\nAlex\nRAENG Fitness\n\n1A Dunnswood Road, Cumbernauld, G67 3EN\nhello@raengfitness\.co\.uk · Instagram @raeng\.fitness$/);
    expect(body.html).toContain("Thanks,<br><strong>Alex</strong><br>RAENG Fitness");
    expect(body.html).toContain("/brand/raeng-header-black.png");
    expect(body.html).toContain("Your place is booked.");
    expect(body.html).toContain("isn't a marketing email");
  });
});

describe("idempotencyKey", () => {
  it("is stable for identical input and differs otherwise", async () => {
    const a = await idempotencyKey(["id", "sam@example.com"]);
    expect(a).toBe(await idempotencyKey(["id", "sam@example.com"]));
    expect(a).not.toBe(await idempotencyKey(["id", "other@example.com"]));
    expect(a.length).toBeLessThanOrEqual(256);
  });
});

describe("sendEmailWithRetry", () => {
  it("tries once more, with the same key, only for transient failures", async () => {
    const { sendEmailWithRetry } = await import("./send-email");
    for (const [first, calls] of [[500, 2], [429, 2], [422, 1], [401, 1]] as const) {
      const fetchImpl = vi.fn(async () => new Response("{}", { status: fetchImpl.mock.calls.length === 1 ? first : 200 }));
      await sendEmailWithRetry(config, email, fetchImpl as unknown as typeof fetch, 0);
      expect(fetchImpl, String(first)).toHaveBeenCalledTimes(calls);
      const keys = fetchImpl.mock.calls.map((c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)["Idempotency-Key"]);
      expect(new Set(keys)).toEqual(new Set(["k"]));
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  ENQUIRY_HREF,
  PRIMARY_CTA,
  bookingConfigWarning,
  bookingMode,
  getBookingAction,
  getClassBookingAction,
  getPrimaryCta,
  getPrimaryCtaFor,
  getOnlineCoachingAction,
  isBookingDemoEnabled,
  onlineEnquiryMode,
  parseBookingUrl,
} from "./booking";

const formEnv = {
  RESEND_API_KEY: "re_test",
  BOOKING_NOTIFY_EMAIL: "alex@example.com",
  BOOKING_FROM_EMAIL: "bookings@example.com",
};

describe("PRIMARY_CTA", () => {
  it("is an honest 'Get in touch' link to the contact page, for when nothing can be booked", () => {
    expect(PRIMARY_CTA).toEqual({ kind: "enquiry", label: "Get in touch", href: "/contact", external: false });
    expect(PRIMARY_CTA.label).not.toMatch(/book|pay|checkout/i);
  });
});

describe("getPrimaryCta", () => {
  const supabase = { SUPABASE_URL: "https://ref.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" };

  it("says Book now and opens the booking page on production once booking works", () => {
    const cta = getPrimaryCta({ VERCEL_ENV: "production", ...supabase });
    expect(cta).toEqual({ kind: "booking", label: "Book now", href: "/book", external: false });
    expect(cta.label).not.toMatch(/pay|checkout/i);
    // Every service page uses the same words.
    expect(getPrimaryCtaFor("one-to-one", { VERCEL_ENV: "production", ...supabase }).label).toBe("Book now");
  });

  it("is PRIMARY_CTA (contact page) where booking can't work", () => {
    // BOOKING_DEMO is ignored on production, so nothing can take a booking there.
    expect(getPrimaryCta({ VERCEL_ENV: "production", BOOKING_DEMO: "true" })).toEqual(PRIMARY_CTA);
    expect(getPrimaryCta({})).toEqual(PRIMARY_CTA);
    expect(getPrimaryCta({ VERCEL_ENV: "development" })).toEqual(PRIMARY_CTA);
  });

  it("goes straight to a service's booking step on its own page", () => {
    const env = { VERCEL_ENV: "production", ...supabase };
    expect(getPrimaryCtaFor("group-class", env).href).toBe("/book/group-class");
    expect(getPrimaryCtaFor("one-to-one", env).href).toBe("/book/one-to-one");
    expect(getPrimaryCtaFor("group-class", {}).href).toBe("/contact");
  });

  it("always opens the booking page on Vercel previews", () => {
    expect(getPrimaryCta({ VERCEL_ENV: "preview" })).toMatchObject({ kind: "booking", href: "/book" });
  });
});

describe("parseBookingUrl", () => {
  it("accepts https URLs only", () => {
    expect(parseBookingUrl("https://example.setmore.com/")?.hostname).toBe("example.setmore.com");
    expect(parseBookingUrl("http://example.com")).toBeNull();
    expect(parseBookingUrl("javascript:alert(1)")).toBeNull();
    expect(parseBookingUrl("not a url")).toBeNull();
    expect(parseBookingUrl("")).toBeNull();
    expect(parseBookingUrl(undefined)).toBeNull();
  });
});

describe("demo availability", () => {
  it("is opt-in", () => {
    expect(isBookingDemoEnabled({})).toBe(false);
    expect(isBookingDemoEnabled({ BOOKING_DEMO: "1" })).toBe(false);
    expect(isBookingDemoEnabled({ BOOKING_DEMO: "true", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("can never be switched on for Vercel production", () => {
    expect(isBookingDemoEnabled({ BOOKING_DEMO: "true", VERCEL_ENV: "production" })).toBe(false);
    expect(bookingMode({ ...formEnv, BOOKING_DEMO: "true", VERCEL_ENV: "production" })).toBe("request");
    expect(bookingMode({ BOOKING_DEMO: "true", VERCEL_ENV: "production" })).toBe("unavailable");
  });
});

describe("bookingMode", () => {
  it("prefers a real external page, then demo, then email requests", () => {
    expect(bookingMode({})).toBe("unavailable");
    expect(bookingMode(formEnv)).toBe("request");
    expect(bookingMode({ ...formEnv, BOOKING_DEMO: "true" })).toBe("demo");
    expect(bookingMode({ ...formEnv, BOOKING_DEMO: "true", BOOKING_URL: "https://booking.example.com" })).toBe("external");
    expect(bookingMode({ BOOKING_URL: "http://insecure.example" })).toBe("unavailable");
  });
});

describe("onlineEnquiryMode", () => {
  it("sends for real whenever email is configured, otherwise demo or unavailable", () => {
    expect(onlineEnquiryMode({})).toBe("unavailable");
    expect(onlineEnquiryMode({ BOOKING_DEMO: "true" })).toBe("demo");
    expect(onlineEnquiryMode({ ...formEnv, BOOKING_DEMO: "true" })).toBe("send");
    expect(onlineEnquiryMode({ BOOKING_DEMO: "true", VERCEL_ENV: "production" })).toBe("unavailable");
  });
});

describe("getBookingAction", () => {
  it("falls back to an honest enquiry when nothing is configured", () => {
    const action = getClassBookingAction({});
    expect(action).toMatchObject({ kind: "enquiry", href: ENQUIRY_HREF, external: false });
    expect(action.label).not.toMatch(/book/i);
    expect(getBookingAction("any", {}).label).not.toMatch(/book/i);
  });

  it("points each service at its own step of the on-site flow", () => {
    expect(getBookingAction("any", formEnv)).toMatchObject({ kind: "booking", label: "Book your session", href: "/book", external: false });
    expect(getBookingAction("group-class", formEnv)).toMatchObject({ label: "Book your class", href: "/book/group-class" });
    expect(getBookingAction("one-to-one", formEnv)).toMatchObject({ label: "Book now", href: "/book/one-to-one" });
  });

  it("prefers an external booking page when one is set", () => {
    expect(getClassBookingAction({ ...formEnv, BOOKING_URL: "https://booking.example.com" })).toMatchObject({
      href: "https://booking.example.com/",
      external: true,
    });
  });
});

describe("getOnlineCoachingAction", () => {
  it("links to the onboarding journey only when it can be completed", () => {
    expect(getOnlineCoachingAction(formEnv).href).toBe("/online-coaching");
    expect(getOnlineCoachingAction({}).href).toBe(ENQUIRY_HREF);
    // Always worded as an enquiry, never as signing up or starting.
    expect(getOnlineCoachingAction(formEnv).label).toBe("Enquire about online coaching");
    expect(getOnlineCoachingAction({}).label).toBe("Enquire about online coaching");
  });
});

describe("bookingConfigWarning", () => {
  it("flags a missing route on production only", () => {
    expect(bookingConfigWarning({ VERCEL_ENV: "production" })).toMatch(/No booking route is configured/);
    expect(bookingConfigWarning({ VERCEL_ENV: "production", BOOKING_DEMO: "true" })).toMatch(/ignored on production/);
    expect(bookingConfigWarning({ VERCEL_ENV: "production", BOOKING_URL: "http://x.example" })).toMatch(/not a valid https URL/);
    expect(bookingConfigWarning({ VERCEL_ENV: "production", BOOKING_URL: "https://x.example/book" })).toBeNull();
    expect(bookingConfigWarning({ VERCEL_ENV: "production", ...formEnv })).toBeNull();
    expect(bookingConfigWarning({ VERCEL_ENV: "preview" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { memberBookingEmail } from "./member-booking-email";

describe("memberBookingEmail", () => {
  const mail = memberBookingEmail("Saturday 14 November 2026, 9:00 am", "https://raengfitness.co.uk/account", ["1A Dunnswood Road", "Cumbernauld, Glasgow", "G67 3EN"]);

  it("confirms the booking, names the credit and gives the address", () => {
    expect(mail.subject).toBe("You're booked: Saturday 14 November 2026, 9:00 am");
    expect(mail.text).toContain("is confirmed (one membership credit used).");
    expect(mail.text).toContain("Where: 1A Dunnswood Road, Cumbernauld, Glasgow, G67 3EN");
  });

  it("asks them to arrive 10 minutes early", () => {
    expect(mail.text).toContain("Please arrive 10 minutes early so we can start on time.");
  });

  it("links to the account to see or cancel", () => {
    expect(mail.text).toContain("You can see or cancel it in your account: https://raengfitness.co.uk/account");
  });
});

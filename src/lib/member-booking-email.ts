import { arriveEarlyNote } from "@/content/classes";
import { formatAddressLines } from "@/content/site";

/**
 * The confirmation a member gets when they book a class with a membership
 * credit. Plain text. Pure, so the wording is tested (src/lib/member-booking-email.test.ts).
 */
export function memberBookingEmail(when: string, accountUrl: string, address: string[] = formatAddressLines()): { subject: string; text: string } {
  return {
    subject: `You're booked: ${when}`,
    text: `Your place on the group class on ${when} is confirmed (one membership credit used).\nWhere: ${address.join(", ")}\n\n${arriveEarlyNote}\n\nYou can see or cancel it in your account: ${accountUrl}`,
  };
}

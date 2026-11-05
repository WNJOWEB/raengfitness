import type { ContentStatus } from "./types";

/**
 * First class free (Alex, 2026-11-05). New customers' first group class is
 * free: booked online like any class, with nothing to pay and no card. The
 * database decides who is new (supabase/migrations/20261123000000): someone
 * who has never had a place on a class or a membership, one free class per
 * email address. Cancelled 24 hours or more before, it can be booked again for
 * another date; later than that, or not turning up, uses it. Switch `status`
 * to "provisional" to take the offer off the site (it then applies nowhere).
 */
export const firstClassFree = {
  status: "confirmed" as ContentStatus,
  /** Short line wherever classes and prices are shown. */
  headline: "Your first class is free",
  /** One line under the headline. */
  line: "New to RAENG? Your first group class is on us. No card needed.",
  /** In the booking form, before paying. */
  booking: "New to RAENG? Your first class is free: if this is your first class with us, it's booked with nothing to pay. Otherwise you'll pay on Stripe's secure page.",
  /** The terms, in full. */
  terms:
    "New customers only: one free group class per person, booked with your own email address. Cancel at least 24 hours before if you can't make it and you can book it for another date; cancelling later, or not turning up, uses it.",
} as const;

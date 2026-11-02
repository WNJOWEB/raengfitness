import { fullClasses } from "@/lib/class-capacity";
import { londonToday } from "@/lib/coach/time";
import { memberOverview } from "@/lib/member-auth";
import { coachingOverview, coachingStatus } from "@/lib/coaching";
import { onlineCoachingOffered } from "@/content/services";
import { memberSettings } from "@/lib/member-settings";
import { requireMember } from "@/lib/member-session";
import { paymentDue } from "@/lib/membership-checkout";
import { directDebitEnabled, stripeConfig } from "@/lib/stripe/config";
import { paymentMethodInfo } from "@/lib/stripe/direct-debit";

/** After an action: what happened (?done=). Shown as a toast. */
export const DONE: Record<string, string> = {
  booked: "Booked. One credit used.",
  cancelled: "Cancelled. Your credit is back.",
  cancelled_late: "Cancelled. It was less than 24 hours before the class, so the credit is used.",
  cancelled_credit: "Cancelled. You have a class credit for another class within 4 weeks.",
  cancelled_paid_late: "Cancelled. It was less than 24 hours before the class, so there's nothing back.",
  booked_class_credit: "Booked with your class credit. Nothing to pay.",
  profile_saved: "Saved. Your details are updated.",
  card_updated: "Thanks, your card is saved. Your renewals will be charged to it.",
  membership_cancelled: "Your membership is cancelled. You keep the credits you've paid for until the end of this period, and nothing more will be taken.",
  reminders_on: "Class reminders are on. You'll get an email on the morning of each class you're booked on.",
  reminders_off: "Class reminders are off.",
  calendar_off: "Calendar link turned off. Calendars that used it stop updating.",
  device_out: "That device is signed out.",
  session_logged: "Session logged. Alex can see it.",
  check_in_sent: "Check-in sent to Alex.",
};

/** Why an action couldn't happen (?error=). Shown as an alert at the top. */
export const ERRORS: Record<string, string> = {
  class_full: "Sorry, that class is full.",
  class_cancelled: "That class has been cancelled.",
  no_credits: "You've no credits left this period.",
  already_booked: "You're already booked on that class.",
  class_started: "That class has already started.",
  outside_period: "Credits can only be used in the period they belong to. That date is in your next period.",
  period_unpaid: "Please pay for this period first. Its credits work as soon as Stripe confirms.",
  not_found: "That class couldn't be found. Please try again.",
  credit_invalid: "That class credit can't be used for that class. It may have been used, or the class is after it runs out.",
  invalid_name: "Please enter your name (up to 100 characters).",
  invalid_phone: "That phone number looks too long. Please check it (up to 30 characters).",
  device_gone: "That device was already signed out.",
  check_in_scores: "Pick 1 to 5 for energy, sleep and training.",
  check_in_video: "That video link doesn't look right. Paste the link to an unlisted YouTube, Vimeo or Drive video.",
  check_in_already: "You've already sent this week's check-in.",
  message_invalid: "Write a message first (up to 2,000 characters).",
  message_too_many: "That's a lot of messages in an hour. Please wait a little, then try again.",
  no_programme: "Your programme isn't ready yet. Alex is writing it.",
  card_unavailable: "Sorry, the card page couldn't be opened just now. Please try again in a minute, or message Alex.",
  direct_debit_unavailable: "Sorry, Direct Debit set-up couldn't be opened just now. Please try again in a minute, or message Alex.",
  failed: "Sorry, something went wrong. Please try again, or message Alex.",
};

type Params = Record<string, string | string[] | undefined>;

/**
 * What every members page needs: the signed-in member (or the sign-in page),
 * their overview, which classes are full or cancelled, any payment due, and
 * the status of the last action.
 */
export async function loadMembers(searchParams: Promise<Params>) {
  const member = await requireMember();
  const params = await searchParams;
  const now = new Date();
  const today = londonToday(now);
  const [overview, settings, coaching, full, due, dd] = await Promise.all([
    memberOverview(member.db, member.clientId),
    // The account menu's "On" / "Connected"; the menu leaves them out if this can't be read.
    memberSettings(member.db, member.clientId),
    // Online coaching: the card, the menu's Coaching, the avatar's ring (left out if it can't be read).
    coachingStatus(member.db, member.clientId),
    fullClasses(today),
    // Members who pay online: this period's payment, if it's still to pay (credits wait for it).
    paymentDue(member.db, stripeConfig(), member.clientId),
    paymentMethodInfo(member.db, member.clientId),
  ]);
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  const done = one("done") ? (DONE[one("done")!] ?? null) : null;
  const error = one("error") ? (ERRORS[one("error")!] ?? ERRORS.failed) : null;
  return { member, now, today, overview, settings: settings.ok ? settings.data : null, coaching: coaching.ok && (coaching.data.active || onlineCoachingOffered) ? coaching.data : null, full, due, dd, ddAvailable: directDebitEnabled(), cardAvailable: stripeConfig() !== null, done, error, justBooked: done ? one("at") : null, confirm: one("confirm") };
}


/**
 * What the coaching pages need: the signed-in member (or the sign-in page),
 * their account overview (for the avatar and menu), their coaching in full,
 * and the status of the last action. Lighter than loadMembers: no class
 * capacity or payment lookups.
 */
export async function loadCoaching(searchParams: Promise<Params>) {
  const member = await requireMember();
  const params = await searchParams;
  const [overview, settings, coaching] = await Promise.all([
    memberOverview(member.db, member.clientId),
    memberSettings(member.db, member.clientId),
    coachingOverview(member.db, member.clientId),
  ]);
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  const done = one("done") ? (DONE[one("done")!] ?? null) : null;
  const error = one("error") ? (ERRORS[one("error")!] ?? ERRORS.failed) : null;
  return {
    member,
    now: new Date(),
    overview,
    settings: settings.ok ? settings.data : null,
    coaching: coaching.ok ? coaching.data : null,
    done,
    error,
    day: one("day"),
    relog: one("relog") === "1",
  };
}

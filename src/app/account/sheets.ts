import { groupClass } from "@/content/classes";
import { site } from "@/content/site";
import type { MemberPlace } from "@/lib/member-auth";
import { MEMBERS_VIEW_PATH, type MembersView } from "@/lib/members-app";
import { longWhen, type WeekSlot } from "@/lib/member-view";
import type { SheetPayload } from "@/components/members/sheet";

/**
 * The confirm sheets, with the real rules (owner's design, 2026-10-28): the
 * actions they submit re-check everything, so these only say what will happen.
 * Each has a key for its no-JavaScript link (?confirm=…).
 */

const where = `${groupClass.name} at ${site.location.street}, ${site.location.town}.`;

export const sheetKey = {
  book: (s: WeekSlot) => `book.${s.date}.${s.slot}`,
  cancel: (p: MemberPlace) => `cancel.${p.id}`,
};

export function sheetHref(view: MembersView, key: string): string {
  return `${MEMBERS_VIEW_PATH[view]}?confirm=${encodeURIComponent(key)}`;
}

export function bookSheet(s: WeekSlot, left: number, back: MembersView): SheetPayload {
  return {
    kind: "book",
    eyebrow: "Book with a credit",
    title: s.label,
    body: `Uses 1 of your ${left} credit${left === 1 ? "" : "s"}. ${where}`,
    confirm: "Book it",
    keep: "Not now",
    fields: { slot: s.slot, date: s.date, back },
  };
}

export function creditSheet(s: WeekSlot, creditId: string, back: MembersView): SheetPayload {
  return {
    kind: "credit",
    eyebrow: "Book with your class credit",
    title: s.label,
    body: `Uses your class credit, so there's nothing to pay. ${where}`,
    confirm: "Book it",
    keep: "Not now",
    fields: { slot: s.slot, date: s.date, credit: creditId, back },
  };
}

/** Cancelling: what comes back 24 hours or more before, or that nothing does after that. */
export function cancelSheet(p: MemberPlace, back: MembersView): SheetPayload {
  if (!p.can_cancel) {
    return { kind: "info", eyebrow: "Your booking", title: longWhen(p.starts_at), body: "To change this place, message Alex.", confirm: "", keep: "Close", fields: {} };
  }
  const membershipCredit = p.how === "credit";
  const body = p.refunded
    ? "Your payment for this class has already been refunded, so cancelling gives no credit."
    : p.credit_back_if_cancelled
    ? membershipCredit
      ? "Your credit comes back, and your place goes to someone else."
      : "You get a class credit for another class within 4 weeks."
    : membershipCredit
      ? "It's less than 24 hours before the class, so the credit will be used."
      : "It's less than 24 hours before the class, so there's nothing back.";
  const fields: Record<string, string> = { place: p.id, back, at: `${p.class_date}.${p.slot}` };
  if (p.how === "paid" || p.how === "class_credit") fields.paid = "yes";
  return {
    kind: "cancel",
    eyebrow: "Cancel booking",
    title: longWhen(p.starts_at),
    body,
    confirm: p.credit_back_if_cancelled || p.refunded ? "Cancel booking" : "Cancel anyway",
    keep: "Keep it",
    fields,
  };
}

/** How a place was paid for, in a few words. */
export function paidWith(p: MemberPlace): string {
  return p.how === "credit" ? "Membership credit" : p.how === "paid" ? "Paid" : p.how === "class_credit" ? "Class credit" : "Arranged with Alex";
}

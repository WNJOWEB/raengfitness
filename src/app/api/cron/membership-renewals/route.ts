import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { coachDb } from "@/lib/coach/db";
import { rpc } from "@/lib/coach/db";
import { renewMemberships } from "@/lib/coach/memberships";
import { londonToday } from "@/lib/coach/time";
import { sendDirectDebitReminders, sendRenewalLinks } from "@/lib/membership-checkout";
import { collectDirectDebits, notifyDirectDebitFailures, notifyRenewalPayments, endUnusedDirectDebits, sendRenewalReminders } from "@/lib/stripe/direct-debit";
import { stripeConfig } from "@/lib/stripe/config";
import { afterPlacesChange } from "@/lib/waitlist";

/**
 * Renews memberships every four weeks (vercel.json "crons", daily): each
 * active membership whose next period has begun gets that period, its credits
 * and its charge. Idempotent in the database, so a retried or doubled call
 * creates nothing twice. Vercel Cron sends "Authorization: Bearer
 * <CRON_SECRET>"; anything else gets 401 and does nothing. Counts only.
 * Also tidies member sign-ins (akb_member_cleanup: links after a day, ended
 * sessions after 30 days); a failure there is logged and never stops renewals.
 * Then, for members who joined and pay online, emails a Stripe pay link for
 * each new period still to pay (once each; needs Stripe and email settings).
 * Members with a saved card or a Direct Debit are not sent a link: a card is
 * charged on the day its period starts, a Direct Debit is submitted a few days
 * early (lib/stripe/direct-debit.ts); card members get a reminder 5 days before,
 * every member a receipt when it is paid and an email if a payment fails.
 * And releases class places held for online payment that ran out
 * (akb_release_class_holds; an unpaid charge is cancelled a day later).
 */
export async function GET(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const db = coachDb();
  if (!db) return NextResponse.json({ skipped: "not-configured" }, { headers: noStore });
  const result = await renewMemberships(db, londonToday());
  if (!result.ok) {
    console.error(`Membership renewals failed (${result.error.kind} ${result.error.code})`);
    return NextResponse.json({ ok: false, error: result.error.kind }, { status: 503, headers: noStore });
  }
  const tidied = await rpc<number>(db, "akb_member_cleanup", {});
  if (!tidied.ok) console.error(`Member sign-in clean-up failed (${tidied.error.kind} ${tidied.error.code})`);
  const holds = await rpc<number>(db, "akb_release_class_holds", {});
  if (!holds.ok) console.error(`Class hold release failed (${holds.error.kind} ${holds.error.code})`);
  // Places freed by holds that ran out are offered to the waitlist, and lapsed offers go to the next person.
  await afterPlacesChange(db);
  const stripe = stripeConfig();
  const links = stripe ? await sendRenewalLinks(db, stripe, londonToday()) : null;
  if (links?.failed) console.error(`Membership pay links: ${links.failed} couldn't be sent`);
  const collections = stripe ? await collectDirectDebits(db, stripe, londonToday()) : null;
  const ddNotified = stripe ? await notifyDirectDebitFailures(db).catch(() => 0) : null;
  const renewedNotices = stripe ? await notifyRenewalPayments(db).catch(() => 0) : null;
  const reminders = stripe ? await sendRenewalReminders(db, stripe, londonToday()).catch(() => 0) : null;
  // Direct Debits no longer needed (membership cancelled, nothing still collecting) are cancelled with Stripe.
  const ddEnded = stripe ? await endUnusedDirectDebits(db, stripe).catch(() => 0) : null;
  // One reminder to set up a Direct Debit, a couple of days after joining by card.
  const ddReminders = stripe ? await sendDirectDebitReminders(db, stripe, londonToday()).catch(() => 0) : null;
  return NextResponse.json(
    { ok: true, periodsCreated: result.data, signInsRemoved: tidied.ok ? tidied.data : null, payLinksSent: links ? links.sent : null, directDebitsSubmitted: collections ? collections.submitted : null, directDebitFailures: ddNotified, renewalReceipts: renewedNotices, renewalReminders: reminders, directDebitsEnded: ddEnded, directDebitReminders: ddReminders, classHoldsReleased: holds.ok ? holds.data : null },
    { headers: noStore },
  );
}

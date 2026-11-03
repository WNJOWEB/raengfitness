# Booking and payment confirmation audit (2026-11-03)

Asked by the owner: every booking and payment journey must always end on a page that says clearly what happened and what happens next, never on the homepage with no feedback, and never claiming success unless Stripe's signed word is in the database.

## Flows audited

| # | Flow | Who | Where it ends |
|---|------|-----|---------------|
| 1 | Book and pay for a group class (card, Stripe) | guest or signed in | `/book/done?booking=` |
| 2 | Book a group class with a class credit (no payment) | guest or signed in | `/book/done?booking=` |
| 3 | Join a membership online (first four weeks by card) | guest or signed in | `/memberships/join/done?signup=` |
| 4 | Set up Direct Debit after joining, or change card (account) | member | `/memberships/join/done?...&dd=`, `/account/direct-debit` |
| 5 | Pay a membership renewal link (email, or the "Payment due" card) | member | `/pay/done?link=` (was `/account`) |
| 6 | Pay a card link Alex sends from the coach portal | client | `/pay/done?link=` |
| 7 | Request a 1:1 session, a membership, or an online coaching enquiry (no payment, Alex confirms) | guest | the confirmation on the same page |
| 8 | Cancel a class by the emailed private link | guest or member | `/book/manage?token=` |
| 9 | Book or cancel a class from the member dashboard (credits) | member | the dashboard, with a toast and the highlighted booking |
| 10 | Card refused, 3-D Secure, expired page | anyone | handled on Stripe's own page (card payments only); see limits |

## Problems found

1. **Cancelled looked like "waiting".** Stripe's success and cancel addresses were the same page, so using Stripe's back arrow showed "Waiting for Stripe to confirm" and refreshed forever, with no way to tell a cancelled payment from a slow one.
2. **Renewal payments had no confirmation.** The renewal email link and the "Payment due" card sent people back to `/account` after paying, with no page saying what was paid.
3. **Thin confirmations.** The class and payment pages showed no price, no reference and ended with "Back to the homepage".
4. **Endless waiting.** The waiting pages asked again forever; they now stop after about a minute and say an email will follow.
5. **Request confirmations had no reference** (1:1, membership and online coaching requests), and the email didn't either.
6. **A stale Stripe page could take a second payment.** A page lasts 24 hours; a held class place lasts 15 minutes, and a replaced link left the old page open.

## What changed

- Stripe's back arrow now goes to the same page with `cancelled=1`: it says "Payment cancelled. You haven't been charged." and offers the same payment page again (no second page is made, so no second payment).
- Class place payment pages stop taking payment after 35 minutes (Stripe's shortest is 30, plus a margin so a request arriving a moment late isn't refused); a replaced link also closes its old Stripe page.
- `/book/done`, `/pay/done` and `/memberships/join/done` use the shared confirmation design and show service, date and time, place, price and how it was paid, a reference, what happens next, and a button (View my bookings / Sign in / Book a class).
- Renewal links now return to `/pay/done`, which reads the payment from the database.
- Every waiting page stops asking after 15 tries and says "Still confirming", with an email to follow.
- Requests show a reference (`RAENG-XXXXXXXX`, made from the request's own id), repeat it in the acknowledgement email, and Alex sees it on the request page.
- The class booking email and Alex's notice carry the same reference.
- A new "stopped" state (a cross) for cancelled, expired and closed payments.

## What the pages rely on

Every page reads the database by a random id in the address (never browser state), so a refresh, a bookmark or a direct visit shows the same thing and changes nothing. "You're booked", "Payment received" and "You're in" appear only when the database says confirmed or paid, and the database changes only from Stripe's signed webhook (or the daily reconcile). A `paid=1` or `success=1` in the address does nothing.

## Limits

- Declined cards, 3-D Secure and retries happen on Stripe's own page, which keeps the buyer there: no "failed" return reaches us for card payments, so there's no separate failed page. If asynchronous methods (such as bank debits) are ever added to Stripe Checkout, a failed-payment page is needed.
- Between 15 and 35 minutes a held place can lapse while the Stripe page is still open; a payment then arriving is recorded and Alex is told to sort the place ("Payment received, needs you").
- Request confirmations (1:1, membership and online enquiries) are a screen on the same page, not a separate address, so a refresh starts a fresh form; the reference is in the email.

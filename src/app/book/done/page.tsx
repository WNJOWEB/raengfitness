import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { onlineClassBooking } from "@/content/classes";
import { site } from "@/content/site";
import { CLASS_BOOK_PATH, classBookingStatus, type ClassBookingStatus } from "@/lib/class-checkout";
import { publishedClasses } from "@/lib/class-sessions";
import { coachDb, isUuid } from "@/lib/coach/db";
import { formatPence } from "@/lib/coach/money";
import { SIGN_IN_PATH } from "@/lib/member-auth";
import { pageMetadata } from "@/lib/metadata";
import { buttonClasses } from "@/components/ui/ButtonLink";
import { Confirmation, type ConfirmationStep } from "@/components/ui/Confirmation";
import { Section } from "@/components/ui/Section";
import { LiveStatus } from "@/components/ui/LiveStatus";

export const metadata: Metadata = pageMetadata({
  title: "Your class booking",
  description: "Your RAENG Fitness class booking after paying.",
  path: "/book/done",
  noindex: true,
});

/** How many times the page asks again, 4 seconds apart, before it stops waiting and says it will email. */
const MAX_TRIES = 15;

/**
 * Where Stripe's payment page sends people back to after booking a class:
 * after paying, and (with `cancelled=1`) when they used Stripe's back arrow.
 * It only reads the booking's state from the database, which changes once
 * Stripe's verified webhook has recorded the payment, so arriving here proves
 * nothing: "You're booked" appears only when the database says confirmed.
 * Everything shown comes from the database by the booking's random id (so a
 * refresh, a bookmark or a direct visit shows the same thing and changes
 * nothing). No personal details are shown.
 */
export default async function BookDonePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const raw = params.booking;
  const id = typeof raw === "string" && isUuid(raw) ? raw : null;
  const cancelled = params.cancelled === "1";
  const tries = Math.min(Math.max(Number(typeof params.n === "string" ? params.n : 0) || 0, 0), MAX_TRIES);
  const db = coachDb();
  const booking = id && db ? await classBookingStatus(db, id, publishedClasses()) : null;
  const waiting = booking?.status === "awaiting_payment" && !cancelled && tries < MAX_TRIES;
  return (
    <Section labelledBy="done-heading">
      {waiting ? <LiveStatus href={`/book/done?booking=${id}&n=${tries + 1}`} /> : null}
      <div className="max-w-xl">
        <Body booking={booking} cancelled={cancelled} gaveUp={booking?.status === "awaiting_payment" && !cancelled && tries >= MAX_TRIES} />
      </div>
    </Section>
  );
}

const rows = (booking: ClassBookingStatus, how: string): [string, string][] => [
  ["Service", "Group class"],
  ...(booking.when ? ([["When", booking.when]] as [string, string][]) : []),
  ["Where", `${site.location.street}, ${site.location.town}`],
  ["Price", booking.pricePence > 0 ? `${formatPence(booking.pricePence)}${how}` : "Paid with a class credit"],
  ["Reference", booking.reference],
];

function Body({ booking, cancelled, gaveUp }: { booking: ClassBookingStatus | null; cancelled: boolean; gaveUp: boolean }) {
  const bookAgain = (variant: "action" | "secondary" = "action") => (
    <Link href={CLASS_BOOK_PATH} className={buttonClasses(variant, "w-full px-6 sm:w-auto")}>
      Book a class
    </Link>
  );
  const signIn = (variant: "action" | "secondary" = "action") => (
    <Link href={SIGN_IN_PATH} className={buttonClasses(variant, "w-full px-6 sm:w-auto")}>
      View my bookings
    </Link>
  );
  if (!booking) {
    return (
      <Confirmation state="stopped" headingId="done-heading" eyebrow="Group class" title="We couldn't find that booking." lede="If you've paid, you'll get an email from us shortly with your booking. Otherwise you can book again.">
        {bookAgain()}
      </Confirmation>
    );
  }
  const eyebrow = booking.when ? `Group class · ${booking.when}` : "Group class";

  if (booking.status === "awaiting_payment") {
    if (cancelled) {
      return (
        <Confirmation
          state="stopped"
          headingId="done-heading"
          eyebrow={eyebrow}
          title="Payment cancelled."
          lede="You haven't been charged. We're holding your place for a few minutes while you decide."
          details={[["Reference", booking.reference]]}
        >
          {booking.payUrl ? (
            <a href={booking.payUrl} className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
              Go back and pay
            </a>
          ) : null}
          {bookAgain("secondary")}
        </Confirmation>
      );
    }
    if (gaveUp) {
      return (
        <Confirmation
          state="waiting"
          headingId="done-heading"
          eyebrow={eyebrow}
          title="Still confirming your payment."
          lede="Stripe's confirmation is taking longer than usual. You don't need to wait here: if your payment went through, we'll email you as soon as your place is confirmed."
          details={[["Reference", booking.reference]]}
        >
          {signIn()}
        </Confirmation>
      );
    }
    const steps: ConfirmationStep[] = [
      { label: "Waiting for Stripe's confirmation", status: "active" },
      { label: "Confirming your place", status: "todo" },
      { label: "Emailing your booking", status: "todo" },
    ];
    return (
      <Confirmation state="waiting" headingId="done-heading" eyebrow={eyebrow} title="Confirming your payment." lede="Stripe is confirming your card payment. This usually takes a few seconds, and this page updates by itself." steps={steps}>
        {booking.payUrl ? (
          <p>
            Didn&apos;t finish paying?{" "}
            <a href={booking.payUrl} className="font-semibold underline underline-offset-4 hover:no-underline">
              Go back to Stripe to pay
            </a>
          </p>
        ) : null}
      </Confirmation>
    );
  }
  if (booking.status === "needs_attention") {
    return (
      <Confirmation
        state="waiting"
        headingId="done-heading"
        eyebrow={eyebrow}
        title="Payment received."
        lede="Thanks. Your place couldn't be confirmed automatically (the class may have filled up), so Alex will email you to sort it out. Your payment is safe and recorded."
        details={rows(booking, " by card")}
      >
        {signIn("secondary")}
      </Confirmation>
    );
  }
  if (booking.status === "expired") {
    return (
      <Confirmation state="stopped" headingId="done-heading" eyebrow={eyebrow} title="Your place is no longer held." lede="The payment wasn't finished in time, so nothing was booked or charged. If you did pay, you'll get an email from us. Otherwise, book again.">
        {bookAgain()}
      </Confirmation>
    );
  }
  if (booking.status === "cancelled") {
    return (
      <Confirmation state="stopped" headingId="done-heading" eyebrow={eyebrow} title="This booking is cancelled." details={[["Reference", booking.reference]]}>
        {bookAgain()}
      </Confirmation>
    );
  }
  return (
    <Confirmation
      state="done"
      headingId="done-heading"
      eyebrow={eyebrow}
      title="You're booked."
      lede="Your place is confirmed and your payment has been received. We've emailed you the details and a private link to cancel if you need to."
      details={rows(booking, " paid by card")}
    >
      <p className="text-sm">{onlineClassBooking.cancel}</p>
      {signIn()}
      {bookAgain("secondary")}
    </Confirmation>
  );
}

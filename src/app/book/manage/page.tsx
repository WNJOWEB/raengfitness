import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { bookingByToken, CLASS_BOOK_PATH } from "@/lib/class-checkout";
import { publishedClasses } from "@/lib/class-sessions";
import { coachDb } from "@/lib/coach/db";
import { pageMetadata } from "@/lib/metadata";
import { Section } from "@/components/ui/Section";
import { CancelForm } from "./CancelForm";

export const metadata: Metadata = pageMetadata({
  title: "Your class booking",
  description: "See or cancel your RAENG Fitness class booking.",
  path: "/book/manage",
  noindex: true,
});

/**
 * Where the private link in the booking email lands: the class and, while it
 * can still be cancelled, a Cancel button (a POST: opening the link changes
 * nothing). No personal details are shown.
 */
export default async function BookManagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const db = coachDb();
  const booking = token && db ? await bookingByToken(db, token, publishedClasses()) : null;
  const heading = "mt-3 font-display text-h1 text-balance";
  return (
    <Section labelledBy="manage-heading">
      <div className="max-w-xl">
        <p className="eyebrow">{booking ? `Group class · ${booking.when}` : "Group class"}</p>
        {!booking ? (
          <>
            <h1 id="manage-heading" className={heading}>
              Link not valid.
            </h1>
            <p className="mt-5 text-lede">Try copying the whole link from your booking email, or message Alex.</p>
          </>
        ) : booking.status === "cancelled" ? (
          <>
            <h1 id="manage-heading" className={heading}>
              This booking is cancelled.
            </h1>
            <Link href={CLASS_BOOK_PATH} className="mt-6 inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:no-underline">
              Book a class
            </Link>
          </>
        ) : booking.classCancelled ? (
          <>
            <h1 id="manage-heading" className={heading}>
              This class is cancelled.
            </h1>
            <p className="mt-5 text-lede">Alex has cancelled this class and will be in touch about your place.</p>
          </>
        ) : booking.status === "confirmed" && booking.canCancel ? (
          <>
            <h1 id="manage-heading" className={heading}>
              You&apos;re booked.
            </h1>
            <CancelForm token={token} creditBack={booking.creditBack} refunded={booking.refunded} firstClassFree={booking.firstClassFree} inTime={booking.inTime} />
          </>
        ) : (
          <>
            <h1 id="manage-heading" className={heading}>
              {booking.status === "confirmed" ? "You're booked." : "This booking isn't active."}
            </h1>
            <p className="mt-5 text-lede">
              {booking.status === "confirmed" ? "The class has started, so it can no longer be cancelled." : "For help, message Alex."}
            </p>
          </>
        )}
      </div>
    </Section>
  );
}

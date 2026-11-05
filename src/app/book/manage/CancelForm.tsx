"use client";

import Link from "next/link";
import { useActionState } from "react";
import { cancelClassBooking, type CancelState } from "./actions";
import { buttonClasses } from "@/components/ui/ButtonLink";

const initial: CancelState = { status: "idle", creditLink: null, message: "" };

/**
 * Cancel, then (24 hours or more before) the refund for a paid class, or the
 * single-use credit link for a class paid with a credit (also emailed).
 */
export function CancelForm({ token, creditBack, refundBack = false, refunded, firstClassFree = false, inTime = false }: { token: string; creditBack: boolean; refundBack?: boolean; refunded: boolean; firstClassFree?: boolean; inTime?: boolean }) {
  const [state, action, pending] = useActionState(cancelClassBooking, initial);
  if (state.status === "cancelled") {
    return (
      <div role="status" className="mt-8">
        <p className="text-lede font-semibold">Your place is cancelled.</p>
        {state.firstClassFree ? (
          state.freeClassBack ? (
            <>
              <p className="mt-3">Your free first class is still yours. Book it for another date whenever you like.</p>
              <Link href="/book/group-class" className={buttonClasses("action", "mt-6 w-full px-6 sm:w-auto")}>
                Book your free class
              </Link>
            </>
          ) : (
            <p className="mt-3">It was less than 24 hours before the class, so your free first class has been used.</p>
          )
        ) : state.refundMessage ? (
          <p className="mt-3">{state.refundMessage}</p>
        ) : state.creditLink ? (
          <>
            <p className="mt-3">You have a credit for another class within 4 weeks. We&apos;ve emailed you this link too. It works once.</p>
            <Link href={state.creditLink} className={buttonClasses("action", "mt-6 w-full px-6 sm:w-auto")}>
              Book with your credit
            </Link>
          </>
        ) : state.refunded ? (
          <p className="mt-3">Your payment for this class was already refunded, so there&apos;s nothing more to refund.</p>
        ) : (
          <p className="mt-3">It was less than 24 hours before the class, so there&apos;s nothing back.</p>
        )}
      </div>
    );
  }
  return (
    <form action={action} className="mt-8">
      <input type="hidden" name="token" value={token} />
      <p>
        {firstClassFree
          ? inTime
            ? "This is your free first class. It's 24 hours or more before, so if you cancel now you can book it for another date."
            : "This is your free first class. It's less than 24 hours before, so cancelling now uses it."
          : refunded
          ? "Your payment for this class has already been refunded, so cancelling gives nothing more back."
          : refundBack
          ? "It's 24 hours or more before the class, so if you cancel now your payment is refunded in full."
          : creditBack
          ? "It's 24 hours or more before the class, so cancelling now gives you your class credit back, for another class within 4 weeks."
          : "It's less than 24 hours before the class, so cancelling now gives nothing back."}
      </p>
      {state.status === "error" ? (
        <p role="alert" className="mt-4 font-semibold">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={buttonClasses("action", "mt-6 w-full px-6 sm:w-auto")}>
        {pending ? "Cancelling…" : "Cancel my place"}
      </button>
    </form>
  );
}

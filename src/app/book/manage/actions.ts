"use server";

import { after } from "next/server";
import { cancelByToken } from "@/lib/class-checkout";
import { refundSentence } from "@/lib/class-refunds";
import { afterPlacesChange } from "@/lib/waitlist";
import { coachDb } from "@/lib/coach/db";

export interface CancelState {
  status: "idle" | "cancelled" | "error";
  creditLink: string | null;
  /** The payment had already been refunded, so nothing more was given back. */
  refunded?: boolean;
  /** It was their free first class: cancelled in time, it can be booked again; late, it's used. */
  firstClassFree?: boolean;
  freeClassBack?: boolean;
  /** Paid and cancelled 24 hours or more before: what happens to the refund. */
  refundMessage?: string;
  message: string;
}

/** Cancels a class booking by its private link (a POST, so an email scanner opening the link changes nothing). */
export async function cancelClassBooking(_previous: CancelState, formData: FormData): Promise<CancelState> {
  const token = formData.get("token");
  const db = coachDb();
  if (typeof token !== "string" || !db) return { status: "error", creditLink: null, message: "This booking can't be cancelled online. Please message Alex." };
  const result = await cancelByToken(db, token);
  if (result.ok) {
    // The place they gave up may be offered to the waitlist.
    after(() => afterPlacesChange(db));
    return { status: "cancelled", creditLink: result.creditLink, refunded: result.refunded, firstClassFree: result.firstClassFree, freeClassBack: result.freeClassBack, ...(result.refund ? { refundMessage: refundSentence(result.refund.outcome, result.refund.amountPence) } : {}), message: "" };
  }
  const message =
    result.reason === "class_started"
      ? "The class has already started, so it can't be cancelled."
      : result.reason === "failed"
        ? "Sorry, that didn't work. Please try again in a minute, or message Alex."
        : "This booking is no longer active.";
  return { status: "error", creditLink: null, message };
}

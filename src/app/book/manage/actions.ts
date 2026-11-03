"use server";

import { cancelByToken } from "@/lib/class-checkout";
import { coachDb } from "@/lib/coach/db";

export interface CancelState {
  status: "idle" | "cancelled" | "error";
  creditLink: string | null;
  /** The payment had already been refunded, so no credit was given. */
  refunded?: boolean;
  message: string;
}

/** Cancels a class booking by its private link (a POST, so an email scanner opening the link changes nothing). */
export async function cancelClassBooking(_previous: CancelState, formData: FormData): Promise<CancelState> {
  const token = formData.get("token");
  const db = coachDb();
  if (typeof token !== "string" || !db) return { status: "error", creditLink: null, message: "This booking can't be cancelled online. Please message Alex." };
  const result = await cancelByToken(db, token);
  if (result.ok) return { status: "cancelled", creditLink: result.creditLink, refunded: result.refunded, message: "" };
  const message =
    result.reason === "class_started"
      ? "The class has already started, so it can't be cancelled."
      : result.reason === "failed"
        ? "Sorry, that didn't work. Please try again in a minute, or message Alex."
        : "This booking is no longer active.";
  return { status: "error", creditLink: null, message };
}

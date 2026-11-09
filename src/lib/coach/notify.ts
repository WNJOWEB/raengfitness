import { arriveEarlyNote, groupClass } from "@/content/classes";
import { formatAddressLines } from "@/content/site";
import type { BookingRequest } from "./types";

/**
 * The message the coach sends after deciding a request. The site doesn't
 * email clients itself: Alex sends this from his own email (a prefilled
 * mailto: link) or copies it into a text or Instagram message, then marks the
 * request as told. So nothing ever tells someone they're booked before Alex
 * has confirmed it.
 */
export function decisionMessage(request: Pick<BookingRequest, "name" | "status" | "summary" | "service" | "decision_note">, booked?: string): { subject: string; body: string } {
  const first = request.name.trim().split(/\s+/)[0] || "there";
  const venue = formatAddressLines().join(", ");
  const greeting = `Hi ${first},`;
  if (request.status === "confirmed") {
    const content = [
      booked ? `You're booked in: ${booked}.` : `Your ${request.service.toLowerCase()} request is confirmed.`,
      booked ? `Where: ${venue}.` : "",
      booked && request.service.toLowerCase().includes("group") ? groupClass.payment : "",
      booked && request.service.toLowerCase().includes("group") ? arriveEarlyNote : "",
      request.decision_note,
    ].filter(Boolean);
    return { subject: `Booked: ${request.service}`, body: [greeting, "", ...content, "", "See you there."].join("\n") };
  }
  const content = [
    `Thanks for your ${request.service.toLowerCase()} request (${request.summary}). I'm sorry, I can't confirm it this time.`,
    request.decision_note,
  ].filter(Boolean);
  return { subject: `Your ${request.service.toLowerCase()} request`, body: [greeting, "", ...content, "", "Message me if another time would work."].join("\n") };
}

export function mailtoLink(email: string, message: { subject: string; body: string }): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
}

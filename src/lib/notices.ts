import { bookingDeliveryConfig } from "./booking-request";
import type { Env } from "./env";
import { sendEmail } from "./send-email";

/**
 * One place for the emails that follow something happening: a customer is told
 * what happened, and Alex (BOOKING_NOTIFY_EMAIL) is told the same, each with an
 * idempotency key so a retried event is emailed once. Best effort and silent on
 * failure for the person (the action itself has already succeeded); a failure
 * is logged with a label and a status code only, never a name or address.
 * Without email settings it does nothing.
 *
 * Wording is factual: it says what happened and never promises refunds, dates
 * or terms that aren't recorded in the site's content.
 */
export interface Notice {
  /** What happened, for logs only (e.g. "member-cancel"). */
  label: string;
  /** Unique for this event, e.g. `member-cancel/<attendance id>`. */
  key: string;
  /** The customer; omitted when only Alex needs telling. */
  customer?: { email: string; subject: string; text: string };
  /** Alex's copy; omitted when only the customer needs telling. */
  alex?: { subject: string; text: string; replyTo?: string };
}

export async function sendNotice(notice: Notice, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<{ customer: boolean | null; alex: boolean | null }> {
  const config = bookingDeliveryConfig(env);
  if (!config) return { customer: null, alex: null };
  const result: { customer: boolean | null; alex: boolean | null } = { customer: null, alex: null };
  // The two emails are independent, so they go together (a customer with no email on file simply isn't emailed:
  // the coach portal allows clients without one).
  const toCustomer = notice.customer?.email
    ? sendEmail(
        config,
        {
          idempotencyKey: `${notice.key}/customer`,
          to: notice.customer.email,
          replyTo: config.to,
          subject: notice.customer.subject.slice(0, 150),
          text: `${notice.customer.text}\n\nQuestions? Just reply to this email.`,
        },
        fetchImpl,
      ).catch(() => ({ ok: false as const, status: null }))
    : null;
  const toAlex = notice.alex
    ? sendEmail(
        config,
        {
          idempotencyKey: `${notice.key}/alex`,
          replyTo: notice.alex.replyTo ?? notice.customer?.email ?? config.to,
          subject: notice.alex.subject.slice(0, 150),
          text: notice.alex.text,
        },
        fetchImpl,
      ).catch(() => ({ ok: false as const, status: null }))
    : null;
  const [customerSent, alexSent] = await Promise.all([toCustomer, toAlex]);
  if (customerSent) {
    result.customer = customerSent.ok;
    if (!customerSent.ok) console.error(`Notice ${notice.label} to the customer failed (${customerSent.status ?? "network"})`);
  }
  if (alexSent) {
    result.alex = alexSent.ok;
    if (!alexSent.ok) console.error(`Notice ${notice.label} to Alex failed (${alexSent.status ?? "network"})`);
  }
  return result;
}

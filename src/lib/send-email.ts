import type { BookingDeliveryConfig } from "./booking-request";
import { renderEmailHtml, textFooter } from "./email-layout";

export interface OutgoingEmail {
  subject: string;
  text: string;
  replyTo: string;
  /** Someone other than Alex, e.g. a member's sign-in link. Defaults to BOOKING_NOTIFY_EMAIL. */
  to?: string;
  /** Same key for a retried identical request, so it is only sent once. */
  idempotencyKey: string;
  /** A one-time code (sign-in, email change), shown large in the HTML version. */
  code?: string;
}

export type SendResult = { ok: true } | { ok: false; status: number | null };

/**
 * Sends an email through Resend's REST API (POST /emails). Plain fetch: no
 * SDK dependency. Success only when the provider accepts the message.
 *
 * Every email goes as HTML (RAENG's layout: lib/email-layout.ts) with the
 * plain text alongside. Emails to anyone but Alex also get RAENG's sign-off
 * and contact details in the text version.
 */
export async function sendEmail(
  config: BookingDeliveryConfig,
  email: OutgoingEmail,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const toCustomer = Boolean(email.to) && email.to!.trim().toLowerCase() !== config.to.trim().toLowerCase();
  const text = toCustomer ? `${email.text}\n${textFooter()}` : email.text;
  const html = renderEmailHtml({ subject: email.subject, text: email.text, code: email.code, audience: toCustomer ? "customer" : "alex" });
  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [email.to ?? config.to],
        reply_to: email.replyTo,
        subject: email.subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true } : { ok: false, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

/** Deterministic key: identical resubmissions (double clicks, retries) dedupe. */
export async function idempotencyKey(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join("\u0000"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `booking-request/${hex}`;
}

/** Worth trying again: no answer, rate-limited, or a provider error. */
export function isRetryable(result: SendResult): boolean {
  return !result.ok && (result.status === null || result.status === 429 || result.status >= 500);
}

/**
 * One quick second attempt for a transient failure, with the same
 * idempotency key, so the provider sends the message at most once.
 */
export async function sendEmailWithRetry(
  config: BookingDeliveryConfig,
  email: OutgoingEmail,
  fetchImpl: typeof fetch = fetch,
  delayMs = 1000,
): Promise<SendResult> {
  const first = await sendEmail(config, email, fetchImpl);
  if (!isRetryable(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return sendEmail(config, email, fetchImpl);
}

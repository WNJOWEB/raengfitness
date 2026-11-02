import { bookingDeliveryConfig } from "./booking-request";
import { sendNotice } from "./notices";
import { alertError, recordAlert } from "./request-alerts";
import { requestStoreConfig, saveRequest, type StoredRequest } from "./request-store";
import { sendEmailWithRetry, type OutgoingEmail } from "./send-email";

/**
 * Gets a request to Alex by every configured route: stored in Supabase (shown
 * in the coach area) and/or emailed via Resend. Succeeds when at least one
 * route accepted it, so the visitor is never told it was sent when it wasn't.
 * The two routes are independent: a failed email never stops the request
 * being stored, and vice versa. Once both have answered, the email's outcome
 * is recorded on the stored request so a failed alert is retried
 * (src/lib/request-alerts.ts). Logs contain no personal data.
 */
export async function deliverRequest(stored: StoredRequest, email: Omit<OutgoingEmail, "idempotencyKey">): Promise<boolean> {
  const store = requestStoreConfig();
  const mail = bookingDeliveryConfig();
  const [saved, sent] = await Promise.all([
    store ? saveRequest(store, stored) : Promise.resolve(null),
    mail ? sendEmailWithRetry(mail, { ...email, idempotencyKey: stored.idempotencyKey }) : Promise.resolve(null),
  ]);
  if (saved === false) console.error(`Storing a request (${stored.kind}) failed`);
  if (sent && !sent.ok) console.error(`Emailing a request (${stored.kind}) failed: ${alertError(sent)}`);
  if (store && saved && sent) {
    const recorded = await recordAlert(store, stored.idempotencyKey, email, sent);
    if (!recorded) console.error(`Recording a request alert (${stored.kind}) failed`);
  }
  const delivered = saved === true || sent?.ok === true;
  // Acknowledge to the person once it has reached Alex, so they know it was received and that it isn't confirmed yet.
  // Best effort; the same key as the request, so a resubmitted form acknowledges once.
  if (delivered) {
    await sendNotice({
      label: "request-received",
      key: `request-received/${stored.idempotencyKey}`,
      customer: {
        email: stored.email,
        subject: `We've received your request: ${stored.service}`.slice(0, 150),
        text: [
          `Thanks, ${stored.name}. We've received your ${stored.service.toLowerCase()} request${stored.summary ? ` (${stored.summary})` : ""}.`,
          "",
          "This is a request, not a confirmed booking. Alex will reply to confirm.",
        ].join("\n"),
      },
    });
  }
  return delivered;
}

import { BILLING_WEEKS } from "@/content/memberships";
import { rpc, select, type Db } from "../coach/db";
import { formatPenceShort } from "../membership";
import { createCustomer } from "./api";
import type { StripeConfig } from "./config";

/**
 * A member's Stripe customer: made once (the idempotency key names the client),
 * remembered in akb_stripe_customers. A saved card or Direct Debit hangs off it.
 */
export async function ensureStripeCustomer(
  db: Db,
  stripe: StripeConfig,
  member: { clientId: string; email: string; name: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; customerId: string; dd: "pending" | "active" | "ended" } | { ok: false }> {
  const existing = await select<{ customer_id: string; dd_status: "pending" | "active" | "ended" }>(db, "akb_stripe_customers", [["select", "customer_id,dd_status"], ["client_id", `eq.${member.clientId}`]]);
  if (!existing.ok) return { ok: false };
  const row = existing.data[0];
  if (row) return { ok: true, customerId: row.customer_id, dd: row.dd_status };
  const made = await createCustomer(stripe, { idempotencyKey: `dd-customer-${member.clientId}`, email: member.email, name: member.name, clientId: member.clientId }, fetchImpl);
  if (!made.ok) {
    console.error(`Stripe: creating a customer failed (${made.status ?? "network"})`);
    return { ok: false };
  }
  const saved = await rpc<null>(db, "akb_dd_begin", { p_client: member.clientId, p_environment: stripe.environment, p_customer: made.data.id });
  return saved.ok ? { ok: true, customerId: made.data.id, dd: "pending" } : { ok: false };
}

/**
 * The line shown beside the pay button on Stripe's page when a membership
 * payment also saves the card for the renewals. It is the member's agreement
 * to be charged again, so it states the amount, the rhythm and how to stop.
 */
export function renewalConsent(pricePence: number, directDebit = false): string {
  return `Your membership renews every ${BILLING_WEEKS} weeks until you cancel. By paying, you agree that ${formatPenceShort(pricePence)} will be charged to this card every ${BILLING_WEEKS} weeks${directDebit ? ", unless you set up a Direct Debit instead" : ""}. We email you 5 days before each card payment. Cancel any time from your account.`;
}

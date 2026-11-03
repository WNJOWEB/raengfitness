import { rpc, type Db, type DbResult } from "./coach/db";

/**
 * The member's own payments and receipts (owner, 2026-11-03; migration
 * 20261116000000). Received payments only; refunds shown against each. Server
 * only: the database answers only for the signed-in member's client id.
 */

export const PAYMENTS_PATH = "/account/payments";

export interface MemberPayment {
  id: string;
  paid_on: string;
  amount_pence: number;
  method: "cash" | "bank_transfer" | "card" | "other";
  provider: string;
  description: string;
  refunded_pence: number;
}

export interface MemberReceipt extends MemberPayment {
  refunds: { amount_pence: number; refunded_on: string }[];
}

export const memberPayments = (db: Db, clientId: string): Promise<DbResult<MemberPayment[]>> => rpc<MemberPayment[]>(db, "akb_member_payments", { p_client: clientId });

export const memberReceipt = (db: Db, clientId: string, paymentId: string): Promise<DbResult<MemberReceipt | null>> =>
  rpc<MemberReceipt | null>(db, "akb_member_receipt", { p_client: clientId, p_payment: paymentId });

/** How it was paid, in a few words. Card and Direct Debit payments taken by Stripe both read "Through Stripe". */
export function paidBy(p: Pick<MemberPayment, "method" | "provider">): string {
  if (p.provider.startsWith("stripe")) return "Through Stripe";
  if (p.method === "cash") return "Cash";
  if (p.method === "bank_transfer") return "Bank transfer";
  if (p.method === "card") return "Card";
  return "Other";
}

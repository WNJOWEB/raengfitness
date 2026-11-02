import { BILLING_WEEKS } from "@/content/memberships";
import { select, type Db } from "../coach/db";
import { formatDate, type DateKey } from "../coach/time";
import type { Env } from "../env";
import { ACCOUNT_PATH, memberLinkOrigin } from "../member-auth";
import { formatPenceShort } from "../membership";
import { sendNotice } from "../notices";

/**
 * The email that follows a Direct Debit being confirmed by Stripe (owner,
 * 2026-11-02): what will be collected and roughly when, the Direct Debit
 * Guarantee, and how to stop it. Once per set-up (the key names Stripe's
 * set-up id, so a repeated webhook sends nothing more). Best effort: without
 * email settings it does nothing, and a failure is only logged. Alex gets a
 * short note too. Wording says only what the site does: it promises no refund.
 */
export async function notifyDirectDebitSetUp(db: Db, clientId: string, setupId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const people = await select<{ email: string; full_name: string }>(db, "akb_clients", [["select", "email,full_name"], ["id", `eq.${clientId}`]]);
  const person = people.ok ? people.data[0] : undefined;
  if (!person) return;
  const memberships = await select<{ plan_name: string; price_pence: number; next_period_on: string; status: string }>(db, "akb_memberships", [
    ["select", "plan_name,price_pence,next_period_on,status"],
    ["client_id", `eq.${clientId}`],
    ["status", "in.(active,paused)"],
    ["order", "created_at.desc"],
    ["limit", "1"],
  ]);
  const m = memberships.ok ? memberships.data[0] : undefined;
  const what = m ? `${formatPenceShort(m.price_pence)} every ${BILLING_WEEKS} weeks for your ${m.plan_name} membership` : `your membership payments every ${BILLING_WEEKS} weeks`;
  const next = m?.status === "active" && m.next_period_on ? ` Your next payment is collected a few days before ${formatDate(m.next_period_on as DateKey)}.` : "";
  await sendNotice(
    {
      label: "direct-debit-set-up",
      key: `dd-set-up/${setupId}`,
      customer: person.email
        ? {
            email: person.email,
            subject: "Your RAENG Direct Debit is set up",
            text: [
              `Your Direct Debit is set up. ${what.charAt(0).toUpperCase()}${what.slice(1)} will be collected from your bank account, a few days before each new period starts.${next}`,
              "",
              "Stripe collects it on behalf of RAENG Fitness. Your Direct Debit is protected by the Direct Debit Guarantee.",
              "",
              `To stop it, cancel your membership from your account: ${memberLinkOrigin(env)}${ACCOUNT_PATH}/plan. You keep the credits you've already paid for until the end of the period. Cancel before a payment is collected to stop that one.`,
            ].join("\n"),
          }
        : undefined,
      alex: { subject: `Direct Debit set up: ${person.full_name}`, text: `${person.full_name}${person.email ? ` (${person.email})` : ""} set up a Direct Debit${m ? ` for their ${m.plan_name} membership (${formatPenceShort(m.price_pence)} every ${BILLING_WEEKS} weeks)` : ""}.`, replyTo: person.email || undefined },
    },
    env,
    fetchImpl,
  ).catch(() => null);
}

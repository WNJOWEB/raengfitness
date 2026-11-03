import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/metadata";
import { AccountUnavailable } from "@/components/members/Cards";
import { MembersShell } from "@/components/members/MembersShell";
import { SettingsHeading } from "@/components/members/Settings";
import { formatLongDate, type DateKey } from "@/lib/availability/dates";
import { formatPence } from "@/lib/coach/money";
import { memberPayments, PAYMENTS_PATH } from "@/lib/member-payments";
import { loadMembers } from "../data";

export const metadata: Metadata = pageMetadata({
  title: "Payments and receipts",
  description: "Your RAENG payments, refunds and receipts.",
  path: "/account/payments",
  noindex: true,
});

/**
 * Payments and receipts (account menu; owner, 2026-11-03): every payment the
 * member has made, newest first, what it was for and any refund, each with a
 * receipt to view, print or save.
 */
export default async function AccountPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const rows = await memberPayments(d.member.db, d.member.clientId);
  const list = rows.ok ? rows.data : [];

  return (
    <MembersShell view={null} overview={d.overview.data} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={null}>
      <SettingsHeading eyebrow="Account" title="Payments and receipts.">
        Everything you&apos;ve paid us, newest first. Open one for its receipt.
      </SettingsHeading>

      {!rows.ok ? (
        <p className="font-semibold">Your payments can&apos;t be shown just now. Please try again in a minute.</p>
      ) : list.length === 0 ? (
        <p>No payments yet.</p>
      ) : (
        <ul className="border-t border-line" aria-label="Your payments">
          {list.map((p) => (
            <li key={p.id} className="border-b border-line">
              <Link href={`${PAYMENTS_PATH}/${p.id}`} className="flex min-h-11 items-center justify-between gap-4 py-3.5">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold [overflow-wrap:anywhere]">{p.description}</span>
                  <span className="text-sm text-ink">
                    {formatLongDate(p.paid_on as DateKey)}
                    {p.refunded_pence > 0 ? ` · ${p.refunded_pence >= p.amount_pence ? "Refunded" : `${formatPence(p.refunded_pence)} refunded`}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className={`font-semibold tabular-nums ${p.refunded_pence >= p.amount_pence ? "line-through" : ""}`}>{formatPence(p.amount_pence)}</span>
                  <span className="text-sm underline underline-offset-4">Receipt</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">Something not right? Reply to any of our emails, or message Alex.</p>
    </MembersShell>
  );
}

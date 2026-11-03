import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { site, formatAddressLines } from "@/content/site";
import { pageMetadata } from "@/lib/metadata";
import { AccountUnavailable } from "@/components/members/Cards";
import { MembersShell } from "@/components/members/MembersShell";
import { formatLongDate, type DateKey } from "@/lib/availability/dates";
import { isUuid } from "@/lib/coach/db";
import { formatPence } from "@/lib/coach/money";
import { memberReceipt, paidBy, PAYMENTS_PATH } from "@/lib/member-payments";
import { referenceFor } from "@/lib/reference";
import { loadMembers } from "../../data";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = pageMetadata({
  title: "Receipt",
  description: "A receipt for a payment to RAENG.",
  path: "/account/payments",
  noindex: true,
});

/**
 * One payment's receipt (owner, 2026-11-03): who was paid, when, for what, how
 * and any refund. Only the signed-in member's own payments (the database
 * checks); anything else is not found. Prints on its own (globals.css).
 */
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const found = await memberReceipt(d.member.db, d.member.clientId, id);
  if (!found.ok) return <AccountUnavailable />;
  const r = found.data;
  if (!r) notFound();
  const refunded = r.refunds.reduce((sum, f) => sum + f.amount_pence, 0);
  const o = d.overview.data;

  return (
    <MembersShell view={null} overview={o} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={null}>
      <Link href={PAYMENTS_PATH} className="members-link inline-flex min-h-11 items-center self-start print:hidden">
        Back to payments
      </Link>
      <article aria-labelledby="receipt-heading" className="print-receipt flex flex-col gap-4 rounded-3xl bg-white p-5.5">
        <div className="flex flex-col gap-1">
          <p className="members-eyebrow">Receipt</p>
          <h1 id="receipt-heading" className="text-[1.75rem] font-extrabold tracking-[-0.03em]">
            {formatPence(r.amount_pence)} paid
          </h1>
          <p className="text-ink">{`${formatLongDate(r.paid_on as DateKey)} ${r.paid_on.slice(0, 4)}`}</p>
        </div>
        <dl className="border-t border-line">
          {(
            [
              ["For", r.description],
              ["Paid by", paidBy(r)],
              ["Paid to", `${site.name}, ${formatAddressLines().join(", ")}`],
              ["Customer", `${o.client.name}${o.client.email ? `, ${o.client.email}` : ""}`],
              ["Reference", referenceFor(r.id)],
              ...r.refunds.map((f) => [`Refunded ${formatLongDate(f.refunded_on as DateKey)} ${f.refunded_on.slice(0, 4)}`, formatPence(f.amount_pence)] as const),
              ...(refunded > 0 ? ([["Paid after refunds", formatPence(r.amount_pence - refunded)]] as const) : []),
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line py-3">
              <dt className="text-ink">{k}</dt>
              <dd className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-ink">Prices are in pounds sterling (GBP).</p>
      </article>
      <PrintButton />
    </MembersShell>
  );
}

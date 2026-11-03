import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { portalContext } from "@/lib/coach/context";
import { loadMessage } from "@/lib/coach/errors";
import { loadFinances } from "@/lib/coach/finances";
import { PAYMENT_METHOD, PAYMENT_STATUS, SERVICE } from "@/lib/coach/labels";
import { SERVICE_KEYS } from "@/lib/coach/ledger";
import { formatPence } from "@/lib/coach/money";
import { periodRange, SERVICES } from "@/lib/coach/revenue";
import { formatDate } from "@/lib/coach/time";
import type { ServiceKey } from "@/lib/coach/types";
import { RevenueChart } from "@/components/coach/RevenueChart";
import { ActionLink, Badge, EmptyState, LoadError, Metric, PageHeader, Panel, SearchBar, SearchInput, SearchSelect, TextLink } from "@/components/coach/ui";

export const metadata: Metadata = { title: "Finances" };

export default function FinancesPage({ searchParams }: PageProps<"/coach/finances">) {
  return (
    <>
      <PageHeader title="Finances" eyebrow="Money received, owed and expected">
        <ActionLink href="/coach/finances/payments/new" variant="primary">
          Record a payment
        </ActionLink>
      </PageHeader>
      <Suspense fallback={<CoachLoading />}>
        <Finances searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Finances({ searchParams }: { searchParams: PageProps<"/coach/finances">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const range = periodRange(str(params.period), today, str(params.from), str(params.to));
  const service = (SERVICE_KEYS as readonly string[]).includes(str(params.service) ?? "") ? (params.service as ServiceKey) : undefined;
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const result = await loadFinances(db, range, today, service);
  if (!result.ok) return <LoadError message={loadMessage(result.error)} />;
  const d = result.data;
  const name = (id: string) => d.clients.find((c) => c.id === id)?.full_name ?? "Client";
  const exportQuery = new URLSearchParams({ from: range.from, to: range.to, ...(service ? { service } : {}) }).toString();

  return (
    <>
      <nav aria-label="Period" className="mt-6 flex gap-2 overflow-x-auto p-1 [scrollbar-width:none]">
        {(
          [
            ["week", "This week"],
            ["month", "This month"],
            ["last-month", "Last month"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={`/coach/finances?period=${value}${service ? `&service=${service}` : ""}`}
            aria-current={range.period === value ? "page" : undefined}
            className={`inline-flex min-h-11 flex-none items-center rounded-full border-[1.5px] px-4 text-sm font-semibold whitespace-nowrap ${range.period === value ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <details className="mt-2" open={range.period === "custom" || Boolean(service)}>
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">Custom dates or one service</summary>
        <SearchBar action="/coach/finances" label="Period and service">
          <SearchSelect
            name="period"
            label="Period"
            defaultValue={range.period}
            options={[
              { value: "week", label: "This week" },
              { value: "month", label: "This month" },
              { value: "last-month", label: "Last month" },
              { value: "custom", label: "Custom dates" },
            ]}
          />
          <SearchInput name="from" label="From (custom)" type="date" defaultValue={range.period === "custom" ? range.from : ""} />
          <SearchInput name="to" label="To (custom)" type="date" defaultValue={range.period === "custom" ? range.to : ""} />
          <SearchSelect name="service" label="Service" defaultValue={service ?? ""} options={[{ value: "", label: "All services" }, ...SERVICE_KEYS.map((s) => ({ value: s, label: SERVICE[s] }))]} />
        </SearchBar>
      </details>

      <p className="mt-4 text-sm" role="status">
        <strong>{range.label}</strong>: {formatDate(range.from)} to {formatDate(range.to)}
        {service ? `, ${SERVICE[service]} only` : ""}.
      </p>

      <ul className="mt-4 grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-3">
        <li>
          <Metric emphasis label="Payments received" value={formatPence(d.totals.total.net)} note={`${formatPence(d.totals.total.received)} received − ${formatPence(d.totals.total.refunds)} refunded`} />
        </li>
        <li>
          <Metric label="Refunds" value={formatPence(d.totals.total.refunds)} note="Paid back in this period" />
        </li>
        <li>
          <Metric label="Outstanding now" value={formatPence(d.outstanding.due)} note={`Owed and due today or earlier. ${formatPence(d.outstanding.later)} more due later.`} href="#outstanding" />
        </li>
        <li>
          <Metric label="Expected recurring" value={`${formatPence(d.expectedMonthly)}/month`} note="Active online coaching plans. A forecast, not received." />
        </li>
        <li>
          <Metric label="Packages sold" value={formatPence(d.packages.sold)} note={`${d.packages.count} sold · ${formatPence(d.packages.collected)} collected so far · ${d.packages.sessionsDelivered} of ${d.packages.sessionsSold} sessions delivered`} />
        </li>
        <li>
          <Metric label="Payments" value={d.payments.filter((p) => p.status === "received").length} note={`${d.payments.filter((p) => p.status === "failed").length} failed in this period`} />
        </li>
      </ul>

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
        <Panel title="Revenue by service" id="by-service-heading">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <caption className="sr-only">Payments received in the period, by service</caption>
              <thead>
                <tr className="border-b border-ink text-left">
                  <th scope="col" className="py-2 pr-3">Service</th>
                  <th scope="col" className="py-2 pr-3 text-right">Received</th>
                  <th scope="col" className="py-2 pr-3 text-right">Refunds</th>
                  <th scope="col" className="py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {SERVICES.filter((s) => !service || s === service).map((s) => (
                  <tr key={s} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      {SERVICE[s]}
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPence(d.totals.byService[s].received)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPence(d.totals.byService[s].refunds)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{formatPence(d.totals.byService[s].net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">Cash basis: a payment counts on the date it was received, under the service it was recorded for. Unpaid charges and expected subscription income are never included.</p>
        </Panel>
        <Panel title="Last 12 months" id="chart-heading">
          <RevenueChart id="finances-revenue" months={d.months} />
        </Panel>
      </div>

      <Panel
        title="Payments in this period"
        id="payments-heading"
        actions={
          <a href={`/coach/finances/export?${exportQuery}`} className="font-semibold underline underline-offset-4" download>
            Download CSV
          </a>
        }
      >
        {d.payments.length === 0 && d.refunds.length === 0 ? (
          <EmptyState title="No payments in this period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Payments and refunds in the period</caption>
              <thead>
                <tr className="border-b border-ink text-left">
                  <th scope="col" className="py-2 pr-3">Date</th>
                  <th scope="col" className="py-2 pr-3">Client</th>
                  <th scope="col" className="py-2 pr-3">For</th>
                  <th scope="col" className="py-2 pr-3">Method</th>
                  <th scope="col" className="py-2 pr-3">Status</th>
                  <th scope="col" className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id} className="border-b border-line">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <Link href={`/coach/finances/payments/${p.id}`} className="underline underline-offset-4">
                        {formatDate(p.paid_on)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{name(p.client_id)}</td>
                    <td className="py-2 pr-3">{SERVICE[p.service]}</td>
                    <td className="py-2 pr-3">{PAYMENT_METHOD[p.method]}</td>
                    <td className="py-2 pr-3">{p.status === "received" ? (p.refunded_pence ? `Received, ${formatPence(p.refunded_pence)} refunded` : "Received") : <Badge tone="strong">{PAYMENT_STATUS[p.status]}</Badge>}</td>
                    <td className="py-2 text-right tabular-nums">{p.status === "received" ? formatPence(p.amount_pence) : <s>{formatPence(p.amount_pence)}</s>}</td>
                  </tr>
                ))}
                {d.refunds.map((r) => {
                  const p = d.allPayments.find((x) => x.id === r.payment_id);
                  return (
                    <tr key={r.id} className="border-b border-line">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Link href={`/coach/finances/payments/${r.payment_id}`} className="underline underline-offset-4">
                          {formatDate(r.refunded_on)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{p ? name(p.client_id) : ""}</td>
                      <td className="py-2 pr-3">{p ? SERVICE[p.service] : ""}</td>
                      <td className="py-2 pr-3">Refund</td>
                      <td className="py-2 pr-3">Refunded</td>
                      <td className="py-2 text-right tabular-nums">{formatPence(-r.amount_pence)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Outstanding" id="outstanding">
        {d.dueCharges.length === 0 ? (
          <EmptyState title="Nothing is owed right now." />
        ) : (
          <ul className="divide-y divide-line border-y border-line text-sm">
            {d.dueCharges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <TextLink href={`/coach/clients/${c.client_id}?tab=payments`}>{name(c.client_id)}</TextLink> · {c.description}
                  <span className="block text-muted">
                    Due {formatDate(c.due_on)}
                    {c.due_on < today ? " (overdue)" : ""}
                    {c.paid_pence ? ` · ${formatPence(c.paid_pence)} paid of ${formatPence(c.amount_pence)}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <strong className="tabular-nums">{formatPence(c.outstanding_pence)}</strong>
                  <TextLink href={`/coach/finances/payments/new?client=${c.client_id}&charge=${c.id}`}>Record payment</TextLink>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

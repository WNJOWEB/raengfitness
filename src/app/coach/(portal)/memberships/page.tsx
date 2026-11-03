import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import { after } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { BILLING_WEEKS } from "@/content/memberships";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { MEMBERSHIP_STATUS } from "@/lib/coach/labels";
import { catchUpRenewals, creditsLine, listMemberships, listPeriods, MEMBERSHIP_STATUSES, type MembershipStatus } from "@/lib/coach/memberships";
import { formatPence } from "@/lib/coach/money";
import { addDays, formatDate } from "@/lib/coach/time";
import { ActionLink, Badge, EmptyState, FilterLinks, LoadError, Metric, PageHeader } from "@/components/coach/ui";

export const metadata: Metadata = { title: "Memberships" };

export default function MembershipsPage({ searchParams }: PageProps<"/coach/memberships">) {
  return (
    <>
      <PageHeader title="Memberships" eyebrow="Plans, credits and renewals">
        <ActionLink href="/coach/memberships/new" variant="primary">
          Start a membership
        </ActionLink>
      </PageHeader>
      <Suspense fallback={<CoachLoading />}>
        <Memberships searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Memberships({ searchParams }: { searchParams: PageProps<"/coach/memberships">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const status = (MEMBERSHIP_STATUSES as readonly string[]).includes(String(params.status)) ? (params.status as MembershipStatus) : "active";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  // The daily job makes renewals; this is only the safety net, so it runs after the page is sent instead of making every view wait for a database write.
  after(() => catchUpRenewals(db, today));
  const loaded = collect(await Promise.all([listMemberships(db), listClients(db)] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [all, clients] = loaded.data;
  const shown = all.filter((m) => m.status === status);
  const periods = await listPeriods(db, shown.map((m) => m.id));
  if (!periods.ok) return <LoadError message={loadMessage(periods.error)} />;
  const name = (id: string) => clients.find((c) => c.id === id)?.full_name ?? "Client";
  const current = (id: string) => periods.data.find((p) => p.membership_id === id && p.period_start <= today && p.period_end >= today);
  const active = all.filter((m) => m.status === "active");

  return (
    <>
      <ul className="mt-6 grid grid-cols-1 gap-3 xs:grid-cols-3">
        <li>
          <Metric label="Active members" value={active.length} />
        </li>
        <li>
          <Metric label={`Expected every ${BILLING_WEEKS} weeks`} value={formatPence(active.reduce((sum, m) => sum + m.price_pence, 0))} note="From active memberships, not money received" />
        </li>
        <li>
          <Metric label="Renewing in the next 7 days" value={active.filter((m) => m.next_period_on <= addDays(today, 7)).length} />
        </li>
      </ul>
      <div className="mt-8">
        <FilterLinks
          label="Membership status"
          current={status}
          items={MEMBERSHIP_STATUSES.map((s) => ({ value: s, label: MEMBERSHIP_STATUS[s], href: `/coach/memberships?status=${s}`, count: all.filter((m) => m.status === s).length }))}
        />
      </div>
      {shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={`No ${MEMBERSHIP_STATUS[status].toLowerCase()} memberships.`}>
            Start one with “Start a membership”, or from a booking request where the visitor chose a plan.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {shown.map((m) => {
            const p = current(m.id);
            return (
              <li key={m.id}>
                <Link href={`/coach/memberships/${m.id}`} className="grid min-h-11 grid-cols-1 gap-1 py-3 hover:bg-white md:grid-cols-[2fr_2fr_1fr] md:items-center md:gap-4">
                  <span>
                    <span className="font-semibold">{name(m.client_id)}</span>
                    <span className="block text-sm text-muted">
                      {m.plan_name} · {formatPence(m.price_pence)} every {BILLING_WEEKS} weeks · {m.credits} credits
                    </span>
                  </span>
                  <span className="text-sm">
                    {p ? `${creditsLine(p)} until ${formatDate(p.period_end)}` : "No current period"}
                    {m.status === "active" ? <span className="block text-muted">Renews {formatDate(m.next_period_on)}</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-2 text-sm md:justify-end">
                    {p && p.credits_left === 0 ? <Badge tone="strong">No credits left</Badge> : null}
                    {m.status !== "active" ? <Badge tone="muted">{MEMBERSHIP_STATUS[m.status]}</Badge> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}


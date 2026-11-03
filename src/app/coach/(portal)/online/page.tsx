import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { SUBSCRIPTION_STATUS } from "@/lib/coach/labels";
import { formatPence } from "@/lib/coach/money";
import { coachingUnread, listCheckIns, listSubscriptions, SUBSCRIPTION_STATUSES } from "@/lib/coach/online";
import { expectedMonthly } from "@/lib/coach/revenue";
import { formatDate } from "@/lib/coach/time";
import type { SubscriptionStatus } from "@/lib/coach/types";
import { ActionLink, Badge, EmptyState, FilterLinks, LoadError, Metric, PageHeader } from "@/components/coach/ui";

export const metadata: Metadata = { title: "Online coaching" };

export default function OnlinePage({ searchParams }: PageProps<"/coach/online">) {
  return (
    <>
      <PageHeader title="Online coaching" eyebrow="Plans, check-ins and renewals">
        <ActionLink href="/coach/online/new" variant="primary">
          Set up a client
        </ActionLink>
      </PageHeader>
      <Suspense fallback={<CoachLoading />}>
        <Online searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Online({ searchParams }: { searchParams: PageProps<"/coach/online">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(String(params.status)) ? (params.status as SubscriptionStatus) : "active";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const loaded = collect(await Promise.all([listSubscriptions(db), listClients(db)] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [all, clients] = loaded.data;
  const shown = all.filter((s) => s.status === status).sort((a, b) => (a.next_check_in_on ?? "9999").localeCompare(b.next_check_in_on ?? "9999"));
  const checkIns = shown.length ? await listCheckIns(db, { subscriptionIds: shown.map((s) => s.id) }) : { ok: true as const, data: [] };
  if (!checkIns.ok) return <LoadError message={loadMessage(checkIns.error)} />;
  // Messages from clients in their coaching area, not yet read (a failure here only hides the badge).
  const unreadResult = await coachingUnread(db);
  const unread = unreadResult.ok ? unreadResult.data : {};
  const name = (id: string) => clients.find((c) => c.id === id)?.full_name ?? "Client";
  const active = all.filter((s) => s.status === "active");
  const dueCheckIns = active.filter((s) => s.next_check_in_on && s.next_check_in_on <= today).length;

  return (
    <>
      <ul className="mt-6 grid grid-cols-1 gap-3 xs:grid-cols-3">
        <li>
          <Metric label="Active clients" value={active.length} />
        </li>
        <li>
          <Metric label="Expected per month" value={formatPence(expectedMonthly(all, today))} note="Forecast from active plans, not money received" />
        </li>
        <li>
          <Metric emphasis={dueCheckIns > 0} label="Check-ins due" value={dueCheckIns} note="Today or overdue" />
        </li>
      </ul>
      <div className="mt-8">
        <FilterLinks
          label="Plan status"
          current={status}
          items={SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: SUBSCRIPTION_STATUS[s], href: `/coach/online?status=${s}`, count: all.filter((x) => x.status === s).length }))}
        />
      </div>
      {shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={`No ${SUBSCRIPTION_STATUS[status].toLowerCase()} plans.`}>Set up a client&apos;s online coaching from their record or with “Set up a client”.</EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {shown.map((s) => {
            const latest = checkIns.data.find((c) => c.subscription_id === s.id);
            const due = s.next_check_in_on && s.next_check_in_on <= today;
            return (
              <li key={s.id}>
                <Link href={`/coach/online/${s.id}`} className="grid min-h-11 grid-cols-1 gap-1 py-3 hover:bg-white md:grid-cols-[2fr_2fr_1fr] md:items-center md:gap-4">
                  <span>
                    <span className="font-semibold">{name(s.client_id)}</span>
                    <span className="block text-sm text-muted">
                      {s.plan} · {formatPence(s.price_pence)}/month
                    </span>
                  </span>
                  <span className="text-sm">
                    {s.next_check_in_on ? `Next check-in ${formatDate(s.next_check_in_on)}` : "No check-in scheduled"}
                    <span className="block text-muted">{latest ? `Last: ${formatDate(latest.checked_in_on)}` : "No check-ins yet"}</span>
                  </span>
                  <span className="flex flex-wrap gap-2 text-sm md:justify-end">
                    {unread[s.id] ? <Badge tone="strong">{unread[s.id]} new message{unread[s.id] === 1 ? "" : "s"}</Badge> : null}
                    {due ? <Badge tone="strong">Check-in due</Badge> : null}
                    {s.renews_on ? <span className="text-muted">Renews {formatDate(s.renews_on)}</span> : null}
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

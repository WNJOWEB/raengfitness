import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { listPtSessions } from "@/lib/coach/bookings";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { loadMessage } from "@/lib/coach/errors";
import { PT_STATUS } from "@/lib/coach/labels";
import { formatPence } from "@/lib/coach/money";
import { addDays, addMonths, endOfMonth, formatClock, formatDate, formatMonth, londonToUtc, minutesBetween, toLondon, weekday } from "@/lib/coach/time";
import type { PtSession } from "@/lib/coach/types";
import { ActionLink, Badge, EmptyState, FilterLinks, LoadError, PageHeader, Panel, TextLink } from "@/components/coach/ui";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "PT sessions" };

const VIEWS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "cancelled", label: "Cancelled" },
] as const;
type View = (typeof VIEWS)[number]["value"];

export default function SessionsPage({ searchParams }: PageProps<"/coach/sessions">) {
  return (
    <>
      <PageHeader title="PT sessions" eyebrow="One-to-one">
        <ActionLink href="/coach/sessions/new" variant="primary">
          Book a session
        </ActionLink>
      </PageHeader>
      <Suspense fallback={<CoachLoading />}>
        <Sessions searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Sessions({ searchParams }: { searchParams: PageProps<"/coach/sessions">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const view: View = VIEWS.some((v) => v.value === params.view) ? (params.view as View) : "upcoming";
  const month = typeof params.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : today.slice(0, 7);
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const nowIso = new Date().toISOString();
  const listQuery =
    view === "upcoming"
      ? listPtSessions(db, { from: nowIso, status: ["scheduled"], limit: 200 })
      : view === "past"
        ? listPtSessions(db, { to: nowIso, status: ["scheduled", "attended", "no_show"], order: "desc", limit: 200 })
        : listPtSessions(db, { status: ["cancelled"], order: "desc", limit: 200 });
  const monthStart = `${month}-01`;
  const [list, monthSessions, clients] = await Promise.all([
    listQuery,
    listPtSessions(db, { from: londonToUtc(monthStart, "00:00"), to: londonToUtc(addDays(endOfMonth(monthStart), 1), "00:00"), status: ["scheduled", "attended", "no_show"] }),
    listClients(db),
  ]);
  if (!list.ok) return <LoadError message={loadMessage(list.error)} />;
  if (!monthSessions.ok) return <LoadError message={loadMessage(monthSessions.error)} />;
  if (!clients.ok) return <LoadError message={loadMessage(clients.error)} />;
  const name = (id: string) => clients.data.find((c) => c.id === id)?.full_name ?? "Client";

  // Group the list by UK date.
  const byDay = new Map<string, PtSession[]>();
  for (const s of list.data) {
    const day = toLondon(s.starts_at).date;
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  const cells: (string | null)[] = Array.from({ length: weekday(monthStart) }, () => null);
  for (let d = monthStart; d <= endOfMonth(monthStart); d = addDays(d, 1)) cells.push(d);
  const countOn = (date: string) => monthSessions.data.filter((s) => toLondon(s.starts_at).date === date).length;

  return (
    <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="mt-8">
          <FilterLinks label="Sessions" current={view} items={VIEWS.map((v) => ({ value: v.value, label: v.label, href: `/coach/sessions?view=${v.value}&month=${month}` }))} />
        </div>
        {list.data.length === 0 ? (
          <div className="mt-4">
            <EmptyState title={view === "upcoming" ? "No upcoming sessions." : view === "past" ? "No past sessions." : "No cancelled sessions."}>Book one with “Book a session”, or confirm a one-to-one request.</EmptyState>
          </div>
        ) : (
          [...byDay.entries()].map(([day, sessions]) => (
            <section key={day} aria-label={formatDate(day)} className="mt-6">
              <h2 className="text-sm font-bold">{formatDate(day)}</h2>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/coach/sessions/${s.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-3 hover:bg-white">
                      <span>
                        <span className="font-semibold tabular-nums">
                          {formatClock(toLondon(s.starts_at).time)}–{formatClock(toLondon(s.ends_at).time)}
                        </span>{" "}
                        {name(s.client_id)}
                        <span className="block text-sm text-muted">
                          {minutesBetween(s.starts_at, s.ends_at)} min · {s.package_id ? "Package" : s.price_pence !== null ? formatPence(s.price_pence) : "No price"}
                        </span>
                      </span>
                      <Badge tone={s.status === "scheduled" && s.starts_at < nowIso ? "strong" : s.status === "scheduled" ? "plain" : "muted"}>
                        {s.status === "scheduled" && s.starts_at < nowIso ? "Mark the outcome" : PT_STATUS[s.status]}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <div className="lg:col-span-2">
        <Panel
          title={formatMonth(month)}
          id="pt-month-heading"
          actions={
            <>
              <TextLink href={`/coach/sessions?view=${view}&month=${addMonths(monthStart, -1).slice(0, 7)}`}>
                Previous
              </TextLink>
              <TextLink href={`/coach/sessions?view=${view}&month=${addMonths(monthStart, 1).slice(0, 7)}`}>
                Next
              </TextLink>
            </>
          }
        >
          <div className="grid grid-cols-7 gap-px border border-line bg-line text-center text-sm">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} aria-hidden="true" className="bg-surface py-1 text-xs font-semibold text-muted">
                {d}
              </div>
            ))}
            {cells.map((date, i) => {
              if (!date) return <div key={`pad-${i}`} aria-hidden="true" className="bg-paper" />;
              const n = countOn(date);
              return (
                <div key={date} className={cn("flex min-h-11 flex-col items-center justify-center", n ? "bg-ink font-semibold text-paper" : "bg-white text-muted", date === today && "outline-2 -outline-offset-2 outline-ink")}>
                  <span aria-hidden="true">{Number(date.slice(8))}</span>
                  {n ? <span aria-hidden="true" className="text-[0.7rem] tabular-nums">{n}</span> : null}
                  <span className="sr-only">
                    {formatDate(date)}: {n} {n === 1 ? "session" : "sessions"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-muted">Days with sessions are filled; the number is how many.</p>
        </Panel>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { listClassSessions } from "@/lib/coach/bookings";
import { CLASS_NAME, classCapacity, classOccurrences, classSlots, slotLabel } from "@/lib/coach/classes";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { listRequests } from "@/lib/coach/requests";
import { addDays, addMonths, endOfMonth, formatClock, formatDate, formatMonth, weekday } from "@/lib/coach/time";
import { Badge, LoadError, PageHeader, Panel, TextLink } from "@/components/coach/ui";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Classes" };

export default function ClassesPage({ searchParams }: PageProps<"/coach/classes">) {
  return (
    <>
      <PageHeader title="Classes" eyebrow={`${CLASS_NAME} · ${classSlots().map(slotLabel).join(", ")}`} />
      <Suspense fallback={<p className="mt-8 text-muted">Loading classes…</p>}>
        <Classes searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const WEEKDAY_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function Classes({ searchParams }: { searchParams: PageProps<"/coach/classes">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const month = typeof params.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : today.slice(0, 7);
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const monthStart = `${month}-01`;
  const monthEnd = endOfMonth(monthStart);
  const upcomingEnd = addDays(today, 13);
  const from = monthStart < today ? monthStart : today;
  const to = monthEnd > upcomingEnd ? monthEnd : upcomingEnd;
  const loaded = collect(await Promise.all([listClassSessions(db, from, to), listRequests(db, { filter: "open", limit: 500 })] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [rows, requests] = loaded.data;
  const rowFor = (date: string, slot: string) => rows.find((r) => r.class_date === date && r.slot === slot);
  const pendingFor = (date: string, slot: string) => requests.filter((r) => r.class_date === date && r.class_slot === slot).length;

  const upcoming = classOccurrences(today, upcomingEnd);
  const inMonth = classOccurrences(monthStart, monthEnd);
  const cells: (string | null)[] = [...Array.from({ length: weekday(monthStart) }, () => null)];
  for (let d = monthStart; d <= monthEnd; d = addDays(d, 1)) cells.push(d);

  return (
    <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
      <Panel title="Next two weeks" id="upcoming-heading">
        <ul className="divide-y divide-line border-y border-line">
          {upcoming.map((o) => {
            const row = rowFor(o.date, o.slot.id);
            const pending = pendingFor(o.date, o.slot.id);
            const full = (row?.booked ?? 0) >= classCapacity(row);
            return (
              <li key={`${o.date}-${o.slot.id}`}>
                <Link href={`/coach/classes/${o.date}/${o.slot.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-3 hover:bg-white">
                  <span>
                    <span className="font-semibold">{formatDate(o.date)}</span>
                    <span className="text-muted">, {formatClock(o.slot.start)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular-nums">
                      {row?.booked ?? 0}
                      {` / ${classCapacity(row)}`} booked
                    </span>
                    {pending ? <Badge tone="strong">{pending} to confirm</Badge> : null}
                    {full ? <Badge>Full</Badge> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-muted">A class shows as full when its places are all booked: 15 unless you&apos;ve set a different capacity for that date.</p>
      </Panel>

      <Panel
        title={formatMonth(month)}
        id="month-heading"
        actions={
          <>
            <TextLink href={`/coach/classes?month=${addMonths(monthStart, -1).slice(0, 7)}`}>
              <span aria-hidden="true">← </span>
              {formatMonth(addMonths(monthStart, -1))}
            </TextLink>
            <TextLink href={`/coach/classes?month=${addMonths(monthStart, 1).slice(0, 7)}`}>
              {formatMonth(addMonths(monthStart, 1))}
              <span aria-hidden="true"> →</span>
            </TextLink>
          </>
        }
      >
        <div className="grid grid-cols-7 gap-px border border-line bg-line text-center text-sm" role="presentation">
          {WEEKDAY_HEADINGS.map((d) => (
            <div key={d} aria-hidden="true" className="bg-surface py-1 text-xs font-semibold text-muted">
              {d}
            </div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`pad-${i}`} aria-hidden="true" className="bg-paper" />;
            const classes = inMonth.filter((o) => o.date === date);
            const booked = classes.reduce((sum, o) => sum + (rowFor(o.date, o.slot.id)?.booked ?? 0), 0);
            const label = `${formatDate(date)}${classes.length ? `, ${booked} booked` : ", no class"}`;
            return classes.length ? (
              <Link key={date} href={`/coach/classes/${date}/${classes[0].slot.id}`} aria-label={label} className={cn("flex min-h-12 flex-col items-center justify-center bg-white font-semibold hover:bg-ink hover:text-paper", date === today && "outline-2 -outline-offset-2 outline-ink")}>
                {Number(date.slice(8))}
                <span className="text-[0.7rem] font-normal tabular-nums">{booked}</span>
              </Link>
            ) : (
              <div key={date} aria-hidden="true" className={cn("flex min-h-12 items-center justify-center bg-paper text-muted", date === today && "outline-2 -outline-offset-2 outline-ink")}>
                {Number(date.slice(8))}
              </div>
            );
          })}
        </div>
        <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
          {inMonth.map((o) => {
            const row = rowFor(o.date, o.slot.id);
            return (
              <li key={`${o.date}-${o.slot.id}`} className="flex flex-wrap justify-between gap-2 py-2">
                <TextLink href={`/coach/classes/${o.date}/${o.slot.id}`}>
                  {formatDate(o.date)}, {formatClock(o.slot.start)}
                </TextLink>
                <span className="text-muted">
                  {row ? `${row.booked} booked${o.date < today ? `, ${row.attended} attended` : ""}` : "No bookings"}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}


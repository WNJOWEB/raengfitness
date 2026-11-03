import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { portalContext } from "@/lib/coach/context";
import { loadMessage } from "@/lib/coach/errors";
import { loadSchedule, scheduleWeeks } from "@/lib/coach/overview";
import { addDays, formatClock, formatDayMonth, startOfWeek, toLondon, weekday } from "@/lib/coach/time";
import { LoadError } from "@/components/coach/ui";

export const metadata: Metadata = { title: "Schedule" };

const DAY = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/**
 * Schedule (owner's coach design, 2026-10-28): the week tabs, then every
 * group class and one-to-one in the week with how many are booked (and the
 * capacity, when one is set). A session opens its page, which holds who's
 * booked, adding someone, attendance, capacity and cancelling the class.
 */
export default function SchedulePage({ searchParams }: PageProps<"/coach/schedule">) {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-7">
      <Suspense fallback={<CoachLoading />}>
        <Schedule searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Schedule({ searchParams }: { searchParams: PageProps<"/coach/schedule">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const weeks = scheduleWeeks(startOfWeek(today));
  const asked = Number(typeof params.week === "string" ? params.week : "0");
  const index = Number.isInteger(asked) && asked >= 0 && asked < weeks.length ? asked : 0;
  const week = weeks[index];
  const label = (i: number) => weeks[i].label || `${Number(weeks[i].start.slice(8))}–${formatDayMonth(addDays(weeks[i].start, 5))}`;
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const loaded = await loadSchedule(db, week.start, week.end);
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const entries = loaded.data;
  const total = entries.filter((e) => !e.pt && !e.cancelled).reduce((n, e) => n + e.booked, 0);

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="members-eyebrow">Schedule</p>
        <h1 id="coach-heading" className="text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">
          {total} booking{total === 1 ? "" : "s"} {index === 0 ? "this week" : index === 1 ? "next week" : "that week"}.
        </h1>
        <p>Open a session to see who&apos;s coming, add someone, take attendance or cancel it.</p>
      </div>

      <nav aria-label="Week" className="flex gap-2 overflow-x-auto py-1">
        {weeks.map((w, i) => (
          <Link key={w.start} href={`/coach/schedule?week=${i}`} aria-current={i === index ? "page" : undefined} className="members-chip shrink-0 whitespace-nowrap aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper">
            {label(i)}
          </Link>
        ))}
      </nav>

      {entries.length ? (
        <ul className="border-t border-line">
          {entries.map((e) => {
            const { time } = toLondon(e.startsAt);
            return (
              <li key={e.startsAt + e.title} className="border-b border-line">
                <Link href={e.href} className={`grid grid-cols-[64px_1fr_auto] items-center gap-3.5 py-4 ${e.past ? "text-ink" : ""}`}>
                  <span className={`flex flex-col items-center rounded-2xl border-[1.5px] border-ink py-2 ${e.pt ? "border-dashed" : ""}`}>
                    <small className="text-[0.6875rem] font-semibold tracking-[0.18em]">{DAY[weekday(e.date)]}</small>
                    <b className="text-2xl leading-[1.1] font-extrabold">{Number(e.date.slice(8))}</b>
                  </span>
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <b className={e.cancelled ? "line-through" : ""}>
                      {formatClock(time)} · {e.title}
                    </b>
                    {e.cancelled ? (
                      <span className="text-sm">Cancelled</span>
                    ) : e.past ? (
                      <span className="text-sm">Done</span>
                    ) : e.capacity && e.capacity <= 40 ? (
                      <span className="grid max-w-[180px] gap-0.5" style={{ gridTemplateColumns: `repeat(${e.capacity}, 1fr)` }} role="img" aria-label={`${e.booked} of ${e.capacity} places booked`}>
                        {Array.from({ length: e.capacity }, (_, i) => (
                          <i key={i} className={`block h-[5px] rounded-[2px] ${i < e.booked ? "bg-ink" : "bg-line"}`} />
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right font-semibold tabular-nums">
                    {e.pt ? "60 min" : e.cancelled ? "–" : e.booked}
                    {!e.pt && !e.cancelled ? <small className="block text-xs font-medium">{e.capacity ? (e.booked >= e.capacity ? "full" : `of ${e.capacity}`) : "booked"}</small> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-y border-line py-4">Nothing scheduled this week.</p>
      )}
      <p className="text-sm">Classes hold the usual class size unless you set a different size for a date on its page. Change the usual size under Classes.</p>
      <Link href="/coach/sessions/new" className="members-btn w-full sm:w-auto">
        Add a 1:1 session
      </Link>
    </>
  );
}

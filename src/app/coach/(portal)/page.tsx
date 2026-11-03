import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import { after } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { portalContext } from "@/lib/coach/context";
import { loadDashboard, type AttentionItem } from "@/lib/coach/dashboard";
import { catchUpRenewals } from "@/lib/coach/memberships";
import { loadMessage } from "@/lib/coach/errors";
import { formatPence } from "@/lib/coach/money";
import { loadToday, messageClassLink, whenLabel } from "@/lib/coach/overview";
import { formatLongDate } from "@/lib/coach/time";
import { greeting } from "@/lib/member-view";
import { Badge, EmptyState, LoadError, Metric, Panel, TextLink } from "@/components/coach/ui";
import { RevenueChart } from "@/components/coach/RevenueChart";
import { markPlace } from "./today-actions";

export const metadata: Metadata = { title: "Today" };

/**
 * Today (owner's coach design, 2026-10-28): what's waiting (payments to
 * confirm, replies, members low on credits), the next session with its
 * capacity, who's booked to check in, and what's coming up. Everything the
 * old dashboard held (the money summary, what needs attention, revenue) is
 * below, under Business.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-7">
      {/* Reads the session cookie, so it renders per request behind the boundary. */}
      <Suspense fallback={<CoachLoading />}>
        <Today />
      </Suspense>
    </div>
  );
}

const ATTENTION_LABEL: Record<AttentionItem["kind"], string> = {
  request: "Request",
  "payment-due": "Payment",
  "payment-failed": "Failed payment",
  upcoming: "Coming up",
  "check-in": "Check-in",
  renewal: "Renewal",
  package: "Package",
  membership: "Membership",
  "follow-up": "Follow-up",
};

function untilLabel(startsAt: string, now: Date): string {
  const m = Math.round((new Date(startsAt).getTime() - now.getTime()) / 60_000);
  if (m <= 0) return "on now";
  if (m < 60) return `in ${m} min`;
  if (m < 24 * 60) return `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  const d = Math.round(m / 1440);
  return `in ${d} ${d === 1 ? "day" : "days"}`;
}

async function Today() {
  const { db, today } = await portalContext();
  const now = new Date();
  if (!db) {
    return (
      <>
        <h1 className="font-display text-h2">{greeting(now)}.</h1>
        <LoadError message="The database isn't configured for this deployment (SUPABASE_URL and SUPABASE_SECRET_KEY)." />
      </>
    );
  }
  // The daily job makes renewals; this is only the safety net, so it runs after the page is sent instead of making every view wait for a database write.
  after(() => catchUpRenewals(db, today));
  const [todayResult, dashboard] = await Promise.all([loadToday(db, today, now), loadDashboard(db, today, now)]);
  if (!todayResult.ok) {
    return (
      <>
        <h1 className="font-display text-h2">{greeting(now)}.</h1>
        <LoadError message={loadMessage(todayResult.error)} />
        <p>
          <TextLink href="/coach/requests">Open booking requests</TextLink>
        </p>
      </>
    );
  }
  const t = todayResult.data;
  const next = t.next;
  const here = t.roster.filter((r) => r.status === "attended").length;
  const noShows = t.roster.filter((r) => r.status === "no_show").length;
  const classHref = next ? `/coach/classes/${next.occurrence.date}/${next.occurrence.slot.id}` : "/coach/classes";
  const mail = next ? messageClassLink(t.roster.map((r) => r.email), whenLabel(next.occurrence.startsAt)) : "";
  const stats = [
    { n: t.counts.payments, label: "payments to confirm", href: "/coach/inbox?f=pay" },
    { n: t.counts.replies, label: "to reply to", href: "/coach/inbox" },
    { n: t.counts.lowCredits, label: "members low on credits", href: "/coach/members?f=low" },
  ];

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="members-eyebrow">{formatLongDate(today)}</p>
        <h1 id="coach-heading" className="text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">
          {greeting(now)}.
        </h1>
      </div>

      <ul className="grid grid-cols-3 border-y border-line">
        {stats.map((s, i) => (
          <li key={s.label} className={i > 0 ? "border-l border-line" : ""}>
            <Link href={s.href} className={`flex h-full flex-col gap-0.5 py-3.5 pr-2.5 hover:underline ${i > 0 ? "pl-3.5" : ""}`}>
              <strong className="text-[1.75rem] leading-[1.1] font-extrabold tracking-[-0.02em] tabular-nums">{s.n}</strong>
              <span className="text-[0.8125rem] leading-snug">{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      {next ? (
        <section aria-label="Next session" className="flex flex-col gap-3.5 rounded-3xl bg-ink p-5.5 text-paper">
          <p className="text-xs font-semibold tracking-[0.24em] uppercase">Next session · {untilLabel(next.occurrence.startsAt, now)}</p>
          <p className="text-[clamp(1.625rem,7.4vw,2.125rem)] leading-[1.08] font-extrabold tracking-[-0.03em]">{whenLabel(next.occurrence.startsAt)}</p>
          <div className="flex flex-col gap-2">
            {next.capacity && next.capacity <= 40 ? (
              <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${next.capacity}, 1fr)` }} role="img" aria-label={`${next.booked} of ${next.capacity} places booked`}>
                {Array.from({ length: next.capacity }, (_, i) => (
                  <i key={i} className={`block h-2 rounded-[2px] ${i < next.booked ? "bg-paper" : "border border-grey"}`} />
                ))}
              </div>
            ) : null}
            <p className="flex justify-between text-sm tabular-nums">
              <span>{next.booked} booked</span>
              <span>{next.capacity ? (next.booked >= next.capacity ? "Full" : `${next.capacity - next.booked} spaces left`) : "No capacity set"}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-grey pt-3.5">
            <Link href={`${classHref}#walk-in-heading`} className="inline-flex min-h-11 items-center rounded-full border border-paper bg-paper px-4 text-sm font-semibold text-ink">
              Add walk-in
            </Link>
            {mail ? (
              <a href={mail} className="inline-flex min-h-11 items-center rounded-full border border-grey px-4 text-sm font-semibold">
                Message class
              </a>
            ) : null}
            <Link href={classHref} className="inline-flex min-h-11 items-center rounded-full border border-grey px-4 text-sm font-semibold">
              Manage
            </Link>
          </div>
        </section>
      ) : (
        <p className="rounded-3xl border-[1.5px] border-dashed border-line p-6">No class in the next two weeks.</p>
      )}

      {next ? (
        <section aria-labelledby="checkin-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="checkin-heading" className="members-eyebrow">
              Check in
            </h2>
            <span className="text-sm tabular-nums">
              {here} of {t.roster.length} here{noShows ? ` · ${noShows} no-show` : ""}
            </span>
          </div>
          {t.roster.length ? (
            <ul className="border-t border-line">
              {t.roster.map((r) => (
                <li key={r.attendanceId} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 border-b border-line py-3">
                  <span aria-hidden="true" className="grid size-10 place-items-center rounded-full border border-line text-sm font-bold">
                    {r.name
                      .split(" ")
                      .map((p) => p[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <Link href={`/coach/clients/${r.clientId}`} className="flex min-w-0 flex-col">
                    <b className="truncate font-semibold">{r.name}</b>
                    <span className="text-[0.8125rem]">
                      {r.plan}
                      {r.low ? " · low credits" : ""}
                    </span>
                  </Link>
                  <span className="flex items-center gap-2">
                    <form action={markPlace}>
                      <input type="hidden" name="attendance" value={r.attendanceId} />
                      <input type="hidden" name="to" value="no_show" />
                      <input type="hidden" name="now" value={r.status} />
                      <button type="submit" aria-pressed={r.status === "no_show"} aria-label={`Mark ${r.name} as no-show`} className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-line px-3 text-xs font-semibold aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper">
                        No-show
                      </button>
                    </form>
                    <form action={markPlace}>
                      <input type="hidden" name="attendance" value={r.attendanceId} />
                      <input type="hidden" name="to" value="attended" />
                      <input type="hidden" name="now" value={r.status} />
                      <button type="submit" aria-pressed={r.status === "attended"} aria-label={`Mark ${r.name} as here`} className="grid size-11 place-items-center rounded-full border-[1.5px] border-line aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[2.4]" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.5 10 17l9-10" />
                        </svg>
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-y border-line py-4">No one booked yet.</p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="coming-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="coming-heading" className="members-eyebrow">
            Coming up
          </h2>
          <Link href="/coach/schedule" className="members-link">
            Full schedule
          </Link>
        </div>
        {t.comingUp.length ? (
          <ul className="border-t border-line">
            {t.comingUp.map((c) => (
              <li key={c.startsAt + c.label} className="border-b border-line">
                <Link href={c.href} className="flex min-h-14 items-center justify-between gap-3 py-3">
                  <span className="flex flex-col">
                    <b className="font-semibold">{whenLabel(c.startsAt)}</b>
                    <span className="text-sm">{c.pt ? "1:1" : c.label}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{c.pt ? "1:1" : `${c.booked}${c.capacity ? ` / ${c.capacity}` : ""}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-y border-line py-4">Nothing else coming up.</p>
        )}
      </section>

      <section aria-labelledby="business-heading" className="mt-2 flex flex-col gap-4 border-t-2 border-ink pt-7">
        <h2 id="business-heading" className="members-eyebrow">
          Business
        </h2>
        {dashboard.ok ? (
          <Business d={dashboard.data} />
        ) : (
          <>
            <LoadError message={loadMessage(dashboard.error)} />
            <p>
              <TextLink href="/coach/requests">Open booking requests</TextLink>
            </p>
          </>
        )}
      </section>
    </>
  );
}

function Business({ d }: { d: Extract<Awaited<ReturnType<typeof loadDashboard>>, { ok: true }>["data"] }) {
  return (
    <>
      <ul className="grid grid-cols-2 gap-3">
        <li>
          <Metric emphasis label="Received this month" value={formatPence(d.receivedMonth.net)} note={d.receivedMonth.refunds ? `After ${formatPence(d.receivedMonth.refunds)} refunds` : "After refunds"} href="/coach/finances?period=month" />
        </li>
        <li>
          <Metric label="Outstanding" value={formatPence(d.outstanding.due)} note={d.outstanding.later ? `${formatPence(d.outstanding.later)} more due later` : "Owed now"} href="/coach/finances#outstanding" />
        </li>
      </ul>

      <Panel title="Needs attention" id="attention-heading">
        {d.attention.length === 0 ? (
          <EmptyState title="Nothing needs you right now.">New requests, payments due, check-ins and follow-ups appear here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {d.attention.slice(0, 25).map((item, i) => (
              <li key={`${item.href}-${i}`}>
                <a href={item.href} className="flex min-h-11 flex-col gap-1 py-3 hover:bg-white sm:flex-row sm:items-center sm:gap-4">
                  <span className="shrink-0 sm:w-32">
                    <Badge tone={item.urgent ? "strong" : "plain"}>{ATTENTION_LABEL[item.kind]}</Badge>
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold underline-offset-4 hover:underline">{item.title}</span>
                    <span className="block text-sm text-muted">{item.detail}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {d.attention.length > 25 ? <p className="mt-3 text-sm text-muted">Showing 25 of {d.attention.length}.</p> : null}
      </Panel>

      <details className="group rounded-3xl border border-line">
        <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-5 font-semibold">
          More figures
          <span aria-hidden="true" className="text-sm group-open:hidden">Show</span>
        </summary>
        <div className="flex flex-col gap-6 px-5 pb-5">
          <ul className="grid grid-cols-2 gap-3">
            <li>
              <Metric label="Received this week" value={formatPence(d.receivedWeek.net)} note="Monday to Sunday" href="/coach/finances?period=week" />
            </li>
            <li>
              <Metric label="Active clients" value={d.activeClients} href="/coach/clients?status=active" />
            </li>
            <li>
              <Metric label="Sessions delivered" value={d.delivered.classes + d.delivered.pt} note={`This month: ${d.delivered.classes} classes, ${d.delivered.pt} one-to-one`} />
            </li>
            <li>
              <Metric label="Upcoming confirmed" value={d.upcoming.classPlaces + d.upcoming.pt} note={`Next 7 days: ${d.upcoming.classPlaces} class places, ${d.upcoming.pt} one-to-one`} href="/coach/classes" />
            </li>
            <li>
              <Metric label="Requests awaiting you" value={d.requests.new + d.requests.awaiting} note={`${d.requests.new} new, ${d.requests.awaiting} awaiting response`} href="/coach/requests" />
            </li>
            <li>
              <Metric label="Active online clients" value={d.online.active} note={`Expected ${formatPence(d.online.expectedMonthly)}/month (not yet received)`} href="/coach/online" />
            </li>
          </ul>

          <Panel title="Revenue" id="revenue-heading" actions={<TextLink href="/coach/finances">Finances</TextLink>}>
            {d.months.some((m) => m.net !== 0) ? (
              <RevenueChart id="dashboard-revenue" months={d.months} />
            ) : (
              <p className="border-y border-line py-4">No money received yet.</p>
            )}
            <p className="mt-3 text-sm text-muted">Money actually received, after refunds. Unpaid charges and expected subscription income are not included.</p>
          </Panel>
        </div>
      </details>
    </>
  );
}

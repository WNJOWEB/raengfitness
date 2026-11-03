import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { formatDayMonth } from "@/lib/coach/time";
import { loadInbox, loadMemberRows, loadOnlineRows, matchesMemberFilter, MEMBER_FILTERS, memberFlags, type MemberFilter } from "@/lib/coach/overview";
import { LoadError } from "@/components/coach/ui";

export const metadata: Metadata = { title: "Members" };

/**
 * Members (owner's coach design, 2026-10-28): online coaching clients first,
 * then everyone with search and filters (low credits, credits expiring, not
 * seen for two weeks, pay as you go). A row opens the client's record, which
 * holds their notes, payments, memberships and credits.
 */
export default function MembersPage({ searchParams }: PageProps<"/coach/members">) {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-7">
      <Suspense fallback={<CoachLoading />}>
        <Members searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

async function Members({ searchParams }: { searchParams: PageProps<"/coach/members">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const filter: MemberFilter = MEMBER_FILTERS.some((f) => f.value === params.f) ? (params.f as MemberFilter) : "all";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const inbox = await loadInbox(db, today);
  const loaded = collect(await Promise.all([loadMemberRows(db, today), loadOnlineRows(db, inbox.ok ? inbox.data : [])] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [members, online] = loaded.data;
  const shown = members.filter((m) => matchesMemberFilter(m, filter, today) && m.name.toLowerCase().includes(q.toLowerCase()));
  const href = (f: MemberFilter) => `/coach/members?${new URLSearchParams({ ...(q ? { q } : {}), ...(f !== "all" ? { f } : {}) }).toString()}`;

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="members-eyebrow">Members</p>
        <h1 id="coach-heading" className="text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">
          {members.length} member{members.length === 1 ? "" : "s"}.
        </h1>
      </div>

      <section aria-labelledby="online-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="online-heading" className="members-eyebrow">
            Online coaching
          </h2>
          <Link href="/coach/online" className="members-link">
            All plans
          </Link>
        </div>
        {online.length ? (
          <ul className="border-t border-line">
            {online.map((c) => (
              <li key={c.subscriptionId} className="border-b border-line">
                <Link href={`/coach/online/${c.subscriptionId}`} className="grid min-h-14 grid-cols-[40px_1fr] items-center gap-3 py-3">
                  <span aria-hidden="true" className="grid size-10 place-items-center rounded-full border border-line text-sm font-bold">
                    {initials(c.name)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate font-semibold">{c.name}</b>
                    <span className="text-[0.8125rem]">
                      {c.plan}
                      {c.needsCheckIn ? " · check-in to review" : ""}
                      {c.unread ? " · new message" : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-y border-line py-4">No online clients yet. Start one from an enquiry in the inbox.</p>
        )}
      </section>

      <form action="/coach/members" role="search" className="flex items-center gap-2.5 rounded-full border-[1.5px] border-line bg-white px-4">
        <label className="flex-1">
          <span className="sr-only">Search members</span>
          <input name="q" type="search" defaultValue={q} placeholder="Search by name" className="min-h-12 w-full bg-transparent outline-none" />
        </label>
        {filter !== "all" ? <input type="hidden" name="f" value={filter} /> : null}
        <button type="submit" className="members-link">
          Search
        </button>
      </form>

      <nav aria-label="Filter members" className="flex gap-2 overflow-x-auto py-1">
        {MEMBER_FILTERS.map((f) => (
          <Link key={f.value} href={href(f.value)} aria-current={f.value === filter ? "page" : undefined} className="members-chip shrink-0 whitespace-nowrap aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper">
            {f.label}
            <em className="ml-1.5 text-[0.8125rem] not-italic tabular-nums">{members.filter((m) => matchesMemberFilter(m, f.value, today)).length}</em>
          </Link>
        ))}
      </nav>

      {shown.length ? (
        <ul className="border-t border-line">
          {shown.map((m) => {
            const flags = memberFlags(m, today);
            return (
              <li key={m.clientId} className="border-b border-line">
                <Link href={`/coach/clients/${m.clientId}`} className="grid min-h-14 grid-cols-[40px_1fr_auto] items-center gap-3 py-3">
                  <span aria-hidden="true" className="grid size-10 place-items-center rounded-full border border-line text-sm font-bold">
                    {initials(m.name)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate font-semibold">{m.name}</b>
                    <span className="text-[0.8125rem]">
                      {m.plan} · {m.lastClass ? `last in ${formatDayMonth(m.lastClass)}` : "no class in 8 weeks"}
                      {flags.expiring && m.periodEnd ? ` · ${m.creditsLeft} expire ${formatDayMonth(m.periodEnd)}` : flags.low ? " · low credits" : ""}
                    </span>
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums">
                    {m.payg ? "Pay as you go" : `${m.creditsLeft} / ${m.credits}`}
                    {m.payg ? null : <small className="block text-xs font-medium">credits</small>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-y border-line py-4">No members match.</p>
      )}
      <Link href="/coach/clients/new" className="members-btn w-full sm:w-auto">
        Add a client
      </Link>
      <p className="text-sm">
        Everyone else, including leads and former clients, is under <Link href="/coach/clients" className="underline underline-offset-4">Clients</Link>.
      </p>
    </>
  );
}

import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { portalContext } from "@/lib/coach/context";
import { loadMessage } from "@/lib/coach/errors";
import { INBOX_FILTERS, loadInbox, type InboxGroup } from "@/lib/coach/overview";
import { formatDate, toLondon } from "@/lib/coach/time";
import { LoadError } from "@/components/coach/ui";

export const metadata: Metadata = { title: "Inbox" };

/**
 * Inbox (owner's coach design, 2026-10-28): everything waiting on the coach
 * in one list: booking requests and online enquiries, payments to confirm,
 * and coaching check-ins and client messages. Each opens the page where it is
 * dealt with (the request, the payment form, the client's coaching plan).
 */
export default function InboxPage({ searchParams }: PageProps<"/coach/inbox">) {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-7">
      <Suspense fallback={<CoachLoading />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Inbox({ searchParams }: { searchParams: PageProps<"/coach/inbox">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const filter = INBOX_FILTERS.some((f) => f.value === params.f) ? (params.f as "all" | InboxGroup) : "all";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const loaded = await loadInbox(db, today);
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const all = loaded.data;
  const shown = filter === "all" ? all : all.filter((i) => i.group === filter);

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="members-eyebrow">Inbox</p>
        <h1 id="coach-heading" className="text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">
          {all.length ? `${all.length} to deal with.` : "All clear."}
        </h1>
        <p>Requests, payments, check-ins and client messages in one place.</p>
      </div>

      <nav aria-label="Filter inbox" className="flex gap-2 overflow-x-auto py-1">
        {INBOX_FILTERS.map((f) => (
          <Link key={f.value} href={f.value === "all" ? "/coach/inbox" : `/coach/inbox?f=${f.value}`} aria-current={f.value === filter ? "page" : undefined} className="members-chip shrink-0 whitespace-nowrap aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper">
            {f.label}
            <em className="ml-1.5 text-[0.8125rem] not-italic tabular-nums">{f.value === "all" ? all.length : all.filter((i) => i.group === f.value).length}</em>
          </Link>
        ))}
      </nav>

      {shown.length ? (
        <ul className="border-t border-line">
          {shown.map((i) => (
            <li key={i.id} className="flex flex-col gap-2.5 border-b border-line py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.6875rem] font-semibold tracking-[0.2em] uppercase">{i.label}</span>
                <span className="text-[0.8125rem] whitespace-nowrap">{formatDate(toLondon(i.at).date)}</span>
              </div>
              <b>{i.who}</b>
              {i.detail ? <p>{i.detail}</p> : null}
              <div>
                <Link href={i.href} className="members-btn members-btn-solid min-h-11 px-5 py-2">
                  {i.action}
                  <span className="sr-only">: {i.who}</span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-y border-line py-4">{all.length ? "Nothing in this filter." : "Nothing waiting. New requests, payments and messages will show up here."}</p>
      )}
    </>
  );
}

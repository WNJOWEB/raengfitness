import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { portalContext } from "@/lib/coach/context";
import { loadMessage } from "@/lib/coach/errors";
import { REQUEST_STATUS } from "@/lib/coach/labels";
import { listRequests, REQUEST_FILTERS, type RequestFilter } from "@/lib/coach/requests";
import { formatStamp } from "@/lib/coach/time";
import { Badge, EmptyState, FilterLinks, LoadError, PageHeader, SearchBar, SearchInput } from "@/components/coach/ui";

export const metadata: Metadata = { title: "Requests" };

const FILTER_LABEL: Record<RequestFilter, string> = {
  open: "To do",
  new: "New",
  awaiting: "Awaiting response",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
  all: "All",
};

export default function RequestsPage({ searchParams }: PageProps<"/coach/requests">) {
  return (
    <>
      <PageHeader title="Requests" eyebrow="Booking requests and online enquiries" />
      <Suspense fallback={<CoachLoading />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Inbox({ searchParams }: { searchParams: PageProps<"/coach/requests">["searchParams"] }) {
  const { db } = await portalContext();
  const params = await searchParams;
  const raw = typeof params.status === "string" ? params.status : "open";
  const filter: RequestFilter = (REQUEST_FILTERS as readonly string[]).includes(raw) ? (raw as RequestFilter) : "open";
  const q = typeof params.q === "string" ? params.q.slice(0, 60) : "";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const result = await listRequests(db, { filter, q });
  const qs = (status: string) => `/coach/requests?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <>
      <SearchBar action="/coach/requests" label="Search requests">
        <input type="hidden" name="status" value={filter} />
        <SearchInput name="q" label="Name, email, phone or date" defaultValue={q} />
      </SearchBar>
      <div className="mt-6">
        <FilterLinks label="Request status" current={filter} items={REQUEST_FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f], href: qs(f) }))} />
      </div>
      {!result.ok ? (
        <LoadError message={loadMessage(result.error)} />
      ) : result.data.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={q ? "No requests match that search." : filter === "open" ? "No requests waiting for you." : `No ${FILTER_LABEL[filter].toLowerCase()} requests.`}>
            New requests from the booking page and online coaching form appear here.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {result.data.map((r) => (
            <li key={r.id}>
              <Link href={`/coach/requests/${r.id}`} className="grid min-h-11 grid-cols-1 gap-1 py-4 hover:bg-white sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.name}</span>
                    <Badge tone={r.status === "new" ? "strong" : r.status === "awaiting" ? "plain" : "muted"}>{REQUEST_STATUS[r.status] ?? r.status}</Badge>
                    {r.client_id ? <Badge tone="muted">Returning client</Badge> : null}
                  </span>
                  <span className="mt-1 block text-sm">
                    {r.service}
                    {r.summary ? ` · ${r.summary}` : ""}
                  </span>
                </span>
                <span className="text-sm text-muted sm:text-right">
                  Received <time dateTime={r.created_at}>{formatStamp(r.created_at)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

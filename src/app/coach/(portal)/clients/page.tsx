import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { clientBalances, clientServices, CLIENT_STATUSES, listClients, listFollowUps, type ClientSort } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { CLIENT_STATUS, SERVICE } from "@/lib/coach/labels";
import { formatPence } from "@/lib/coach/money";
import { formatDate } from "@/lib/coach/time";
import type { ClientStatus, ServiceKey } from "@/lib/coach/types";
import { ActionLink, Badge, EmptyState, LoadError, PageHeader, SearchBar, SearchInput, SearchSelect } from "@/components/coach/ui";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage({ searchParams }: PageProps<"/coach/clients">) {
  return (
    <>
      <PageHeader title="Clients" eyebrow="One record per person">
        <ActionLink href="/coach/clients/new" variant="primary">
          Add a client
        </ActionLink>
      </PageHeader>
      <Suspense fallback={<CoachLoading />}>
        <Directory searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const SERVICE_FILTERS: ServiceKey[] = ["group", "pt", "online"];

async function Directory({ searchParams }: { searchParams: PageProps<"/coach/clients">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(params.q).slice(0, 60);
  const status = (CLIENT_STATUSES as readonly string[]).includes(str(params.status)) ? (str(params.status) as ClientStatus) : "";
  const service = (SERVICE_FILTERS as string[]).includes(str(params.service)) ? (str(params.service) as ServiceKey) : "";
  const sort: ClientSort = ["name", "newest", "oldest"].includes(str(params.sort)) ? (str(params.sort) as ClientSort) : "name";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const loaded = collect(await Promise.all([listClients(db, { q, status, sort }), clientServices(db), clientBalances(db), listFollowUps(db, { open: true })] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [clients, services, balances, followUps] = loaded.data;
  const shown = service ? clients.filter((c) => services.get(c.id)?.has(service)) : clients;
  const filtered = Boolean(q || status || service);

  return (
    <>
      <SearchBar action="/coach/clients" label="Find clients">
        <SearchInput name="q" label="Name, email or phone" defaultValue={q} />
        <SearchSelect name="status" label="Status" defaultValue={status} options={[{ value: "", label: "Any status" }, ...CLIENT_STATUSES.map((s) => ({ value: s, label: CLIENT_STATUS[s] }))]} />
        <SearchSelect name="service" label="Service" defaultValue={service} options={[{ value: "", label: "Any service" }, ...SERVICE_FILTERS.map((s) => ({ value: s, label: SERVICE[s] }))]} />
        <SearchSelect name="sort" label="Sort" defaultValue={sort} options={[{ value: "name", label: "Name A–Z" }, { value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }]} />
      </SearchBar>
      <p className="mt-6 text-sm text-muted" role="status">
        {shown.length} {shown.length === 1 ? "client" : "clients"}
        {filtered ? " match" : ""}
      </p>
      {shown.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={filtered ? "No clients match." : "No clients yet."}>
            {filtered ? "Try a different search or filter." : "Clients are added when you confirm a booking request, or with “Add a client”."}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {shown.map((c) => {
            const b = balances.get(c.id);
            const used = [...(services.get(c.id) ?? [])];
            const nextFollowUp = followUps.find((f) => f.client_id === c.id);
            return (
              <li key={c.id}>
                <Link href={`/coach/clients/${c.id}`} className="grid min-h-11 grid-cols-1 gap-1 py-3 hover:bg-white md:grid-cols-[2fr_2fr_1fr] md:items-center md:gap-4">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.full_name}</span>
                      <Badge tone={c.status === "active" ? "strong" : c.status === "lead" ? "plain" : "muted"}>{CLIENT_STATUS[c.status]}</Badge>
                    </span>
                    <span className="block truncate text-sm text-muted">{[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
                  </span>
                  <span className="text-sm">
                    {used.length ? used.map((s) => SERVICE[s]).join(", ") : <span className="text-muted">No bookings yet</span>}
                    {nextFollowUp ? (
                      <span className="block text-muted">
                        Follow up {nextFollowUp.due_on < today ? "overdue" : "on"} {formatDate(nextFollowUp.due_on)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm md:text-right">
                    {b && b.outstanding_pence > 0 ? <strong>{formatPence(b.outstanding_pence)} owed</strong> : <span className="text-muted">Nothing owed</span>}
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

import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { listPackages } from "@/lib/coach/bookings";
import { defaultPrices } from "@/lib/coach/classes";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { isUuid } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { penceToInput } from "@/lib/coach/money";
import { ActionForm, Field, MoneyField, SelectField, SubmitButton, TextArea } from "@/components/coach/form";
import { LoadError, PageHeader, TextLink } from "@/components/coach/ui";
import { addPtSessionAction } from "../actions";

export const metadata: Metadata = { title: "Book a session" };

export default function NewSessionPage({ searchParams }: PageProps<"/coach/sessions/new">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/sessions">PT sessions</TextLink>
      </p>
      <div className="mt-4">
        <PageHeader title="Book a one-to-one" />
      </div>
      <Suspense fallback={<CoachLoading />}>
        <NewSession searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewSession({ searchParams }: { searchParams: PageProps<"/coach/sessions/new">["searchParams"] }) {
  const { db } = await portalContext();
  const params = await searchParams;
  const preselected = typeof params.client === "string" && isUuid(params.client) ? params.client : "";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const [clients, packages] = await Promise.all([listClients(db), preselected ? listPackages(db, { clientId: preselected, activeOnly: true }) : Promise.resolve({ ok: true as const, data: [] })]);
  if (!clients.ok) return <LoadError message={loadMessage(clients.error)} />;
  const usable = packages.ok ? packages.data.filter((k) => k.sessions_remaining > 0) : [];
  const options = clients.data.filter((c) => c.status !== "former" || c.id === preselected).map((c) => ({ value: c.id, label: c.full_name }));

  return (
    <div className="mt-8 max-w-2xl">
      <ActionForm action={addPtSessionAction} label="Book a one-to-one">
        <SelectField name="client" label="Client" required placeholder="Choose a client" options={options} defaultValue={preselected} hint={options.length ? undefined : "Add a client first."} />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field name="date" label="Date" type="date" required />
          <Field name="time" label="Start" type="time" required />
          <Field name="minutes" label="Minutes" type="number" inputMode="numeric" min={15} max={240} defaultValue={60} required />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <MoneyField name="price" label="Agreed price" defaultValue={penceToInput(defaultPrices().ptPence)} required hint="A charge for this is added. Ignored when a package is used." />
          {usable.length ? (
            <SelectField name="package" label="Use a package" placeholder="No package" options={usable.map((k) => ({ value: k.id, label: `${k.name}: ${k.sessions_remaining} left` }))} />
          ) : preselected ? (
            <p className="text-sm text-muted sm:pt-7">No package with sessions left.</p>
          ) : (
            <p className="text-sm text-muted sm:pt-7">To use a package, start from the client&apos;s record.</p>
          )}
        </div>
        <TextArea name="notes" label="Admin notes" rows={2} maxLength={1000} />
        <div>
          <SubmitButton pendingLabel="Booking…">Book session</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { defaultPrices } from "@/lib/coach/classes";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { isUuid } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { SubscriptionFields } from "@/components/coach/SubscriptionFields";
import { ActionForm, SelectField, SubmitButton } from "@/components/coach/form";
import { LoadError, PageHeader, TextLink } from "@/components/coach/ui";
import { createSubscriptionAction } from "../actions";

export const metadata: Metadata = { title: "Set up online coaching" };

export default function NewSubscriptionPage({ searchParams }: PageProps<"/coach/online/new">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/online">Online coaching</TextLink>
      </p>
      <div className="mt-4">
        <PageHeader title="Set up online coaching" />
      </div>
      <Suspense fallback={<CoachLoading />}>
        <NewSubscription searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewSubscription({ searchParams }: { searchParams: PageProps<"/coach/online/new">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const preselected = typeof params.client === "string" && isUuid(params.client) ? params.client : "";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const clients = await listClients(db);
  if (!clients.ok) return <LoadError message={loadMessage(clients.error)} />;
  return (
    <div className="mt-8 max-w-3xl">
      <p className="mb-6 text-sm text-muted">This records the plan and what it should bring in. It doesn&apos;t take payments: record each payment when it arrives.</p>
      <ActionForm action={createSubscriptionAction} label="Set up online coaching">
        <SelectField name="client" label="Client" required placeholder="Choose a client" defaultValue={preselected} options={clients.data.map((c) => ({ value: c.id, label: c.full_name }))} />
        <SubscriptionFields defaults={{ pricePence: defaultPrices().onlinePence, today }} />
        <div>
          <SubmitButton pendingLabel="Saving…">Save plan</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

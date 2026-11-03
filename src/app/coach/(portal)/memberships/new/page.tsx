import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { BILLING_WEEKS, membershipPlans } from "@/content/memberships";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { isUuid } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { ActionForm, Field, RadioGroup, SelectField, SubmitButton, TextArea } from "@/components/coach/form";
import { LoadError, PageHeader, TextLink } from "@/components/coach/ui";
import { startMembershipAction } from "../actions";

export const metadata: Metadata = { title: "Start a membership" };

export default function NewMembershipPage({ searchParams }: PageProps<"/coach/memberships/new">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/memberships">Memberships</TextLink>
      </p>
      <div className="mt-4">
        <PageHeader title="Start a membership" />
      </div>
      <Suspense fallback={<CoachLoading />}>
        <NewMembership searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewMembership({ searchParams }: { searchParams: PageProps<"/coach/memberships/new">["searchParams"] }) {
  const { db, today } = await portalContext();
  const params = await searchParams;
  const client = typeof params.client === "string" && isUuid(params.client) ? params.client : "";
  const request = typeof params.request === "string" && isUuid(params.request) ? params.request : "";
  const plan = membershipPlans.some((p) => p.id === params.plan) ? String(params.plan) : "";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const clients = await listClients(db);
  if (!clients.ok) return <LoadError message={loadMessage(clients.error)} />;
  return (
    <div className="mt-8 max-w-3xl">
      <p className="mb-6 text-sm text-muted">
        The first {BILLING_WEEKS}-week period starts on the start date with its credits and its charge. It then renews every {BILLING_WEEKS} weeks automatically until you pause or cancel it. Record each payment when it arrives.
      </p>
      <ActionForm action={startMembershipAction} label="Start a membership">
        <SelectField name="client" label="Client" required placeholder="Choose a client" defaultValue={client} options={clients.data.map((c) => ({ value: c.id, label: c.full_name }))} />
        <RadioGroup
          name="plan"
          legend="Plan"
          defaultValue={plan}
          options={membershipPlans.map((p) => ({ value: p.id, label: `${p.name}: £${p.priceGbp} every ${BILLING_WEEKS} weeks`, hint: `${p.credits} class credits per period` }))}
        />
        <Field name="start_on" label="Start date" type="date" required defaultValue={today} />
        {request ? <input type="hidden" name="request" value={request} /> : null}
        <TextArea name="notes" label="Notes" maxLength={2000} />
        <div>
          <SubmitButton pendingLabel="Starting…">Start membership</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

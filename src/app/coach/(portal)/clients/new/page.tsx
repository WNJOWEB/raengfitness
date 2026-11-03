import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { portalContext } from "@/lib/coach/context";
import { ClientFields } from "@/components/coach/ClientFields";
import { ActionForm, SubmitButton } from "@/components/coach/form";
import { PageHeader, TextLink } from "@/components/coach/ui";
import { createClientAction } from "../actions";

export const metadata: Metadata = { title: "Add a client" };

export default function NewClientPage() {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/clients">Clients</TextLink>
      </p>
      <div className="mt-4">
        <PageHeader title="Add a client" />
      </div>
      <Suspense fallback={<CoachLoading />}>
        <NewClient />
      </Suspense>
    </>
  );
}

async function NewClient() {
  await portalContext();
  return (
    <div className="mt-8 max-w-3xl">
      <p className="mb-6 text-sm text-muted">If they&apos;ve sent a booking request, confirm it from Requests instead: that creates their record and links the request.</p>
      <ActionForm action={createClientAction} label="Add a client">
        <ClientFields />
        <div>
          <SubmitButton pendingLabel="Saving…">Add client</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

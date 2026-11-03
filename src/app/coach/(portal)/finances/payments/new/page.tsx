import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { connection } from "next/server";
import { paymentMethods } from "@/content/payments";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { isUuid } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { SERVICE } from "@/lib/coach/labels";
import { getCharge, listCharges } from "@/lib/coach/ledger";
import { formatPence, penceToInput } from "@/lib/coach/money";
import { formatDate } from "@/lib/coach/time";
import { ActionForm, Field, MoneyField, RadioGroup, SelectField, SubmitButton, TextArea } from "@/components/coach/form";
import { LoadError, Notice, PageHeader, TextLink } from "@/components/coach/ui";
import { recordPaymentAction } from "../../actions";

export const metadata: Metadata = { title: "Record a payment" };

export default function NewPaymentPage({ searchParams }: PageProps<"/coach/finances/payments/new">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/finances">Finances</TextLink>
      </p>
      <div className="mt-4">
        <PageHeader title="Record a payment" eyebrow="Money you've received" />
      </div>
      <Suspense fallback={<CoachLoading />}>
        <NewPayment searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewPayment({ searchParams }: { searchParams: PageProps<"/coach/finances/payments/new">["searchParams"] }) {
  const { db, today } = await portalContext();
  await connection();
  const params = await searchParams;
  const clientParam = typeof params.client === "string" && isUuid(params.client) ? params.client : "";
  const chargeParam = typeof params.charge === "string" && isUuid(params.charge) ? params.charge : "";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const [clients, charge, open] = await Promise.all([
    listClients(db),
    chargeParam ? getCharge(db, chargeParam) : Promise.resolve({ ok: true as const, data: null }),
    clientParam ? listCharges(db, { clientId: clientParam, openOnly: true }) : Promise.resolve({ ok: true as const, data: [] }),
  ]);
  if (!clients.ok) return <LoadError message={loadMessage(clients.error)} />;
  if (!charge.ok) return <LoadError message={loadMessage(charge.error)} />;
  const chosen = charge.data && !charge.data.voided_at && charge.data.outstanding_pence > 0 && (!clientParam || charge.data.client_id === clientParam) ? charge.data : null;
  const clientId = chosen?.client_id ?? clientParam;
  const owed = open.ok ? open.data.reduce((sum, c) => sum + c.outstanding_pence, 0) : 0;
  // A fresh key per form: submitting the same form twice records one payment.
  const key = crypto.randomUUID();

  return (
    <div className="mt-8 max-w-2xl">
      {chosen ? (
        <Notice>
          For <strong>{chosen.description}</strong>: {formatPence(chosen.outstanding_pence)} owed
          {chosen.paid_pence > 0 ? ` of ${formatPence(chosen.amount_pence)}` : ""}, due {formatDate(chosen.due_on)}.
        </Notice>
      ) : clientId && owed > 0 ? (
        <Notice>They owe {formatPence(owed)} in total.</Notice>
      ) : null}
      <div className="mt-6">
        <ActionForm action={recordPaymentAction} label="Record a payment">
          <input type="hidden" name="key" value={key} key={key} />
          {chosen ? <input type="hidden" name="charge" value={chosen.id} /> : null}
          <SelectField name="client" label="Client" required placeholder="Choose a client" defaultValue={clientId} options={clients.data.map((c) => ({ value: c.id, label: c.full_name }))} />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <MoneyField name="amount" label="Amount received" required defaultValue={chosen ? penceToInput(chosen.outstanding_pence) : ""} hint="A part payment is fine." />
            <Field name="paid_on" label="Date received" type="date" defaultValue={today} max={today} required />
            <SelectField name="method" label="How they paid" required defaultValue={paymentMethods[0].value} options={paymentMethods.map((m) => ({ value: m.value, label: m.label }))} />
            <SelectField name="service" label="For" required defaultValue={chosen?.service ?? "group"} options={Object.entries(SERVICE).map(([value, label]) => ({ value, label }))} hint="Used for revenue by service." />
          </div>
          <RadioGroup
            name="apply"
            legend="Set it against"
            defaultValue={chosen ? "charge" : "oldest"}
            options={[
              ...(chosen ? [{ value: "charge", label: "This charge", hint: "Anything over what's owed becomes credit." }] : []),
              { value: "oldest", label: "Their oldest unpaid charges first", hint: "Anything left over becomes credit." },
              { value: "none", label: "Nothing for now", hint: "Kept as credit; set it against a charge later." },
            ]}
          />
          <Field name="reference" label="Reference" hint="e.g. the bank transfer reference" maxLength={200} />
          <TextArea name="note" label="Note" rows={2} maxLength={1000} />
          <div>
            <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}

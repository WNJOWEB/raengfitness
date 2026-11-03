import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { entityEvents, getClient } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { PAYMENT_METHOD, PAYMENT_STATUS, SERVICE } from "@/lib/coach/labels";
import { getPayment, listAllocations, listCharges, listRefunds } from "@/lib/coach/ledger";
import { formatPence, penceToInput } from "@/lib/coach/money";
import { formatDate, formatStamp } from "@/lib/coach/time";
import { ActionForm, Checkbox, Field, MoneyField, SelectField, SubmitButton, TextArea } from "@/components/coach/form";
import { Flash } from "@/components/coach/Flash";
import { Badge, Details, LoadError, Panel, TextLink } from "@/components/coach/ui";
import { allocateAction, paymentStatusAction, refundAction } from "../../actions";

export const metadata: Metadata = { title: "Payment" };

export default function PaymentPage({ params, searchParams }: PageProps<"/coach/finances/payments/[id]">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/finances">Finances</TextLink>
      </p>
      <Suspense fallback={<CoachLoading />}>
        <PaymentView params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PaymentView({ params, searchParams }: { params: PageProps<"/coach/finances/payments/[id]">["params"]; searchParams: PageProps<"/coach/finances/payments/[id]">["searchParams"] }) {
  const { db, today } = await portalContext();
  await connection();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const found = await getPayment(db, id);
  if (!found.ok) return <LoadError message={loadMessage(found.error)} />;
  if (!found.data) notFound();
  const p = found.data;
  const loaded = collect(await Promise.all([getClient(db, p.client_id), listAllocations(db, { paymentIds: [p.id] }), listRefunds(db, { paymentIds: [p.id] }), listCharges(db, { clientId: p.client_id }), entityEvents(db, p.id)] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [client, allocations, refunds, charges, events] = loaded.data;
  const charge = (cid: string) => charges.find((c) => c.id === cid);
  const open = charges.filter((c) => !c.voided_at && c.outstanding_pence > 0);
  const refundable = p.amount_pence - p.refunded_pence;
  const key = crypto.randomUUID();

  return (
    <>
      <div className="mt-4 border-b border-ink pb-6">
        <p className="eyebrow text-muted">Payment</p>
        <h1 className="mt-2 font-display text-h2">{formatPence(p.amount_pence)}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span>
            {formatDate(p.paid_on)} · {PAYMENT_METHOD[p.method]} from {client ? <TextLink href={`/coach/clients/${client.id}?tab=payments`}>{client.full_name}</TextLink> : "a deleted client"}
          </span>
          <Badge tone={p.status === "received" ? "muted" : "strong"}>{PAYMENT_STATUS[p.status]}</Badge>
        </p>
      </div>
      <Flash
        done={query.done}
        messages={{
          recorded: "Payment recorded.",
          allocated: "Set against the charge.",
          refunded: "Refund recorded.",
          failed: "Marked as failed. Anything it paid for is owed again.",
          void: "Marked void. Anything it paid for is owed again.",
        }}
      />

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
        <div>
          <Panel title="Details" id="details-heading">
            <Details
              items={[
                ["For", SERVICE[p.service]],
                ["Set against charges", formatPence(p.allocated_pence)],
                ["Refunded", formatPence(p.refunded_pence)],
                ["Not yet used (credit)", formatPence(p.unallocated_pence)],
                ["Reference", p.reference],
                ["Note", p.note],
                ...(p.status !== "received" ? ([["Reason", p.status_reason]] as [string, string][]) : []),
                ["Recorded", formatStamp(p.created_at)],
              ]}
            />
          </Panel>
          <Panel title="Paid for" id="allocations-heading">
            {allocations.length ? (
              <ul className="divide-y divide-line border-y border-line text-sm">
                {allocations.map((a) => (
                  <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{charge(a.charge_id)?.description ?? "Charge"}</span>
                    <span className="tabular-nums">{formatPence(a.amount_pence)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Not set against any charge.</p>
            )}
            {p.status === "received" && p.unallocated_pence > 0 && open.length ? (
              <div className="mt-4">
                <ActionForm action={allocateAction} label="Set against a charge">
                  <input type="hidden" name="payment" value={p.id} />
                  <SelectField name="charge" label="Charge" required options={open.map((c) => ({ value: c.id, label: `${c.description}: ${formatPence(c.outstanding_pence)} owed` }))} />
                  <MoneyField name="amount" label="Amount" defaultValue={penceToInput(Math.min(p.unallocated_pence, open[0].outstanding_pence))} required />
                  <div>
                    <SubmitButton variant="secondary">Set against charge</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </Panel>
          <Panel title="Refunds" id="refunds-heading">
            {refunds.length ? (
              <ul className="divide-y divide-line border-y border-line text-sm">
                {refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {formatDate(r.refunded_on)}
                      {r.note ? ` · ${r.note}` : ""}
                    </span>
                    <span className="tabular-nums">{formatPence(r.amount_pence)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">None.</p>
            )}
          </Panel>
        </div>

        <div>
          {p.status === "received" && refundable > 0 ? (
            <Panel title="Record a refund" id="refund-heading">
              <ActionForm action={refundAction} confirm="Record this refund? It can't be edited afterwards." label="Record a refund">
                <input type="hidden" name="payment" value={p.id} />
                <input type="hidden" name="key" value={key} key={key} />
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <MoneyField name="amount" label="Amount refunded" required hint={`Up to ${formatPence(refundable)}.`} />
                  <Field name="refunded_on" label="Date" type="date" defaultValue={today} max={today} required />
                </div>
                {allocations.length ? (
                  <>
                    <SelectField
                      name="charge"
                      label="Refund for"
                      placeholder="Credit not yet used"
                      options={allocations.map((a) => ({ value: a.charge_id, label: charge(a.charge_id)?.description ?? "Charge" }))}
                      hint="Refunds come out of unused credit first. Beyond that, the charge you choose is owed again unless you cancel it."
                    />
                    <Checkbox name="void_charge" label="Also cancel that charge (nothing is owed for it)" />
                  </>
                ) : null}
                <TextArea name="note" label="Reason" rows={2} maxLength={1000} required />
                <div>
                  <SubmitButton variant="secondary">Record refund</SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          ) : null}
          {p.status === "received" && p.refunded_pence === 0 ? (
            <Panel title="Mark as failed or entered in error" id="status-heading">
              <ActionForm action={paymentStatusAction} confirm="Change this payment's status? It will no longer count as received." label="Payment status">
                <input type="hidden" name="payment" value={p.id} />
                <SelectField
                  name="status"
                  label="New status"
                  required
                  options={[
                    { value: "failed", label: "Failed (e.g. a bounced transfer)" },
                    { value: "void", label: "Void (entered in error)" },
                  ]}
                />
                <Field name="reason" label="Reason" required maxLength={300} />
                <p className="text-sm text-muted">The payment stays in the history. Anything it paid for is owed again.</p>
                <div>
                  <SubmitButton variant="secondary">Change status</SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          ) : null}
          <Panel title="History" id="history-heading">
            <ul className="divide-y divide-line border-y border-line text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {{ recorded: "Recorded", allocated: "Set against a charge", refunded: "Refund", failed: "Marked failed", void: "Marked void" }[e.action] ?? e.action}
                    {typeof e.detail.amount_pence === "number" ? ` · ${formatPence(e.detail.amount_pence)}` : ""}
                    {typeof e.detail.reason === "string" && e.detail.reason ? ` · ${e.detail.reason}` : ""}
                  </span>
                  <time dateTime={e.created_at} className="text-muted">
                    {formatStamp(e.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

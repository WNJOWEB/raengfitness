import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BILLING_WEEKS } from "@/content/memberships";
import { getClient } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { MEMBERSHIP_STATUS } from "@/lib/coach/labels";
import { listCharges } from "@/lib/coach/ledger";
import { creditsLine, getMembership, listPeriods } from "@/lib/coach/memberships";
import { formatPence } from "@/lib/coach/money";
import { PAYMENT_STATE_LABEL, paymentState } from "@/lib/coach/revenue";
import { formatDate } from "@/lib/coach/time";
import { Flash } from "@/components/coach/Flash";
import { ActionForm, Field, SubmitButton } from "@/components/coach/form";
import { Badge, Details, LoadError, Panel, TextLink } from "@/components/coach/ui";
import { membershipStatusAction } from "../actions";

export const metadata: Metadata = { title: "Membership" };

const DONE = { started: "Membership started: the first period, its credits and its charge are set up." };

export default function MembershipPage({ params, searchParams }: PageProps<"/coach/memberships/[id]">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/memberships">Memberships</TextLink>
      </p>
      <Suspense fallback={<CoachLoading />}>
        <MembershipView params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function MembershipView({ params, searchParams }: { params: PageProps<"/coach/memberships/[id]">["params"]; searchParams: PageProps<"/coach/memberships/[id]">["searchParams"] }) {
  const { db, today } = await portalContext();
  const { id } = await params;
  const query = await searchParams;
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const found = await getMembership(db, id);
  if (!found.ok) return <LoadError message={loadMessage(found.error)} />;
  if (!found.data) notFound();
  const m = found.data;
  const loaded = collect(await Promise.all([getClient(db, m.client_id), listPeriods(db, [m.id]), listCharges(db, { clientId: m.client_id })] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [client, periods, charges] = loaded.data;
  const current = periods.find((p) => p.period_start <= today && p.period_end >= today);

  return (
    <>
      <div className="mt-4 border-b border-ink pb-6">
        <p className="members-eyebrow">Membership</p>
        <h1 className="mt-2 text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance break-words">{client ? client.full_name : "Deleted client"}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span>
            {m.plan_name} · {formatPence(m.price_pence)} every {BILLING_WEEKS} weeks · {m.credits} credits
          </span>
          <Badge tone={m.status === "active" ? "strong" : "muted"}>{MEMBERSHIP_STATUS[m.status]}</Badge>
          {client ? <TextLink href={`/coach/clients/${client.id}`}>Client record</TextLink> : null}
        </p>
      </div>
      <Flash done={query.done} messages={DONE} />

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
        <Panel title="This period" id="current-heading">
          {current ? (
            <Details
              items={[
                ["Dates", `${formatDate(current.period_start)} to ${formatDate(current.period_end)}`],
                ["Credits", creditsLine(current)],
                ["Used", String(current.credits_used)],
              ]}
            />
          ) : (
            <p className="text-muted">No period covers today{m.status !== "active" ? ` (the membership is ${MEMBERSHIP_STATUS[m.status].toLowerCase()})` : ""}.</p>
          )}
          <p className="mt-4 text-sm text-muted">
            Credits are used from Classes: open a class and choose “Pay with a credit” beside the member. Cancelling 24 hours or more before the class gives the credit back; later, or not turning up, uses it.
          </p>
        </Panel>

        <Panel title="Details" id="details-heading">
          <Details
            items={[
              ["Started", formatDate(m.start_on)],
              ...(m.status === "active" ? ([["Next renewal", formatDate(m.next_period_on)]] as [string, string][]) : []),
              ...(m.cancelled_on ? ([["Cancelled", formatDate(m.cancelled_on)]] as [string, string][]) : []),
              ...(m.notes ? ([["Notes", <span key="n" className="whitespace-pre-line">{m.notes}</span>]] as [string, React.ReactNode][]) : []),
            ]}
          />
          {m.status !== "cancelled" ? (
            <div className="mt-6 grid grid-cols-1 gap-4">
              {m.status === "active" ? (
                <ActionForm action={membershipStatusAction} label="Pause membership">
                  <input type="hidden" name="membership" value={m.id} />
                  <input type="hidden" name="status" value="paused" />
                  <div>
                    <SubmitButton variant="secondary" pendingLabel="Pausing…">Pause renewals</SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <ActionForm action={membershipStatusAction} label="Resume membership">
                  <input type="hidden" name="membership" value={m.id} />
                  <input type="hidden" name="status" value="active" />
                  <Field name="on" label="Next period starts" type="date" defaultValue={today} />
                  <div>
                    <SubmitButton pendingLabel="Resuming…">Resume</SubmitButton>
                  </div>
                </ActionForm>
              )}
              <ActionForm action={membershipStatusAction} label="Cancel membership" confirm="Cancel this membership? No new periods or charges will be created. Credits already given stay usable in their period.">
                <input type="hidden" name="membership" value={m.id} />
                <input type="hidden" name="status" value="cancelled" />
                <Field name="on" label="Cancelled on" type="date" defaultValue={today} />
                <div>
                  <SubmitButton variant="secondary" pendingLabel="Cancelling…">Cancel membership</SubmitButton>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel title="Periods" id="periods-heading">
        {periods.length === 0 ? (
          <p className="text-muted">No periods yet.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {periods.map((p) => {
              const charge = charges.find((c) => c.id === p.charge_id);
              return (
                <li key={p.id} className="grid grid-cols-1 gap-1 py-3 md:grid-cols-[2fr_2fr_1fr] md:items-center md:gap-4">
                  <span className="font-semibold">
                    {formatDate(p.period_start)} to {formatDate(p.period_end)}
                  </span>
                  <span className="text-sm">{creditsLine(p)}</span>
                  <span className="text-sm md:text-right">
                    {charge ? `${formatPence(charge.amount_pence)} · ${PAYMENT_STATE_LABEL[paymentState(charge)]}` : "No charge"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

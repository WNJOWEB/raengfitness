import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPackage, getPtSession } from "@/lib/coach/bookings";
import { entityEvents, getClient } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { PT_STATUS } from "@/lib/coach/labels";
import { listCharges } from "@/lib/coach/ledger";
import { formatPence } from "@/lib/coach/money";
import { PAYMENT_STATE_LABEL, paymentState } from "@/lib/coach/revenue";
import { formatClock, formatDateTime, formatLongDate, formatStamp, minutesBetween, toLondon } from "@/lib/coach/time";
import type { PtStatus } from "@/lib/coach/types";
import { ActionForm, Field, SubmitButton, TextArea } from "@/components/coach/form";
import { Flash } from "@/components/coach/Flash";
import { Badge, Details, LoadError, Panel, TextLink } from "@/components/coach/ui";
import { ptNotesAction, rescheduleAction, setPtStatusAction } from "../actions";

export const metadata: Metadata = { title: "Session" };

export default function SessionPage({ params, searchParams }: PageProps<"/coach/sessions/[id]">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/sessions">PT sessions</TextLink>
      </p>
      <Suspense fallback={<CoachLoading />}>
        <SessionView params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const OUTCOMES: { status: PtStatus; label: string }[] = [
  { status: "attended", label: "Attended" },
  { status: "no_show", label: "No-show" },
  { status: "scheduled", label: "Back to scheduled" },
];

const DONE = {
  attended: "Marked attended.",
  no_show: "Marked as a no-show.",
  scheduled: "Back to scheduled.",
  cancelled: "Marked cancelled. An unpaid charge for it was cancelled too; a paid one stays as credit or can be refunded.",
  "cancelled-package": "Marked cancelled. The package place is given back.",
};

async function SessionView({ params, searchParams }: { params: PageProps<"/coach/sessions/[id]">["params"]; searchParams: PageProps<"/coach/sessions/[id]">["searchParams"] }) {
  const { db } = await portalContext();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const found = await getPtSession(db, id);
  if (!found.ok) return <LoadError message={loadMessage(found.error)} />;
  if (!found.data) notFound();
  const s = found.data;
  const loaded = collect(await Promise.all([getClient(db, s.client_id), listCharges(db, { ptSessionIds: [s.id] }), entityEvents(db, s.id)] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [client, charges, events] = loaded.data;
  const pkg = s.package_id ? await getPackage(db, s.package_id) : null;
  const charge = charges[0];
  const start = toLondon(s.starts_at);
  const minutes = minutesBetween(s.starts_at, s.ends_at);

  return (
    <>
      <div className="mt-4 border-b border-ink pb-6">
        <p className="members-eyebrow">One-to-one session</p>
        <h1 className="mt-2 text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">{formatLongDate(start.date)}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span>
            {formatClock(start.time)}–{formatClock(toLondon(s.ends_at).time)} with{" "}
            {client ? <TextLink href={`/coach/clients/${client.id}?tab=bookings`}>{client.full_name}</TextLink> : "a deleted client"}
          </span>
          <Badge tone={s.status === "scheduled" ? "plain" : "muted"}>{PT_STATUS[s.status]}</Badge>
        </p>
      </div>
      <Flash done={query.done} messages={DONE} />

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
        <Panel title="Details" id="details-heading">
          <Details
            items={[
              ["Length", `${minutes} minutes`],
              ["Price", s.package_id ? `From a package${pkg?.ok && pkg.data ? `: ${pkg.data.name} (${pkg.data.sessions_remaining} left)` : ""}` : s.price_pence !== null ? formatPence(s.price_pence) : "No charge"],
              ["Payment", s.package_id ? "Covered by the package" : charge ? `${PAYMENT_STATE_LABEL[paymentState(charge)]}${charge.outstanding_pence > 0 && !charge.voided_at ? ` (${formatPence(charge.outstanding_pence)} owed)` : ""}` : "No charge"],
              ["Requested", s.requested],
            ]}
          />
          {charge && !charge.voided_at && charge.outstanding_pence > 0 ? (
            <p className="mt-3">
              <TextLink href={`/coach/finances/payments/new?client=${s.client_id}&charge=${charge.id}`}>Record a payment for this session</TextLink>
            </p>
          ) : null}
          <div className="mt-6">
            <ActionForm action={ptNotesAction} label="Session notes">
              <input type="hidden" name="session" value={s.id} />
              <TextArea name="notes" label="Admin notes" defaultValue={s.notes} rows={3} maxLength={1000} />
              <div>
                <SubmitButton variant="secondary">Save notes</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Panel>

        <div>
          {s.status !== "cancelled" ? (
            <Panel title="Outcome" id="outcome-heading">
              <ActionForm action={setPtStatusAction} label="Session outcome" className="flex flex-wrap gap-2">
                <input type="hidden" name="session" value={s.id} />
                {OUTCOMES.filter((o) => o.status !== s.status).map((o) => (
                  <SubmitButton key={o.status} name="status" value={o.status} variant={o.status === "attended" ? "primary" : "secondary"}>
                    {o.label}
                  </SubmitButton>
                ))}
              </ActionForm>
            </Panel>
          ) : null}

          {s.status === "scheduled" ? (
            <Panel title="Reschedule" id="reschedule-heading">
              <ActionForm action={rescheduleAction} label="Reschedule">
                <input type="hidden" name="session" value={s.id} />
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                  <Field name="date" label="Date" type="date" defaultValue={start.date} required />
                  <Field name="time" label="Start" type="time" defaultValue={start.time} required />
                  <Field name="minutes" label="Minutes" type="number" inputMode="numeric" min={15} max={240} defaultValue={minutes} required />
                </div>
                <div>
                  <SubmitButton variant="secondary">Move session</SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          ) : null}

          {s.status !== "cancelled" ? (
            <Panel title="Cancel" id="cancel-heading">
              <ActionForm action={setPtStatusAction} confirm="Cancel this session?" label="Cancel session">
                <input type="hidden" name="session" value={s.id} />
                <input type="hidden" name="status" value="cancelled" />
                <Field name="reason" label="Reason" maxLength={300} />
                <p className="text-sm text-muted">{s.package_id ? "The package place is given back." : "An unpaid charge is cancelled too; a paid one stays as credit or can be refunded."}</p>
                <div>
                  <SubmitButton variant="secondary">Cancel session</SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          ) : null}

          <Panel title="History" id="history-heading">
            <ul className="divide-y divide-line border-y border-line text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {e.action === "rescheduled" && typeof e.detail.from === "string" ? `Moved from ${formatDateTime(e.detail.from)}` : PT_STATUS[e.action as PtStatus] ?? (e.action === "booked" ? "Booked" : e.action)}
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

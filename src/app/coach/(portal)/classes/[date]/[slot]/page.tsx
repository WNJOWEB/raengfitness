import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getClassSession, getDefaultCapacity, listAttendance } from "@/lib/coach/bookings";
import { CLASS_NAME, classDurationMinutes, defaultPrices, findSlot, isTimetableClass, occurrence } from "@/lib/coach/classes";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { ATTENDANCE_STATUS, REQUEST_STATUS } from "@/lib/coach/labels";
import { listCharges } from "@/lib/coach/ledger";
import { penceToInput } from "@/lib/coach/money";
import { listRequests } from "@/lib/coach/requests";
import { PAYMENT_STATE_LABEL, paymentState } from "@/lib/coach/revenue";
import { addMinutesIso, formatClock, formatLongDate, formatStamp, toLondon } from "@/lib/coach/time";
import type { AttendanceStatus } from "@/lib/coach/types";
import { ActionForm, Checkbox, Field, MoneyField, SelectField, SubmitButton, TextArea } from "@/components/coach/form";
import { Badge, EmptyState, LoadError, Panel, TextLink } from "@/components/coach/ui";
import { addAttendeeAction, cancelClassAction, setAttendanceAction, updateClassAction } from "../../actions";
import { payWithCreditAction, returnCreditAction } from "../../../memberships/actions";
import { creditsLine, periodsOn } from "@/lib/coach/memberships";

export const metadata: Metadata = { title: "Class" };

export default function ClassPage({ params }: PageProps<"/coach/classes/[date]/[slot]">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/classes">Classes</TextLink>
      </p>
      <Suspense fallback={<CoachLoading />}>
        <ClassView params={params} />
      </Suspense>
    </>
  );
}

const MARKS: { status: AttendanceStatus; label: string }[] = [
  { status: "attended", label: "Attended" },
  { status: "no_show", label: "No-show" },
  { status: "cancelled", label: "Cancelled" },
  { status: "booked", label: "Booked" },
];

async function ClassView({ params }: { params: PageProps<"/coach/classes/[date]/[slot]">["params"] }) {
  const { db, today } = await portalContext();
  const { date, slot: slotId } = await params;
  const slot = findSlot(slotId);
  // Only real timetable classes have a page: checked on the server.
  if (!slot || !isTimetableClass(date, slotId, today)) notFound();
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const occ = occurrence(date, slot);
  const ends = toLondon(addMinutesIso(occ.startsAt, classDurationMinutes(slot))).time;
  const loaded = collect(await Promise.all([getClassSession(db, slot.id, date), listRequests(db, { classDate: date, classSlot: slot.id }), listClients(db)] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [row, requests, clients] = loaded.data;
  const usualSize = await getDefaultCapacity(db);
  const size = row?.capacity ?? usualSize;
  const places = row ? await listAttendance(db, { sessionIds: [row.id] }) : { ok: true as const, data: [] };
  if (!places.ok) return <LoadError message={loadMessage(places.error)} />;
  const charges = places.data.length ? await listCharges(db, { attendanceIds: places.data.map((p) => p.id) }) : { ok: true as const, data: [] };
  if (!charges.ok) return <LoadError message={loadMessage(charges.error)} />;
  // Members with a period covering this class (for "Pay with a credit").
  const periods = await periodsOn(db, clients.filter((c) => c.status !== "former").map((c) => c.id), date);
  if (!periods.ok) return <LoadError message={loadMessage(periods.error)} />;
  const periodFor = (clientId: string) => periods.data.find((x) => x.client_id === clientId);

  const name = (id: string) => clients.find((c) => c.id === id)?.full_name ?? "Client";
  const pending = requests.filter((r) => r.status === "new" || r.status === "awaiting");
  const onList = new Set(places.data.map((p) => p.client_id));
  const addable = clients.filter((c) => !onList.has(c.id) && c.status !== "former").sort((a, b) => a.full_name.localeCompare(b.full_name));
  const booked = places.data.filter((p) => p.status === "booked" || p.status === "attended").length;
  const full = booked >= size;
  const classValue = `${date}|${slot.id}`;
  const cancelled = Boolean(row?.cancelled_at);

  return (
    <>
      <div className="mt-4 border-b border-ink pb-6">
        <p className="members-eyebrow">{CLASS_NAME}</p>
        <h1 className="mt-2 text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">{formatLongDate(date)}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span>
            {formatClock(slot.start)}–{formatClock(ends)}
          </span>
          <span className="tabular-nums">
            · {booked} of {size} booked
          </span>
          {cancelled ? <Badge tone="strong">Cancelled</Badge> : full ? <Badge tone="strong">Full</Badge> : null}
          {date < today ? <Badge tone="muted">Past</Badge> : null}
        </p>
      </div>

      {cancelled && row ? (
        <p role="note" className="mt-6 border-2 border-ink bg-white p-4 text-sm">
          <strong>You cancelled this class</strong> on {formatStamp(row.cancelled_at ?? "")}
          {row.cancel_reason ? `: ${row.cancel_reason}` : ""}. Members got their credits back and unpaid class charges were cancelled. It no longer shows on the booking calendar.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Attendees" id="attendees-heading">
            {places.data.length === 0 ? (
              <EmptyState title="Nobody booked yet.">Confirm a request or add someone below.</EmptyState>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {places.data.map((p) => {
                  const charge = charges.data.find((c) => c.attendance_id === p.id);
                  const state = paymentState(charge);
                  const onCredit = Boolean(p.membership_period_id);
                  const period = periodFor(p.client_id);
                  const canUseCredit = !onCredit && (p.status === "booked" || p.status === "attended") && period && period.credits_left > 0 && state !== "paid" && state !== "part";
                  const forfeited = onCredit && (p.status === "no_show" || (p.status === "cancelled" && p.late_cancel));
                  return (
                    <li key={p.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <TextLink href={`/coach/clients/${p.client_id}?tab=bookings`}>{name(p.client_id)}</TextLink>
                        <span className="flex flex-wrap gap-2">
                          <Badge tone={p.status === "attended" ? "strong" : p.status === "booked" ? "plain" : "muted"}>{ATTENDANCE_STATUS[p.status]}</Badge>
                          {onCredit ? (
                            <Badge tone="muted">{forfeited ? "Credit used (late or missed)" : p.status === "cancelled" ? "Credit returned" : "Membership credit"}</Badge>
                          ) : (
                            <Badge tone={state === "unpaid" || state === "part" ? "strong" : "muted"}>{PAYMENT_STATE_LABEL[state]}</Badge>
                          )}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ActionForm action={setAttendanceAction} label={`Attendance for ${name(p.client_id)}`} className="flex flex-wrap gap-2">
                          <input type="hidden" name="attendance" value={p.id} />
                          {MARKS.filter((m) => m.status !== p.status).map((m) => (
                            <SubmitButton key={m.status} name="status" value={m.status} variant="secondary" className="min-h-11 px-3 text-xs">
                              {m.label}
                            </SubmitButton>
                          ))}
                        </ActionForm>
                        {canUseCredit ? (
                          <ActionForm action={payWithCreditAction} label={`Pay with a credit for ${name(p.client_id)}`}>
                            <input type="hidden" name="attendance" value={p.id} />
                            <SubmitButton variant="secondary" className="min-h-11 px-3 text-xs">
                              Pay with a credit ({creditsLine(period)})
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {forfeited ? (
                          <ActionForm action={returnCreditAction} label={`Give the credit back to ${name(p.client_id)}`} confirm="Give the credit back? The place is marked cancelled.">
                            <input type="hidden" name="attendance" value={p.id} />
                            <SubmitButton variant="quiet" className="min-h-11 text-xs">
                              Give credit back
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {!onCredit && charge && (state === "unpaid" || state === "part") ? (
                          <TextLink href={`/coach/finances/payments/new?client=${p.client_id}&charge=${charge.id}`} className="text-sm">
                            Record payment
                          </TextLink>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {pending.length ? (
            <Panel title="Requests for this class" id="pending-heading">
              <ul className="divide-y divide-line border-y border-line text-sm">
                {pending.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <TextLink href={`/coach/requests/${r.id}`}>{r.name}</TextLink>
                    <span className="text-muted">
                      {REQUEST_STATUS[r.status]} · {formatStamp(r.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div>
          {cancelled ? null : (
            <Panel title="Add someone" id="walk-in-heading">
              {addable.length ? (
                <ActionForm action={addAttendeeAction} label="Add someone to this class">
                  <input type="hidden" name="class" value={classValue} />
                  <SelectField name="client" label="Client" required placeholder="Choose a client" options={addable.map((c) => ({ value: c.id, label: c.full_name }))} />
                  <MoneyField name="price" label="Price" defaultValue={penceToInput(defaultPrices().classPence)} required hint="0 for a free place." />
                  <Checkbox name="credit" label="Pay with their membership credit" hint="For members: no class charge; one credit from their current period is used." />
                  <div>
                    <SubmitButton variant="secondary">Add to class</SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-sm text-muted">
                  Everyone is already on the list. <TextLink href="/coach/clients/new">Add a client</TextLink> first.
                </p>
              )}
            </Panel>
          )}
          <Panel title="Class settings" id="settings-heading">
            <ActionForm action={updateClassAction} label="Class settings">
              <input type="hidden" name="class" value={classValue} />
              <Field name="capacity" label="Capacity" type="number" inputMode="numeric" min={1} max={200} defaultValue={row?.capacity_set ?? ""} hint={`Leave empty to use the usual class size (${usualSize}).`} />
              <TextArea name="notes" label="Admin notes" defaultValue={row?.notes ?? ""} rows={3} maxLength={1000} />
              <div>
                <SubmitButton variant="secondary">Save</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
          {!cancelled && date >= today ? (
            <Panel title="Cancel this class" id="cancel-heading">
              <ActionForm
                action={cancelClassAction}
                label="Cancel this class"
                confirm={`Cancel this class for everyone? ${booked} booked ${booked === 1 ? "place is" : "places are"} cancelled, members get their credit back, and unpaid class charges are cancelled. This can't be undone.`}
              >
                <input type="hidden" name="class" value={classValue} />
                <p className="text-sm text-muted">For a class you can&apos;t run. Members always get their credit back, however close to the class. Let each person know yourself.</p>
                <TextArea name="reason" label="Reason (for your records)" rows={2} maxLength={500} />
                <div>
                  <SubmitButton variant="secondary" pendingLabel="Cancelling…">Cancel class</SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

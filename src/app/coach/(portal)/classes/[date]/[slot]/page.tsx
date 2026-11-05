import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getClassSession, listAttendance } from "@/lib/coach/bookings";
import { CLASS_NAME, classCapacity, classDurationMinutes, defaultPrices, findSlot, isTimetableClass, occurrence } from "@/lib/coach/classes";
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
import { ActionForm, Field, MoneyField, SelectField, SubmitButton, TextArea } from "@/components/coach/form";
import { Badge, EmptyState, LoadError, Panel, TextLink } from "@/components/coach/ui";
import { addAttendeeAction, setAttendanceAction, updateClassAction } from "../../actions";

export const metadata: Metadata = { title: "Class" };

export default function ClassPage({ params }: PageProps<"/coach/classes/[date]/[slot]">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/classes">← Classes</TextLink>
      </p>
      <Suspense fallback={<p className="mt-8 text-muted">Loading the class…</p>}>
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
  const places = row ? await listAttendance(db, { sessionIds: [row.id] }) : { ok: true as const, data: [] };
  if (!places.ok) return <LoadError message={loadMessage(places.error)} />;
  const charges = places.data.length ? await listCharges(db, { attendanceIds: places.data.map((p) => p.id) }) : { ok: true as const, data: [] };
  if (!charges.ok) return <LoadError message={loadMessage(charges.error)} />;

  const name = (id: string) => clients.find((c) => c.id === id)?.full_name ?? "Client";
  const pending = requests.filter((r) => r.status === "new" || r.status === "awaiting");
  const onList = new Set(places.data.map((p) => p.client_id));
  const addable = clients.filter((c) => !onList.has(c.id) && c.status !== "former").sort((a, b) => a.full_name.localeCompare(b.full_name));
  const booked = places.data.filter((p) => p.status === "booked" || p.status === "attended").length;
  const full = booked >= classCapacity(row);
  const classValue = `${date}|${slot.id}`;

  return (
    <>
      <div className="mt-4 border-b border-ink pb-6">
        <p className="eyebrow text-muted">{CLASS_NAME}</p>
        <h1 className="mt-2 font-display text-h2">{formatLongDate(date)}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span>
            {formatClock(slot.start)}–{formatClock(ends)}
          </span>
          <span className="tabular-nums">
            · {booked}
            {` of ${classCapacity(row)}`} booked
          </span>
          {full ? <Badge tone="strong">Full</Badge> : null}
          {date < today ? <Badge tone="muted">Past</Badge> : null}
        </p>
      </div>

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
                  return (
                    <li key={p.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <TextLink href={`/coach/clients/${p.client_id}?tab=bookings`}>{name(p.client_id)}</TextLink>
                        <span className="flex flex-wrap gap-2">
                          <Badge tone={p.status === "attended" ? "strong" : p.status === "booked" ? "plain" : "muted"}>{ATTENDANCE_STATUS[p.status]}</Badge>
                          <Badge tone={state === "unpaid" || state === "part" ? "strong" : "muted"}>{PAYMENT_STATE_LABEL[state]}</Badge>
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
                        {charge && (state === "unpaid" || state === "part") ? (
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
          <Panel title="Add someone" id="add-heading">
            {addable.length ? (
              <ActionForm action={addAttendeeAction} label="Add someone to this class">
                <input type="hidden" name="class" value={classValue} />
                <SelectField name="client" label="Client" required placeholder="Choose a client" options={addable.map((c) => ({ value: c.id, label: c.full_name }))} />
                <MoneyField name="price" label="Price" defaultValue={penceToInput(defaultPrices().classPence)} required hint="0 for a free place." />
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
          <Panel title="Class settings" id="settings-heading">
            <ActionForm action={updateClassAction} label="Class settings">
              <input type="hidden" name="class" value={classValue} />
              <Field name="capacity" label="Capacity" type="number" inputMode="numeric" min={1} max={200} defaultValue={row?.capacity ?? ""} hint="Leave empty to use the usual capacity (15)." />
              <TextArea name="notes" label="Admin notes" defaultValue={row?.notes ?? ""} rows={3} maxLength={1000} />
              <div>
                <SubmitButton variant="secondary">Save</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}

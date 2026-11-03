import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { classSessionsByIds, listAttendance, listPackages, listPtSessions } from "@/lib/coach/bookings";
import { classOccurrences, defaultPrices, slotLabel } from "@/lib/coach/classes";
import { clientBalances, clientEvents, getClient, listConsents, listFollowUps } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect, type Db } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { ATTENDANCE_STATUS, CLIENT_STATUS, CONSENT_KIND, CONTACT_METHOD, MEMBERSHIP_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, PT_STATUS, REQUEST_STATUS, SERVICE, SUBSCRIPTION_STATUS } from "@/lib/coach/labels";
import { BILLING_WEEKS } from "@/content/memberships";
import { creditsLine, listMemberships, listPeriods } from "@/lib/coach/memberships";
import { listCharges, listPayments } from "@/lib/coach/ledger";
import { formatPence, penceToInput } from "@/lib/coach/money";
import { listCheckIns, listSubscriptions } from "@/lib/coach/online";
import { listRequests } from "@/lib/coach/requests";
import { PAYMENT_STATE_LABEL, paymentState } from "@/lib/coach/revenue";
import { addDays, formatDate, formatDateTime, formatStamp } from "@/lib/coach/time";
import { stripeConfig } from "@/lib/stripe/config";
import { listOpenLinks } from "@/lib/stripe/sync";
import type { ActivityEvent, Client } from "@/lib/coach/types";
import { ClientFields } from "@/components/coach/ClientFields";
import { ActionForm, Field, MoneyField, SelectField, SubmitButton, TextArea } from "@/components/coach/form";
import { ActionLink, Badge, EmptyState, FilterLinks, LoadError, Metric, Panel, TextLink } from "@/components/coach/ui";
import { addAttendeeAction } from "../../classes/actions";
import {
  addChargeAction,
  addConsentAction,
  addFollowUpAction,
  addPackageAction,
  cancelPackageAction,
  deleteClientAction,
  toggleFollowUpAction,
  stripeLinkAction,
  updateClientAction,
  voidChargeAction,
  withdrawConsentAction,
} from "../actions";

export const metadata: Metadata = { title: "Client" };

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "bookings", label: "Bookings" },
  { value: "membership", label: "Membership" },
  { value: "payments", label: "Payments" },
  { value: "packages", label: "Packages" },
  { value: "online", label: "Online coaching" },
  { value: "notes", label: "Notes & check-ins" },
  { value: "follow-ups", label: "Follow-ups" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export default function ClientPage({ params, searchParams }: PageProps<"/coach/clients/[id]">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/clients">Clients</TextLink>
      </p>
      <Suspense fallback={<CoachLoading />}>
        <ClientView params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ClientView({ params, searchParams }: { params: PageProps<"/coach/clients/[id]">["params"]; searchParams: PageProps<"/coach/clients/[id]">["searchParams"] }) {
  const { db, today } = await portalContext();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab: Tab = TABS.some((t) => t.value === query.tab) ? (query.tab as Tab) : "overview";
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const found = await getClient(db, id);
  if (!found.ok) return <LoadError message={loadMessage(found.error)} />;
  if (!found.data) notFound();
  const client = found.data;
  const balances = await clientBalances(db, [client.id]);
  const balance = balances.ok ? balances.data.get(client.id) : undefined;

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 border-b border-ink pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow text-muted">Client since {formatDate(client.created_at.slice(0, 10))}</p>
          <h1 className="mt-2 font-display text-h2 break-words">{client.full_name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Badge tone={client.status === "active" ? "strong" : "plain"}>{CLIENT_STATUS[client.status]}</Badge>
            {client.email ? (
              <a href={`mailto:${client.email}`} className="break-all underline underline-offset-4">
                {client.email}
              </a>
            ) : null}
            {client.phone ? (
              <a href={`tel:${client.phone.replace(/\s+/g, "")}`} className="underline underline-offset-4">
                {client.phone}
              </a>
            ) : null}
            {client.instagram ? <span>@{client.instagram}</span> : null}
            {client.preferred_contact ? <span className="text-muted">Prefers {CONTACT_METHOD[client.preferred_contact].toLowerCase()}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionLink href={`/coach/finances/payments/new?client=${client.id}`} variant="primary">
            Record payment
          </ActionLink>
          <ActionLink href={`/coach/sessions/new?client=${client.id}`}>Book one-to-one</ActionLink>
        </div>
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Money">
        <li>
          <Metric label="Total received" value={formatPence(balance?.received_pence ?? 0)} note="All time, after refunds" />
        </li>
        <li>
          <Metric emphasis={(balance?.outstanding_pence ?? 0) > 0} label="Outstanding" value={formatPence(balance?.outstanding_pence ?? 0)} note="Due now" />
        </li>
        <li>
          <Metric label="Due later" value={formatPence(balance?.due_later_pence ?? 0)} note="Not yet due" />
        </li>
        <li>
          <Metric label="Credit" value={formatPence(balance?.credit_pence ?? 0)} note="Paid, not yet used" />
        </li>
      </ul>

      <div className="mt-8">
        <FilterLinks label="Client record" current={tab} items={TABS.map((t) => ({ value: t.value, label: t.label, href: `/coach/clients/${client.id}?tab=${t.value}` }))} />
      </div>

      {tab === "overview" ? <Overview db={db} client={client} today={today} /> : null}
      {tab === "bookings" ? <Bookings db={db} client={client} today={today} /> : null}
      {tab === "membership" ? <Memberships db={db} client={client} today={today} /> : null}
      {tab === "payments" ? <Payments db={db} client={client} today={today} /> : null}
      {tab === "packages" ? <Packages db={db} client={client} today={today} /> : null}
      {tab === "online" ? <Online db={db} client={client} /> : null}
      {tab === "notes" ? <Notes db={db} client={client} /> : null}
      {tab === "follow-ups" ? <FollowUps db={db} client={client} today={today} /> : null}
    </>
  );
}

type TabProps = { db: Db; client: Client; today: string };

async function Overview({ db, client, today }: TabProps) {
  const loaded = collect(await Promise.all([listConsents(db, client.id), clientEvents(db, client.id, 30)] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [consents, events] = loaded.data;
  return (
    <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
      <Panel title="Details" id="details-heading">
        <ActionForm action={updateClientAction} label="Client details">
          <input type="hidden" name="client" value={client.id} />
          <ClientFields client={client} />
          <div>
            <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
      <div>
        <Panel title="Consent records" id="consent-heading">
          {consents.length ? (
            <ul className="divide-y divide-line border-y border-line text-sm">
              {consents.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <strong>{CONSENT_KIND[c.kind]}</strong> · {formatDate(c.given_on)}
                    {c.source ? ` · ${c.source}` : ""}
                    {c.withdrawn_on ? <span className="block text-muted">Withdrawn {formatDate(c.withdrawn_on)}</span> : null}
                  </span>
                  {!c.withdrawn_on ? (
                    <ActionForm action={withdrawConsentAction} confirm="Record that this consent was withdrawn?" label={`Withdraw ${CONSENT_KIND[c.kind]}`}>
                      <input type="hidden" name="client" value={client.id} />
                      <input type="hidden" name="consent" value={c.id} />
                      <SubmitButton variant="quiet">Withdrawn</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None recorded.</p>
          )}
          <details className="mt-4">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">Record consent</summary>
            <div className="mt-3">
              <ActionForm action={addConsentAction} resetOnSuccess label="Record consent">
                <input type="hidden" name="client" value={client.id} />
                <SelectField name="kind" label="They agreed to" required options={Object.entries(CONSENT_KIND).map(([value, label]) => ({ value, label }))} />
                <Field name="given_on" label="Date" type="date" defaultValue={today} max={today} required />
                <Field name="source" label="How" hint="e.g. by email, in person" maxLength={200} />
                <div>
                  <SubmitButton variant="secondary">Record consent</SubmitButton>
                </div>
              </ActionForm>
            </div>
          </details>
        </Panel>
        <Panel title="Activity" id="activity-heading">
          <ActivityList events={events} />
        </Panel>
        <Panel title="Remove" id="remove-heading">
          <p className="text-sm text-muted">Only for records added by mistake with no bookings or payments. Otherwise set the status to Former, so their history is kept.</p>
          <div className="mt-3">
            <ActionForm action={deleteClientAction} confirm={`Delete ${client.full_name}'s record? This can't be undone.`} label="Delete client">
              <input type="hidden" name="client" value={client.id} />
              <div>
                <SubmitButton variant="secondary">Delete client</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Panel>
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  confirmed: "Request confirmed",
  booked: "Booked",
  recorded: "Payment recorded",
  allocated: "Payment set against a charge",
  refunded: "Refund",
  voided: "Charge cancelled",
  failed: "Payment failed",
  void: "Payment voided",
  rescheduled: "Rescheduled",
  attended: "Attended",
  no_show: "No-show",
  cancelled: "Cancelled",
  scheduled: "Back to scheduled",
  sold: "Package sold",
  charged: "Subscription charged",
};

function ActivityList({ events }: { events: ActivityEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ul className="divide-y divide-line border-y border-line text-sm">
      {events.map((e) => {
        const amount = typeof e.detail.amount_pence === "number" ? ` · ${formatPence(e.detail.amount_pence)}` : "";
        const note = typeof e.detail.reason === "string" && e.detail.reason ? ` · ${e.detail.reason}` : "";
        return (
          <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
            <span>
              {EVENT_LABEL[e.action] ?? e.action}
              <span className="text-muted">
                {" "}
                ({e.entity.replace("_", " ")}){amount}
                {note}
              </span>
            </span>
            <time className="text-muted" dateTime={e.created_at}>
              {formatStamp(e.created_at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

async function Bookings({ db, client, today }: TabProps) {
  const loaded = collect(
    await Promise.all([listRequests(db, { clientId: client.id }), listAttendance(db, { clientId: client.id }), listPtSessions(db, { clientId: client.id, order: "desc" }), listCharges(db, { clientId: client.id })] as const),
  );
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [requests, places, sessions, charges] = loaded.data;
  const classRows = places.length ? await classSessionsByIds(db, [...new Set(places.map((p) => p.class_session_id))]) : { ok: true as const, data: [] };
  if (!classRows.ok) return <LoadError message={loadMessage(classRows.error)} />;
  const placeRows = places
    .map((p) => ({ place: p, cls: classRows.data.find((c) => c.id === p.class_session_id) }))
    .sort((a, b) => (b.cls?.starts_at ?? "").localeCompare(a.cls?.starts_at ?? ""));
  const prices = defaultPrices();
  const options = classOccurrences(addDays(today, -28), addDays(today, 56)).map((o) => ({ value: `${o.date}|${o.slot.id}`, label: `${formatDate(o.date)}, ${slotLabel(o.slot).split(" ").slice(1).join(" ")}` }));
  const next = classOccurrences(today, addDays(today, 7))[0];

  return (
    <>
      <Panel title="Group classes" id="classes-heading">
        {placeRows.length ? (
          <ul className="divide-y divide-line border-y border-line text-sm">
            {placeRows.map(({ place, cls }) => {
              const charge = charges.find((c) => c.attendance_id === place.id);
              return (
                <li key={place.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  {cls ? <TextLink href={`/coach/classes/${cls.class_date}/${cls.slot}`}>{formatDateTime(cls.starts_at)}</TextLink> : <span>Class</span>}
                  <span className="flex flex-wrap gap-2">
                    <Badge tone={place.status === "booked" ? "plain" : "muted"}>{ATTENDANCE_STATUS[place.status]}</Badge>
                    <Badge tone={paymentState(charge) === "unpaid" ? "strong" : "muted"}>{PAYMENT_STATE_LABEL[paymentState(charge)]}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No classes yet.</p>
        )}
        <details className="mt-4">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">Add to a class</summary>
          <div className="mt-3 max-w-xl">
            <ActionForm action={addAttendeeAction} label="Add to a class">
              <input type="hidden" name="client" value={client.id} />
              <SelectField name="class" label="Class" required options={options} defaultValue={next ? `${next.date}|${next.slot.id}` : undefined} />
              <MoneyField name="price" label="Price" defaultValue={penceToInput(prices.classPence)} required hint="0 for a free place." />
              <div>
                <SubmitButton variant="secondary">Add to class</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </details>
      </Panel>

      <Panel title="One-to-one sessions" id="pt-heading" actions={<TextLink href={`/coach/sessions/new?client=${client.id}`}>Book a session</TextLink>}>
        {sessions.length ? (
          <ul className="divide-y divide-line border-y border-line text-sm">
            {sessions.map((s) => {
              const charge = charges.find((c) => c.pt_session_id === s.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <TextLink href={`/coach/sessions/${s.id}`}>{formatDateTime(s.starts_at)}</TextLink>
                  <span className="flex flex-wrap gap-2">
                    <Badge tone={s.status === "scheduled" ? "plain" : "muted"}>{PT_STATUS[s.status]}</Badge>
                    <Badge tone="muted">{s.package_id ? "Package" : PAYMENT_STATE_LABEL[paymentState(charge)]}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No one-to-one sessions yet.</p>
        )}
      </Panel>

      <Panel title="Requests" id="requests-heading">
        {requests.length ? (
          <ul className="divide-y divide-line border-y border-line text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <TextLink href={`/coach/requests/${r.id}`}>{[r.service, r.summary].filter(Boolean).join(": ")}</TextLink>
                <span className="text-muted">
                  {REQUEST_STATUS[r.status] ?? r.status} · {formatStamp(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No requests linked.</p>
        )}
      </Panel>
    </>
  );
}

async function Payments({ db, client, today }: TabProps) {
  const loaded = collect(await Promise.all([listCharges(db, { clientId: client.id }), listPayments(db, { clientId: client.id })] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [charges, payments] = loaded.data;
  const sorted = [...charges].sort((a, b) => b.due_on.localeCompare(a.due_on));
  // Card payments by Stripe link, only when Stripe is configured for this deployment.
  const stripe = stripeConfig();
  const links = stripe ? new Map((await listOpenLinks(db, client.id)).map((l) => [l.charge_id, l])) : new Map<string, never>();
  return (
    <>
      <Panel title="Charges" id="charges-heading" actions={<TextLink href={`/coach/finances/payments/new?client=${client.id}`}>Record a payment</TextLink>}>
        {sorted.length ? (
          <ul className="divide-y divide-line border-y border-line text-sm">
            {sorted.map((c) => {
              const state = c.voided_at ? "Cancelled" : PAYMENT_STATE_LABEL[paymentState(c)];
              return (
                <li key={c.id} className="grid grid-cols-1 gap-2 py-3 md:grid-cols-[2fr_1fr_1fr] md:items-center">
                  <span>
                    <span className="font-semibold">{c.description}</span>
                    <span className="block text-muted">
                      {SERVICE[c.service]} · due {formatDate(c.due_on)}
                      {c.voided_at && c.void_reason ? ` · ${c.void_reason}` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {formatPence(c.amount_pence)}
                    {!c.voided_at && c.paid_pence > 0 && c.outstanding_pence > 0 ? <span className="block text-muted">{formatPence(c.outstanding_pence)} left</span> : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 md:justify-end">
                    <Badge tone={!c.voided_at && c.outstanding_pence > 0 && c.due_on <= today ? "strong" : "muted"}>{state}</Badge>
                    {!c.voided_at ? (
                      <>
                        {c.outstanding_pence > 0 ? <TextLink href={`/coach/finances/payments/new?client=${client.id}&charge=${c.id}`}>Pay</TextLink> : null}
                        {stripe && c.outstanding_pence > 0 ? (
                          links.get(c.id) ? (
                            <a href={links.get(c.id)!.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">
                              Card link{stripe.environment === "sandbox" ? " (test)" : ""}
                              <span className="sr-only"> for {formatPence(links.get(c.id)!.amount_pence)} (opens Stripe in a new tab)</span>
                            </a>
                          ) : (
                            <ActionForm action={stripeLinkAction} label="Create a card payment link">
                              <input type="hidden" name="charge" value={c.id} />
                              <SubmitButton variant="secondary">Card link</SubmitButton>
                            </ActionForm>
                          )
                        ) : null}
                        <details>
                          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">Cancel</summary>
                          <div className="mt-2 w-64">
                            <ActionForm action={voidChargeAction} confirm="Cancel this charge? Anything paid towards it becomes credit." label="Cancel charge">
                              <input type="hidden" name="charge" value={c.id} />
                              <Field name="reason" label="Reason" required maxLength={300} />
                              <div>
                                <SubmitButton variant="secondary">Cancel charge</SubmitButton>
                              </div>
                            </ActionForm>
                          </div>
                        </details>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No charges yet.">Class places, sessions, packages and subscriptions add their charges automatically.</EmptyState>
        )}
        <details className="mt-4">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">Add a charge by hand</summary>
          <div className="mt-3 max-w-xl">
            <ActionForm action={addChargeAction} resetOnSuccess label="Add a charge">
              <input type="hidden" name="client" value={client.id} />
              <SelectField name="service" label="Service" required options={Object.entries(SERVICE).map(([value, label]) => ({ value, label }))} />
              <Field name="description" label="What it's for" required maxLength={200} />
              <MoneyField name="amount" label="Amount" required />
              <Field name="due_on" label="Due" type="date" defaultValue={today} required />
              <div>
                <SubmitButton variant="secondary">Add charge</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </details>
      </Panel>

      <Panel title="Payments" id="payments-heading">
        {payments.length ? (
          <ul className="divide-y divide-line border-y border-line text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <TextLink href={`/coach/finances/payments/${p.id}`}>{formatPence(p.amount_pence)}</TextLink> · {formatDate(p.paid_on)} · {PAYMENT_METHOD[p.method]}{p.provider === "stripe" ? " (Stripe)" : p.provider === "stripe_test" || p.provider === "square_sandbox" ? " (Stripe test)" : ""} · {SERVICE[p.service]}
                  {p.refunded_pence ? <span className="block text-muted">{formatPence(p.refunded_pence)} refunded</span> : null}
                  {p.status === "received" && p.unallocated_pence > 0 ? <span className="block text-muted">{formatPence(p.unallocated_pence)} not yet set against a charge</span> : null}
                </span>
                <Badge tone={p.status === "received" ? "muted" : "strong"}>{PAYMENT_STATUS[p.status]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No payments recorded.</p>
        )}
      </Panel>
    </>
  );
}

async function Packages({ db, client, today }: TabProps) {
  const loaded = collect(await Promise.all([listPackages(db, { clientId: client.id }), listCharges(db, { clientId: client.id })] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [packages, charges] = loaded.data;
  const prices = defaultPrices();
  return (
    <Panel title="Packages" id="packages-heading">
      {packages.length ? (
        <ul className="divide-y divide-line border-y border-line text-sm">
          {packages.map((k) => {
            const charge = charges.find((c) => c.package_id === k.id);
            return (
              <li key={k.id} className="grid grid-cols-1 gap-2 py-3 md:grid-cols-[2fr_2fr_1fr] md:items-center">
                <span>
                  <span className="font-semibold">{k.name}</span>
                  <span className="block text-muted">
                    Bought {formatDate(k.purchased_on)} · {formatPence(k.price_pence)}
                    {k.expires_on ? ` · expires ${formatDate(k.expires_on)}` : ""}
                  </span>
                </span>
                <span>
                  <strong>{k.sessions_remaining}</strong> of {k.sessions_total} left · {k.sessions_delivered} delivered
                  <span className="block text-muted">Payment: {charge ? PAYMENT_STATE_LABEL[paymentState(charge)] : "no charge"}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 md:justify-end">
                  {k.status === "cancelled" ? (
                    <Badge tone="muted">Cancelled</Badge>
                  ) : (
                    <ActionForm action={cancelPackageAction} confirm="Cancel this package? Its remaining sessions can't be used." label={`Cancel ${k.name}`}>
                      <input type="hidden" name="package" value={k.id} />
                      <SubmitButton variant="quiet">Cancel package</SubmitButton>
                    </ActionForm>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No packages.</p>
      )}
      <div className="mt-6 max-w-xl">
        <h3 className="text-base font-bold">Add a package</h3>
        <div className="mt-3">
          <ActionForm action={addPackageAction} resetOnSuccess label="Add a package">
            <input type="hidden" name="client" value={client.id} />
            <Field name="name" label="Name" defaultValue={`${prices.packageSessions} one-to-one sessions`} required maxLength={100} />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field name="sessions" label="Sessions" type="number" inputMode="numeric" min={1} max={100} defaultValue={prices.packageSessions} required />
              <MoneyField name="price" label="Price" defaultValue={penceToInput(prices.packagePence)} required hint="A charge for this is added." />
              <Field name="purchased_on" label="Bought on" type="date" defaultValue={today} required />
              <Field name="expires_on" label="Expires" type="date" />
            </div>
            <div>
              <SubmitButton variant="secondary">Add package</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </div>
    </Panel>
  );
}

async function Memberships({ db, client, today }: TabProps) {
  const memberships = await listMemberships(db, { clientId: client.id });
  if (!memberships.ok) return <LoadError message={loadMessage(memberships.error)} />;
  const periods = memberships.data.length ? await listPeriods(db, memberships.data.map((m) => m.id)) : { ok: true as const, data: [] };
  if (!periods.ok) return <LoadError message={loadMessage(periods.error)} />;
  const hasCurrent = memberships.data.some((m) => m.status !== "cancelled");
  return (
    <Panel
      title="Membership"
      id="membership-heading"
      actions={hasCurrent ? undefined : <TextLink href={`/coach/memberships/new?client=${client.id}`}>Start a membership</TextLink>}
    >
      {memberships.data.length ? (
        <ul className="divide-y divide-line border-y border-line text-sm">
          {memberships.data.map((m) => {
            const current = periods.data.find((p) => p.membership_id === m.id && p.period_start <= today && p.period_end >= today);
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <TextLink href={`/coach/memberships/${m.id}`}>{m.plan_name}</TextLink> · {formatPence(m.price_pence)} every {BILLING_WEEKS} weeks · {m.credits} credits
                  <span className="block text-muted">
                    {current ? `${creditsLine(current)} until ${formatDate(current.period_end)}` : "No period covers today"}
                    {m.status === "active" ? ` · renews ${formatDate(m.next_period_on)}` : ""}
                  </span>
                </span>
                <Badge tone={m.status === "active" ? "strong" : "muted"}>{MEMBERSHIP_STATUS[m.status]}</Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">Not a member. Classes are pay as you go.</p>
      )}
    </Panel>
  );
}

async function Online({ db, client }: Omit<TabProps, "today">) {
  const subs = await listSubscriptions(db, { clientId: client.id });
  if (!subs.ok) return <LoadError message={loadMessage(subs.error)} />;
  return (
    <Panel title="Online coaching" id="online-heading" actions={<TextLink href={`/coach/online/new?client=${client.id}`}>Set up online coaching</TextLink>}>
      {subs.data.length ? (
        <ul className="divide-y divide-line border-y border-line text-sm">
          {subs.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span>
                <TextLink href={`/coach/online/${s.id}`}>{s.plan}</TextLink> · {formatPence(s.price_pence)}/month
                <span className="block text-muted">
                  From {formatDate(s.start_on)}
                  {s.renews_on ? ` · renews ${formatDate(s.renews_on)}` : ""}
                  {s.next_check_in_on ? ` · next check-in ${formatDate(s.next_check_in_on)}` : ""}
                </span>
              </span>
              <Badge tone={s.status === "active" ? "strong" : "muted"}>{SUBSCRIPTION_STATUS[s.status]}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Not an online coaching client.</p>
      )}
    </Panel>
  );
}

async function Notes({ db, client }: Omit<TabProps, "today">) {
  const subs = await listSubscriptions(db, { clientId: client.id });
  if (!subs.ok) return <LoadError message={loadMessage(subs.error)} />;
  const checkIns = subs.data.length ? await listCheckIns(db, { subscriptionIds: subs.data.map((s) => s.id), limit: 50 }) : { ok: true as const, data: [] };
  if (!checkIns.ok) return <LoadError message={loadMessage(checkIns.error)} />;
  return (
    <>
      <Panel title="Admin notes" id="notes-heading" actions={<TextLink href={`/coach/clients/${client.id}?tab=overview`}>Edit</TextLink>}>
        {client.notes ? <p className="whitespace-pre-line">{client.notes}</p> : <p className="text-sm text-muted">No notes.</p>}
      </Panel>
      <Panel title="Check-ins" id="checkins-heading">
        {checkIns.data.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {checkIns.data.map((c) => (
              <li key={c.id} className="py-3">
                <p className="text-sm font-semibold">
                  {formatDate(c.checked_in_on)} · <Link href={`/coach/online/${c.subscription_id}`} className="underline underline-offset-4">{subs.data.find((s) => s.id === c.subscription_id)?.plan ?? "Plan"}</Link>
                </p>
                <p className="mt-1 whitespace-pre-line">{c.summary}</p>
                {c.actions ? <p className="mt-1 text-sm whitespace-pre-line text-muted">Agreed: {c.actions}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No check-ins yet. They&apos;re logged from the client&apos;s online coaching plan.</p>
        )}
      </Panel>
    </>
  );
}

async function FollowUps({ db, client, today }: TabProps) {
  const items = await listFollowUps(db, { clientId: client.id });
  if (!items.ok) return <LoadError message={loadMessage(items.error)} />;
  const open = items.data.filter((f) => !f.done_at);
  const done = items.data.filter((f) => f.done_at).slice(0, 20);
  return (
    <Panel title="Follow-ups" id="follow-heading">
      {open.length ? (
        <ul className="divide-y divide-line border-y border-line text-sm">
          {open.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong>{formatDate(f.due_on)}</strong>
                {f.due_on < today ? " (overdue)" : ""} · {f.note}
              </span>
              <ActionForm action={toggleFollowUpAction} label={`Mark done: ${f.note}`}>
                <input type="hidden" name="client" value={client.id} />
                <input type="hidden" name="follow_up" value={f.id} />
                <input type="hidden" name="done" value="true" />
                <SubmitButton variant="secondary">Done</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing to follow up.</p>
      )}
      <div className="mt-6 max-w-xl">
        <ActionForm action={addFollowUpAction} resetOnSuccess label="Add a follow-up">
          <input type="hidden" name="client" value={client.id} />
          <Field name="due_on" label="When" type="date" defaultValue={addDays(today, 7)} required />
          <TextArea name="note" label="What to do" rows={2} maxLength={500} required />
          <div>
            <SubmitButton variant="secondary">Add follow-up</SubmitButton>
          </div>
        </ActionForm>
      </div>
      {done.length ? (
        <div className="mt-8">
          <h3 className="text-sm font-semibold">Done</h3>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm text-muted">
            {done.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {formatDate(f.due_on)} · {f.note}
                </span>
                <ActionForm action={toggleFollowUpAction} label={`Reopen: ${f.note}`}>
                  <input type="hidden" name="client" value={client.id} />
                  <input type="hidden" name="follow_up" value={f.id} />
                  <input type="hidden" name="done" value="false" />
                  <SubmitButton variant="quiet">Reopen</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

import { Suspense } from "react";
import { referenceFor } from "@/lib/reference";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDefaultCapacity, listAttendance, listClassSessions, listPackages, listPtSessions, classSessionsByIds } from "@/lib/coach/bookings";
import { classOccurrences, defaultPrices, findSlot, slotLabel } from "@/lib/coach/classes";
import { listClients } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { ATTENDANCE_STATUS, PT_STATUS, REQUEST_STATUS } from "@/lib/coach/labels";
import { matchClients } from "@/lib/coach/matching";
import { penceToInput } from "@/lib/coach/money";
import { decisionMessage, mailtoLink } from "@/lib/coach/notify";
import { getRequest, relatedRequests, requestDetails } from "@/lib/coach/requests";
import { addDays, formatDate, formatDateTime, formatStamp } from "@/lib/coach/time";
import type { BookingRequest, Client } from "@/lib/coach/types";
import { ActionForm, Checkbox, Field, MoneyField, RadioGroup, SelectField, SubmitButton, TextArea } from "@/components/coach/form";
import { creditsLine, periodOn } from "@/lib/coach/memberships";
import { Flash } from "@/components/coach/Flash";
import { ActionLink, Badge, Details, LoadError, Notice, Panel, TextLink } from "@/components/coach/ui";
import { awaitingAction, cancelAction, completeAction, confirmRequestAction, declineAction, notifiedAction } from "../actions";

export const metadata: Metadata = { title: "Request" };

export default function RequestPage({ params, searchParams }: PageProps<"/coach/requests/[id]">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/requests">All requests</TextLink>
      </p>
      <Suspense fallback={<CoachLoading />}>
        <RequestView params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const DONE = {
  confirmed: "Confirmed. Now let them know: use the message below.",
  "confirmed-credit": "Confirmed, paid with a membership credit. Now let them know: use the message below.",
  "confirmed-no-credit": "Confirmed, but the membership credit couldn't be used (none left by the time it was saved), so the place is pay as you go. Use “Pay with a credit” on the class once they have one, or record the payment.",
  awaiting: "Marked as awaiting their response.",
  declined: "Declined. Let them know: use the message below.",
  cancelled: "Cancelled, with its booking.",
  completed: "Marked as completed.",
  told: "Noted: they've been told.",
};

async function RequestView({ params, searchParams }: { params: PageProps<"/coach/requests/[id]">["params"]; searchParams: PageProps<"/coach/requests/[id]">["searchParams"] }) {
  const { db, today } = await portalContext();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;

  const found = await getRequest(db, id);
  if (!found.ok) return <LoadError message={loadMessage(found.error)} />;
  if (!found.data) notFound();
  const request = found.data;
  const details = requestDetails(request);

  const loaded = collect(await Promise.all([listClients(db), relatedRequests(db, request)] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [clients, related] = loaded.data;
  const linked = request.client_id ? clients.find((c) => c.id === request.client_id) ?? null : null;
  const match = matchClients({ name: request.name, email: request.email, phone: request.phone }, clients);
  const known = linked ?? match.exact;

  const open = request.status === "new" || request.status === "awaiting";
  return (
    <>
      <div className="mt-4 flex flex-col gap-3 border-b border-ink pb-6">
        <p className="members-eyebrow">{request.kind === "online" ? "Online coaching enquiry" : "Booking request"}</p>
        <h1 className="mt-2 text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance break-words">{request.name}</h1>
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={request.status === "new" ? "strong" : "plain"}>{REQUEST_STATUS[request.status] ?? request.status}</Badge>
          <span className="text-sm text-muted">
            Received <time dateTime={request.created_at}>{formatStamp(request.created_at)}</time>
            {request.idempotency_key ? ` · Reference ${referenceFor(request.idempotency_key)}` : ""}
          </span>
        </p>
        <p className="text-sm text-muted">A request is not a booking until you confirm it here.</p>
      </div>
      <Flash done={query.done} messages={DONE} />

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
        <Panel title="What they asked for" id="asked-heading">
          <Details
            items={[
              ["Service", request.service],
              ["When", request.summary || "—"],
              ...(details.days ? ([["Preferred days", details.days]] as [string, string][]) : []),
              ...(details.times ? ([["Preferred times", details.times]] as [string, string][]) : []),
              ...(details.membership ? ([["Membership", details.membership]] as [string, string][]) : []),
              ["Experience", details.experience],
              ...details.other.map(([k, v]) => [k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), v] as [string, string]),
              ["Message", request.message ? <span className="whitespace-pre-line">{request.message}</span> : ""],
              ["Email", request.email ? <a href={`mailto:${request.email}`} className="underline underline-offset-4">{request.email}</a> : ""],
              ["Phone", request.phone ? <a href={`tel:${request.phone.replace(/\s+/g, "")}`} className="underline underline-offset-4">{request.phone}</a> : ""],
              ...(request.decided_at ? ([["Decided", formatStamp(request.decided_at)]] as [string, string][]) : []),
              ...(request.decision_note ? ([["Note", <span key="n" className="whitespace-pre-line">{request.decision_note}</span>]] as [string, React.ReactNode][]) : []),
              ...(request.notified_at ? ([["Told", formatStamp(request.notified_at)]] as [string, string][]) : []),
              ...(request.alert_status ? ([["Email alert", alertLabel(request)]] as [string, string][]) : []),
            ]}
          />
          {details.plan ? (
            <div className="mt-4">
              {/* They chose a plan on the site: start it here (prefilled), once you've agreed it with them. */}
              <ActionLink
                href={`/coach/memberships/new?plan=${encodeURIComponent(details.plan)}&request=${request.id}${known ? `&client=${known.id}` : ""}`}
                variant="secondary"
              >
                Start this membership
              </ActionLink>
              {!known ? <p className="mt-2 text-sm text-muted">Link or create their client record first, so the membership is on it.</p> : null}
            </div>
          ) : null}
        </Panel>

        <Panel title="Who is this?" id="who-heading">
          {known ? (
            <Notice>
              {linked ? "Linked to client " : "Same email as client "}
              <TextLink href={`/coach/clients/${known.id}`}>{known.full_name}</TextLink>.
            </Notice>
          ) : (
            <Notice>No client has this email address yet.</Notice>
          )}
          {match.possible.length ? (
            <div className="mt-4">
              <p className="text-sm font-semibold">Possibly the same person (not linked automatically):</p>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {match.possible.map((p) => (
                  <li key={p.client.id}>
                    <TextLink href={`/coach/clients/${p.client.id}`}>{p.client.full_name}</TextLink> — same {p.reasons.join(" and ")}
                    {p.client.email ? `, ${p.client.email}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {known ? (
            <Suspense fallback={<p className="mt-4 text-sm text-muted">Loading their history…</p>}>
              <History clientId={known.id} />
            </Suspense>
          ) : null}
          {related.length ? (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Other requests from them</h3>
              <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
                {related.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <TextLink href={`/coach/requests/${r.id}`}>{r.summary || r.service}</TextLink>
                    <span className="text-muted">
                      {REQUEST_STATUS[r.status] ?? r.status} · {formatStamp(r.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>
      </div>

      {open ? <Decide request={request} today={today} known={known} possible={match.possible.map((p) => p.client)} /> : null}
      {request.status === "confirmed" || request.status === "declined" ? <Tell request={request} /> : null}
      {request.status === "confirmed" ? (
        <Panel title="Afterwards" id="after-heading">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <ActionForm action={completeAction} label="Mark completed">
              <input type="hidden" name="request" value={request.id} />
              <p className="text-sm text-muted">When the booking has happened.</p>
              <div>
                <SubmitButton variant="secondary">Mark completed</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={cancelAction} confirm="Cancel this booking? Its class place or session is cancelled too." label="Cancel booking">
              <input type="hidden" name="request" value={request.id} />
              <TextArea name="note" label="Reason" rows={2} maxLength={1000} />
              <div>
                <SubmitButton variant="secondary">Cancel booking</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

async function History({ clientId }: { clientId: string }) {
  const { db } = await portalContext();
  if (!db) return null;
  const loaded = collect(await Promise.all([listAttendance(db, { clientId }), listPtSessions(db, { clientId, order: "desc", limit: 10 })] as const));
  if (!loaded.ok) return <p className="mt-4 text-sm">Their history couldn&apos;t be loaded.</p>;
  const [places, sessions] = loaded.data;
  const classRows = places.length ? await classSessionsByIds(db, [...new Set(places.map((p) => p.class_session_id))]) : { ok: true as const, data: [] };
  const classes = classRows.ok ? classRows.data : [];
  const items = [
    ...places.map((p) => {
      const c = classes.find((x) => x.id === p.class_session_id);
      return { at: c?.starts_at ?? p.created_at, text: `Class${c ? `, ${formatDateTime(c.starts_at)}` : ""}`, status: ATTENDANCE_STATUS[p.status] };
    }),
    ...sessions.map((s) => ({ at: s.starts_at, text: `One-to-one, ${formatDateTime(s.starts_at)}`, status: PT_STATUS[s.status] })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);
  if (!items.length) return <p className="mt-4 text-sm text-muted">No bookings yet.</p>;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Recent bookings</h3>
      <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
        {items.map((item, i) => (
          <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
            <span>{item.text}</span>
            <span className="text-muted">{item.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Decide({ request, today, known, possible }: { request: BookingRequest; today: string; known: Client | null; possible: Client[] }) {
  const { db } = await portalContext();
  if (!db) return null;
  const details = requestDetails(request);
  const prices = defaultPrices();
  const occurrences = classOccurrences(today, addDays(today, 56));
  const overview = await listClassSessions(db, today, addDays(today, 56));
  const usualSize = await getDefaultCapacity(db);
  const packages = known ? await listPackages(db, { clientId: known.id, activeOnly: true }) : { ok: true as const, data: [] };
  const usable = packages.ok ? packages.data.filter((k) => k.sessions_remaining > 0) : [];
  const requested = details.classDate && details.classSlot ? `${details.classDate}|${details.classSlot}` : "";
  const isGroup = Boolean(requested) || /group class/i.test(request.service);
  const isPt = /one-to-one|1:1/i.test(request.service);
  const defaultKind = request.kind === "online" ? "none" : isGroup ? "class" : isPt ? "pt" : "none";

  const clientOptions = [
    ...(known ? [{ value: known.id, label: `${known.full_name} (existing client)`, hint: [known.email, known.phone].filter(Boolean).join(" · ") }] : []),
    ...possible.filter((c) => c.id !== known?.id).map((c) => ({ value: c.id, label: `${c.full_name} (possible match)`, hint: [c.email, c.phone].filter(Boolean).join(" · ") })),
    { value: "new", label: "Create a new client", hint: "From the details below" },
  ];
  const classOptions = occurrences.map((o) => {
    const row = overview.ok ? overview.data.find((c) => c.slot === o.slot.id && c.class_date === o.date) : undefined;
    const size = row?.capacity ?? usualSize;
    const full = (row?.booked ?? 0) >= size;
    const count = ` · ${row?.booked ?? 0}/${size} booked`;
    return { value: `${o.date}|${o.slot.id}`, label: `${formatDate(o.date)}, ${slotLabel(o.slot).split(" ").slice(1).join(" ")}${count}${full ? " · full" : ""}` };
  });
  const requestedValid = classOptions.some((o) => o.value === requested);
  // A member's place is paid with a credit when their current period covers the class.
  const memberPeriod = known ? await periodOn(db, known.id, details.classDate || today) : { ok: true as const, data: null };
  const period = memberPeriod.ok ? memberPeriod.data : null;

  return (
    <Panel title="Decide" id="decide-heading">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="text-base font-bold">Confirm</h3>
          <div className="mt-4">
            <ActionForm action={confirmRequestAction} label="Confirm request">
              <input type="hidden" name="request" value={request.id} />
              <RadioGroup name="client" legend="Client record" options={clientOptions} defaultValue={known ? known.id : possible.length ? undefined : "new"} hint={possible.length ? "Check before choosing: a matching phone or name may still be someone else." : undefined} />
              <fieldset className="grid grid-cols-1 gap-4 border border-line bg-white p-4 sm:grid-cols-3">
                <legend className="px-1 text-sm font-semibold">New client details (used only for a new client)</legend>
                <Field name="full_name" label="Full name" defaultValue={request.name} maxLength={100} required />
                <Field name="email" label="Email" type="email" defaultValue={request.email} />
                <Field name="phone" label="Phone" type="tel" defaultValue={request.phone} />
              </fieldset>
              <RadioGroup
                name="booking"
                legend="Book"
                defaultValue={defaultKind}
                options={[
                  { value: "class", label: "A place on a group class" },
                  { value: "pt", label: "A one-to-one session" },
                  { value: "none", label: "Nothing yet", hint: request.kind === "online" ? "Then set up their online coaching from their client record." : "Confirms the request and the client only." },
                ]}
              />
              <fieldset className="grid grid-cols-1 gap-4 border border-line bg-white p-4 sm:grid-cols-3">
                <legend className="px-1 text-sm font-semibold">Group class</legend>
                <SelectField
                  name="class"
                  label="Class"
                  required
                  className="sm:col-span-2"
                  options={classOptions}
                  defaultValue={requestedValid ? requested : undefined}
                  placeholder={requestedValid ? undefined : "Choose a class"}
                  hint={details.classDate && !requestedValid ? `They asked for ${request.summary}, which isn't an upcoming class.` : "Capacity is only enforced where you've set one."}
                />
                <MoneyField name="class_price" label="Price" defaultValue={penceToInput(prices.classPence)} required hint={period ? "Ignored when a credit is used." : undefined} />
                {period ? (
                  <div className="sm:col-span-3">
                    <Checkbox
                      name="credit"
                      label={`Pay with their ${period.plan_name} membership credit`}
                      defaultChecked={period.credits_left > 0}
                      hint={`${creditsLine(period)} until ${formatDate(period.period_end)}. No class charge; one credit is used.`}
                    />
                  </div>
                ) : null}
              </fieldset>
              <fieldset className="grid grid-cols-1 gap-4 border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
                <legend className="px-1 text-sm font-semibold">One-to-one session</legend>
                <Field name="pt_date" label="Date" type="date" required />
                <Field name="pt_time" label="Start" type="time" required />
                <Field name="pt_minutes" label="Minutes" type="number" inputMode="numeric" min={15} max={240} defaultValue={60} required />
                <MoneyField name="pt_price" label="Price" defaultValue={penceToInput(prices.ptPence)} hint="Ignored when a package is used." required />
                {usable.length ? (
                  <SelectField name="pt_package" label="Use a package" className="sm:col-span-2" placeholder="No package (charge the price)" options={usable.map((k) => ({ value: k.id, label: `${k.name}: ${k.sessions_remaining} left` }))} />
                ) : null}
              </fieldset>
              <TextArea name="note" label="Note for the record" rows={2} maxLength={1000} hint="Included in the message to them." />
              <div>
                <SubmitButton pendingLabel="Confirming…">Confirm request</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </div>
        <div className="grid content-start gap-10">
          {request.status === "new" ? (
            <div>
              <h3 className="text-base font-bold">Waiting on them?</h3>
              <div className="mt-4">
                <ActionForm action={awaitingAction} label="Mark awaiting response">
                  <input type="hidden" name="request" value={request.id} />
                  <TextArea name="note" label="What you asked them" rows={2} maxLength={1000} />
                  <div>
                    <SubmitButton variant="secondary">Mark awaiting response</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </div>
          ) : null}
          <div>
            <h3 className="text-base font-bold">Decline</h3>
            <div className="mt-4">
              <ActionForm action={declineAction} confirm="Decline this request?" label="Decline request">
                <input type="hidden" name="request" value={request.id} />
                <TextArea name="note" label="Reason" rows={2} maxLength={1000} required hint="Kept on the request and included in the message to them." />
                <div>
                  <SubmitButton variant="secondary">Decline</SubmitButton>
                </div>
              </ActionForm>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

async function Tell({ request }: { request: BookingRequest }) {
  const { db } = await portalContext();
  let booked: string | undefined;
  if (db && request.status === "confirmed" && request.client_id) {
    const loaded = collect(await Promise.all([listAttendance(db, { clientId: request.client_id }), listPtSessions(db, { clientId: request.client_id })] as const));
    if (loaded.ok) {
      const [places, sessions] = loaded.data;
      const place = places.find((p) => p.request_id === request.id);
      const session = sessions.find((s) => s.request_id === request.id);
      if (place) {
        const rows = await classSessionsByIds(db, [place.class_session_id]);
        const row = rows.ok ? rows.data[0] : undefined;
        const slot = row ? findSlot(row.slot) : undefined;
        if (row) booked = `${slot ? (slot.name ?? "Kettlebell Training") : "Class"}, ${formatDateTime(row.starts_at)}`;
      } else if (session) {
        booked = `1:1 coaching session, ${formatDateTime(session.starts_at)}`;
      }
    }
  }
  const message = decisionMessage(request, booked);
  return (
    <Panel title="Let them know" id="tell-heading">
      <p className="text-sm text-muted">The site doesn&apos;t message them for you. Send this from your email, or copy it into a text or Instagram message.</p>
      <label htmlFor="message-text" className="mt-4 block text-sm font-semibold">
        Message
      </label>
      <textarea id="message-text" readOnly rows={8} defaultValue={message.body} className="mt-2 block w-full border border-muted bg-white p-3 text-base" />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {request.email ? (
          <a href={mailtoLink(request.email, message)} className="inline-flex min-h-11 items-center bg-ink rounded-full px-5 text-sm font-semibold text-paper border border-ink hover:bg-white hover:text-ink">
            Open in email
          </a>
        ) : null}
        {request.notified_at ? (
          <span className="text-sm">Told {formatStamp(request.notified_at)}.</span>
        ) : (
          <ActionForm action={notifiedAction} label="Mark as told">
            <input type="hidden" name="request" value={request.id} />
            <SubmitButton variant="secondary">Mark as told</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Panel>
  );
}

/** The email alert the site sent you about this request. */
function alertLabel(request: Pick<BookingRequest, "alert_status" | "alert_sent_at" | "alert_attempts">): string {
  if (request.alert_status === "sent") return request.alert_sent_at ? `Sent ${formatStamp(request.alert_sent_at)}` : "Sent";
  const tries = request.alert_attempts ?? 1;
  return `Not sent yet (${tries} ${tries === 1 ? "try" : "tries"}). The request is safe here; the site keeps trying for up to a day.`;
}

import { Suspense } from "react";
import { CoachLoading } from "@/components/coach/CoachLoading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { defaultPrices } from "@/lib/coach/classes";
import { getClient } from "@/lib/coach/clients";
import { portalContext } from "@/lib/coach/context";
import { collect } from "@/lib/coach/db";
import { loadMessage } from "@/lib/coach/errors";
import { SUBSCRIPTION_STATUS } from "@/lib/coach/labels";
import { listCharges } from "@/lib/coach/ledger";
import { formatPence } from "@/lib/coach/money";
import { getCoachingOverview, getSubscription, listCheckIns } from "@/lib/coach/online";
import { formatProgramme } from "@/lib/coach/programme-text";
import { PAYMENT_STATE_LABEL, paymentState } from "@/lib/coach/revenue";
import { formatDate } from "@/lib/coach/time";
import { SubscriptionFields } from "@/components/coach/SubscriptionFields";
import { ActionForm, Field, SubmitButton, TextArea } from "@/components/coach/form";
import { Badge, LoadError, Panel, TextLink } from "@/components/coach/ui";
import { chargePeriodAction, checkInAction, messageClientAction, replyCheckInAction, saveProgrammeAction, updateSubscriptionAction } from "../actions";

export const metadata: Metadata = { title: "Online coaching plan" };

export default function SubscriptionPage({ params }: PageProps<"/coach/online/[id]">) {
  return (
    <>
      <p className="text-sm">
        <TextLink href="/coach/online">Online coaching</TextLink>
      </p>
      <Suspense fallback={<CoachLoading />}>
        <SubscriptionView params={params} />
      </Suspense>
    </>
  );
}

async function SubscriptionView({ params }: { params: PageProps<"/coach/online/[id]">["params"] }) {
  const { db, today } = await portalContext();
  const { id } = await params;
  if (!db) return <LoadError message="The database isn't configured for this deployment." />;
  const found = await getSubscription(db, id);
  if (!found.ok) return <LoadError message={loadMessage(found.error)} />;
  if (!found.data) notFound();
  const s = found.data;
  const loaded = collect(await Promise.all([getClient(db, s.client_id), listCheckIns(db, { subscriptionIds: [s.id] }), listCharges(db, { subscriptionId: s.id })] as const));
  if (!loaded.ok) return <LoadError message={loadMessage(loaded.error)} />;
  const [client, checkIns, charges] = loaded.data;
  // The client's coaching area (programme, their check-ins and messages); a failure here only hides those panels.
  const area = await getCoachingOverview(db, s.id);
  const coaching = area.ok && area.data.active ? area.data : null;
  const programme = coaching?.programme ?? null;
  const sample = "Week 1\nDay A\nTwo-hand swing | 5 | 10 | 24 kg\nStrict press | 4 | 5 each | 16 kg | Pause 2 s at the top. | https://youtu.be/…\nDay B\nSnatch | 6 | 5 each | 16 kg";
  const due = s.next_check_in_on && s.next_check_in_on <= today;
  const period = s.renews_on ?? s.start_on;

  return (
    <>
      <div className="mt-4 border-b border-ink pb-6">
        <p className="members-eyebrow">Online coaching</p>
        <h1 className="mt-2 text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance break-words">{client ? client.full_name : "Deleted client"}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span>
            {s.plan} · {formatPence(s.price_pence)}/month
          </span>
          <Badge tone={s.status === "active" ? "strong" : "muted"}>{SUBSCRIPTION_STATUS[s.status]}</Badge>
          {due ? <Badge>Check-in due</Badge> : null}
          {client ? <TextLink href={`/coach/clients/${client.id}?tab=online`}>Client record</TextLink> : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
        <div>
          <Panel title="Log a check-in" id="checkin-heading">
            <ActionForm action={checkInAction} resetOnSuccess label="Log a check-in">
              <input type="hidden" name="subscription" value={s.id} />
              <Field name="checked_in_on" label="Date" type="date" defaultValue={today} max={today} required />
              <TextArea name="summary" label="How it went" rows={3} maxLength={2000} required hint="Training and progress only: no health details." />
              <TextArea name="actions" label="Agreed actions" rows={2} maxLength={2000} />
              <div>
                <SubmitButton>Log check-in</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
          <Panel title="Check-ins" id="history-heading">
            {checkIns.length ? (
              <ul className="divide-y divide-line border-y border-line">
                {checkIns.map((c) => (
                  <li key={c.id} className="py-3">
                    <p className="text-sm font-semibold">{formatDate(c.checked_in_on)}</p>
                    <p className="mt-1 whitespace-pre-line">{c.summary}</p>
                    {c.actions ? <p className="mt-1 text-sm whitespace-pre-line text-muted">Agreed: {c.actions}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No check-ins yet.</p>
            )}
          </Panel>
          {coaching ? (
            <>
              <Panel title="Programme (the client's coaching area)" id="programme-heading">
                <p className="text-sm text-muted">
                  The client sees this under Coaching in their members area, signs in with their email, logs each set and sends weekly check-ins. Only an active plan opens it.
                  {s.status !== "active" ? " This plan isn't active, so they can't see it yet." : ""}
                </p>
                <ActionForm action={saveProgrammeAction} label="Programme">
                  <input type="hidden" name="subscription" value={s.id} />
                  <Field name="name" label="Programme name" defaultValue={programme?.name ?? ""} maxLength={80} required />
                  <Field name="goal" label="Goal" defaultValue={programme?.goal ?? ""} maxLength={200} />
                  <div className="grid grid-cols-1 gap-x-4 xs:grid-cols-3">
                    <Field name="weeks" label="Weeks" type="number" inputMode="numeric" min={1} max={12} defaultValue={String(programme?.weeks ?? 6)} required />
                    <Field name="days_per_week" label="Days a week" type="number" inputMode="numeric" min={1} max={7} defaultValue={String(programme?.days_per_week ?? 3)} required />
                    <Field name="starts_on" label="Starts" type="date" defaultValue={programme?.starts_on ?? today} required />
                  </div>
                  <TextArea
                    name="programme"
                    label="Exercises"
                    rows={14}
                    maxLength={30000}
                    required
                    defaultValue={programme ? formatProgramme(programme.items) : sample}
                    hint="Week 1, then Day A, then one exercise a line: name | sets | reps | load | note | demo link (https). A week you leave out repeats the one before. A demo link goes to a video hosted elsewhere; videos are never uploaded."
                  />
                  <div>
                    <SubmitButton>{programme ? "Save programme" : "Create programme"}</SubmitButton>
                  </div>
                </ActionForm>
                {programme ? (
                  <p className="mt-3 text-sm text-muted">
                    Week {programme.week} of {programme.weeks} · {coaching.logs.length} session{coaching.logs.length === 1 ? "" : "s"} logged. Saving keeps what they have logged.
                  </p>
                ) : null}
              </Panel>
              <Panel title="Sessions logged" id="logged-heading">
                {coaching.logs.length ? (
                  <ul className="divide-y divide-line border-y border-line text-sm">
                    {coaching.logs.slice(0, 10).map((l) => (
                      <li key={l.id} className="py-2.5">
                        <p className="font-semibold">
                          Week {l.week} · {l.day} · {formatDate(l.logged_at.slice(0, 10))}
                        </p>
                        <p className="text-muted">{[...new Set(l.sets.filter((x) => x.done).map((x) => x.item_name))].join(", ") || "No sets ticked"}</p>
                        {l.note ? <p className="mt-0.5">“{l.note}”</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Nothing logged yet.</p>
                )}
              </Panel>
              <Panel title="Check-ins from the app" id="app-checkins-heading">
                {coaching.check_ins.length ? (
                  <ul className="divide-y divide-line border-y border-line">
                    {coaching.check_ins.map((c) => (
                      <li key={c.id} className="py-3">
                        <p className="text-sm font-semibold">
                          {c.programme_week ? `Week ${c.programme_week} · ` : ""}
                          {formatDate(c.created_at.slice(0, 10))}
                        </p>
                        <p className="mt-1 text-sm">
                          Energy {c.energy} · Sleep {c.sleep} · Training {c.training}
                        </p>
                        {c.wins ? <p className="mt-1 whitespace-pre-line">Wins: {c.wins}</p> : null}
                        {c.struggles ? <p className="mt-1 whitespace-pre-line">Hard: {c.struggles}</p> : null}
                        {c.video_url ? (
                          <p className="mt-1 text-sm">
                            <a href={c.video_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                              Form video<span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          </p>
                        ) : null}
                        {c.coach_reply ? (
                          <p className="mt-2 rounded-lg border border-line p-3 whitespace-pre-line">Your reply: {c.coach_reply}</p>
                        ) : (
                          <div className="mt-2">
                            <ActionForm action={replyCheckInAction} resetOnSuccess label="Reply to this check-in">
                              <input type="hidden" name="check_in" value={c.id} />
                              <TextArea name="reply" label="Reply" rows={2} maxLength={1000} required />
                              <div>
                                <SubmitButton variant="secondary">Send reply</SubmitButton>
                              </div>
                            </ActionForm>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">None yet.</p>
                )}
              </Panel>
              <Panel title="Messages" id="messages-heading">
                {coaching.messages.length ? (
                  <ul className="mb-4 flex flex-col gap-2 text-sm">
                    {coaching.messages.map((m) => (
                      <li key={m.id} className={`max-w-[85%] rounded-xl border border-line px-3 py-2 whitespace-pre-line ${m.from_client ? "self-start" : "self-end bg-white"}`}>
                        <span className="block text-xs text-muted">
                          {m.from_client ? "Client" : "You"} · {formatDate(m.created_at.slice(0, 10))}
                        </span>
                        {m.body}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-4 text-sm text-muted">No messages yet.</p>
                )}
                <ActionForm action={messageClientAction} resetOnSuccess label="Message the client">
                  <input type="hidden" name="subscription" value={s.id} />
                  <TextArea name="body" label="Message" rows={2} maxLength={2000} required hint="They see it under Messages in their coaching area." />
                  <div>
                    <SubmitButton variant="secondary">Send</SubmitButton>
                  </div>
                </ActionForm>
              </Panel>
            </>
          ) : null}
        </div>
        <div>
          <Panel title="Payments" id="charges-heading">
            <p className="text-sm text-muted">Each month is charged once you raise it. It counts as received only when you record the payment.</p>
            {s.status === "active" && s.price_pence > 0 ? (
              <div className="mt-3">
                <ActionForm action={chargePeriodAction} confirm={`Add a ${formatPence(s.price_pence)} charge for the period from ${formatDate(period)}?`} label="Raise this period's charge">
                  <input type="hidden" name="subscription" value={s.id} />
                  <div>
                    <SubmitButton variant="secondary">Charge period from {formatDate(period)}</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            ) : null}
            {charges.length ? (
              <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
                {[...charges].reverse().map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {c.period_start ? `From ${formatDate(c.period_start)}` : c.description} · {formatPence(c.amount_pence)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={paymentState(c) === "unpaid" ? "strong" : "muted"}>{c.voided_at ? "Cancelled" : PAYMENT_STATE_LABEL[paymentState(c)]}</Badge>
                      {!c.voided_at && c.outstanding_pence > 0 ? <TextLink href={`/coach/finances/payments/new?client=${s.client_id}&charge=${c.id}`}>Pay</TextLink> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
          <Panel title="Plan" id="plan-heading">
            <ActionForm action={updateSubscriptionAction} label="Plan details">
              <input type="hidden" name="subscription" value={s.id} />
              <SubscriptionFields subscription={s} defaults={{ pricePence: defaultPrices().onlinePence, today }} />
              <div>
                <SubmitButton variant="secondary">Save plan</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}

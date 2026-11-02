import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/content/site";
import { formatLongDate, type DateKey } from "@/lib/availability/dates";
import { formatDayMonth } from "@/lib/coach/time";
import { formatPenceShort } from "@/lib/membership";
import { pageMetadata } from "@/lib/metadata";
import { periodProgress } from "@/lib/member-view";
import { AccountUnavailable, ClassCredits, PayAsYouGo, PaymentDue } from "@/components/members/Cards";
import { PlanCoaching } from "@/components/members/CoachingCards";
import { MembersShell } from "@/components/members/MembersShell";
import { BILLING_WEEKS } from "@/content/memberships";
import { cancelMembership, setUpDirectDebit, updateRenewalCard } from "../actions";
import { loadMembers } from "../data";

export const metadata: Metadata = pageMetadata({
  title: "Your plan",
  description: "Your RAENG membership, credits and renewal.",
  path: "/account/plan",
  noindex: true,
});

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * Members Plan (owner's members design, 2026-10-28): the plan card with how
 * far through the credit period today is, credits used, the renewal, and
 * where to change plan or ask about it. Memberships renew by saved card
 * (the first payment keeps it; changed here), or by Direct Debit once offered, and the member can cancel at any time:
 * nothing more is taken and the credits already given stay until the period
 * ends (owner, 2026-10-30). Pausing or changing plan stays with Alex.
 * Pay-as-you-go customers see their plan instead.
 */
export default async function AccountPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const o = d.overview.data;
  const m = o.membership;

  return (
    <MembersShell view="plan" overview={o} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={null}>
      <div className="flex flex-col gap-2">
        <p className="members-eyebrow">Plan and account</p>
        <h1 className="text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">
          {m ? "Your membership." : "Your plan."}
        </h1>
      </div>

      {d.due ? <PaymentDue due={d.due} /> : null}

      {m ? (
        <>
          <section aria-labelledby="plan-heading" className="flex flex-col gap-1.5 rounded-3xl border-[1.5px] border-ink p-5.5">
            <p className="members-eyebrow">Current plan</p>
            <h2 id="plan-heading" className="text-[1.75rem] font-extrabold tracking-[-0.03em]">
              {m.plan_name}
            </h2>
            <p className="text-ink">
              {formatPenceShort(m.price_pence)} every 4 weeks · {m.credits} credits
            </p>
            {m.status !== "active" ? (
              <p className="mt-1 font-semibold">
                {m.status === "paused"
                  ? "Paused. Message Alex to start it again."
                  : `Cancelled${m.cancelled_on ? ` from ${formatLongDate(m.cancelled_on as DateKey)}` : ""}. Credits you have can still be used until the end of this period.`}
              </p>
            ) : null}
            {o.period ? (
              <div className="mt-3 flex flex-col gap-2">
                <div
                  role="progressbar"
                  aria-label="Credit period"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={periodProgress(o.period, d.today)}
                  aria-valuetext={`${formatDayMonth(o.period.start)} to ${formatDayMonth(o.period.end)}`}
                  className="h-1.5 overflow-hidden rounded-full bg-white"
                >
                  <i className="block h-full rounded-full bg-ink" style={{ width: `${periodProgress(o.period, d.today)}%` }} />
                </div>
                <div className="flex justify-between text-[0.8125rem] text-ink tabular-nums">
                  <span>{formatDayMonth(o.period.start)}</span>
                  <span>{m.status === "active" && m.renews_on ? `Renews ${formatDayMonth(m.renews_on)}` : `Ends ${formatDayMonth(o.period.end)}`}</span>
                </div>
              </div>
            ) : null}
          </section>

          <dl className="border-t border-line">
            {(
              [
                ["Credits used", o.period ? `${o.period.used} of ${o.period.credits}` : "No period yet"],
                ["Next renewal", m.status === "active" && m.renews_on ? formatLongDate(m.renews_on as DateKey) : "None"],
                ["New credits", m.status === "active" ? `${m.credits} on renewal` : "None"],
                ["Signed in as", o.client.email || o.client.name],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line py-3.5">
                <dt className="text-ink">{k}</dt>
                <dd className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{v}</dd>
              </div>
            ))}
          </dl>

          {m.status !== "cancelled" ? (
            <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
              <h2 id="payments-heading" className="members-eyebrow">
                Payments
              </h2>
              <div className="flex flex-col gap-2 rounded-3xl bg-white p-5">
                {d.dd.status === "active" && d.dd.method === "card" ? (
                  <>
                    <p className="font-semibold">Your membership renews automatically.</p>
                    <p className="text-ink">
                      {formatPenceShort(m.price_pence)} is charged to your {d.dd.label || "card"} every {BILLING_WEEKS} weeks, on the day each new period starts. We email you 5 days before each payment.
                    </p>
                    <form action={updateRenewalCard}>
                      <button type="submit" className="members-btn mt-2 w-full sm:w-auto">
                        Change card
                      </button>
                    </form>
                    {d.ddAvailable ? (
                      <form action={setUpDirectDebit} className="mt-3 border-t border-line pt-3">
                        <p className="text-ink">Prefer to pay by Direct Debit instead? Your bank details go straight to Stripe, not to us.</p>
                        <button type="submit" className="members-btn mt-2 w-full sm:w-auto">
                          Switch to Direct Debit
                        </button>
                      </form>
                    ) : null}
                  </>
                ) : d.dd.status === "active" && d.dd.method === "bacs" ? (
                  <>
                    <p className="font-semibold">Direct Debit is set up.</p>
                    <p className="text-ink">
                      {formatPenceShort(m.price_pence)} is collected by Direct Debit every {BILLING_WEEKS} weeks, a few days before each new period starts.
                    </p>
                  </>
                ) : !d.cardAvailable ? (
                  <p className="text-ink">We&apos;ll email you a payment link when your membership renews. Payments are made on Stripe&apos;s secure page.</p>
                ) : (
                  <>
                    <p className="font-semibold">Turn on automatic renewals.</p>
                    <p className="text-ink">
                      Save a card and your membership renews every {BILLING_WEEKS} weeks without you doing anything: {formatPenceShort(m.price_pence)} is charged to it each time, and we email you 5 days before. You can cancel at any time. Your card details go straight to Stripe, not to us.
                    </p>
                    <form action={updateRenewalCard}>
                      <button type="submit" className="members-btn members-btn-solid mt-2 w-full sm:w-auto">
                        Save a card
                      </button>
                    </form>
                    {d.ddAvailable ? (
                      <form action={setUpDirectDebit} className="mt-3 border-t border-line pt-3">
                        <p className="text-ink">Or set up a Direct Debit instead.</p>
                        <button type="submit" className="members-btn mt-2 w-full sm:w-auto">
                          Set up Direct Debit
                        </button>
                      </form>
                    ) : null}
                  </>
                )}
              </div>
              <details className="rounded-3xl bg-white p-5">
                <summary className="cursor-pointer font-semibold">Cancel my membership</summary>
                <p className="mt-3 text-ink">
                  You can cancel at any time. Nothing more will be taken. You keep the credits you&apos;ve already paid for until the end of this period, and they aren&apos;t refunded.
                </p>
                <form action={cancelMembership}>
                  <button type="submit" className="members-btn mt-4 w-full sm:w-auto">
                    Yes, cancel my membership
                  </button>
                </form>
              </details>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <PayAsYouGo o={o} today={d.today} />
          <ClassCredits o={o} />
        </>
      )}

      {d.coaching ? <PlanCoaching coaching={d.coaching} overview={o} /> : null}

      <section aria-labelledby="manage-heading" className="flex flex-col gap-3">
        <h2 id="manage-heading" className="members-eyebrow">
          Manage
        </h2>
        <ul className="border-t border-line">
          <li className="flex items-center justify-between gap-3 border-b border-line py-3">
            <div className="flex min-w-0 flex-col">
              <span className="font-semibold">{m ? "Change plan" : "Join a membership"}</span>
              <span className="text-sm text-ink">See all memberships</span>
            </div>
            <Link href="/memberships" className="members-link">
              View<span className="sr-only"> memberships</span>
            </Link>
          </li>
          <li className="flex items-center justify-between gap-3 border-b border-line py-3">
            <div className="flex min-w-0 flex-col">
              <span className="font-semibold">{m ? "Pause or questions" : "Change your details or questions"}</span>
              <span className="text-sm text-ink">Message Alex</span>
            </div>
            <a href={site.social.instagram.url} {...external} className="members-link">
              Instagram<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
          <li className="flex items-center justify-between gap-3 border-b border-line py-3">
            <div className="flex min-w-0 flex-col">
              <span className="font-semibold">Cancellation policy</span>
              <span className="text-sm text-ink">Cancel 24 hours or more before</span>
            </div>
            <Link href={m ? "/memberships#cancellation" : "/classes"} className="members-link">
              Read<span className="sr-only"> the cancellation policy</span>
            </Link>
          </li>
        </ul>
      </section>
    </MembersShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BILLING_WEEKS } from "@/content/memberships";
import { AccountUnavailable } from "@/components/members/Cards";
import { MembersShell } from "@/components/members/MembersShell";
import { Confirmation } from "@/components/ui/Confirmation";
import { LiveStatus } from "@/components/ui/LiveStatus";
import { formatLongDate, type DateKey } from "@/lib/availability/dates";
import { formatPenceShort } from "@/lib/membership";
import { pageMetadata } from "@/lib/metadata";
import { loadMembers } from "../data";

export const metadata: Metadata = pageMetadata({
  title: "Direct Debit",
  description: "Confirming your RAENG Direct Debit.",
  path: "/account/direct-debit",
  noindex: true,
});

/** How many times the page asks again, 3 seconds apart, before it stops waiting for Stripe's word. */
const MAX_TRIES = 15;

/**
 * Where Stripe's Direct Debit page sends a member back to from the Plan page
 * (owner, 2026-11-02). Arriving proves nothing: it shows the confirming screen
 * until the database says the Direct Debit is set up (which only Stripe's
 * signed word changes), asks again by itself, and gives up waiting after
 * about 45 seconds with plain words (the email will follow). Anyone who
 * arrives without having come back from Stripe goes to the Plan page.
 */
export default async function AccountDirectDebitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const params = await searchParams;
  const o = d.overview.data;
  const m = o.membership;
  if (params.returned !== "1" || !m) redirect("/account/plan");

  const tries = Math.min(Math.max(Number(typeof params.n === "string" ? params.n : 0) || 0, 0), MAX_TRIES);
  const set = d.dd.status === "active" && d.dd.method === "bacs";
  const waiting = !set && tries < MAX_TRIES;
  const renews = m.status === "active" && m.renews_on ? formatLongDate(m.renews_on as DateKey) : null;

  return (
    <MembersShell view="plan" overview={o} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={null}>
      {waiting ? <LiveStatus href={`/account/direct-debit?returned=1&n=${tries + 1}`} /> : null}
      {set ? (
        <Confirmation
          variant="members"
          state="done"
          headingId="dd-heading"
          eyebrow={`${m.plan_name} membership`}
          title="Direct Debit set up."
          lede="Your membership now continues by Direct Debit. We'll email you a confirmation."
          details={[
            ["Plan", m.plan_name],
            ["Payment", `${formatPenceShort(m.price_pence)} every ${BILLING_WEEKS} weeks`],
            ["How", "Direct Debit"],
            ...(renews ? ([["Next payment", `Collected a few days before ${renews}`]] as [string, string][]) : []),
          ]}
        >
          <p className="text-sm">Your Direct Debit is protected by the Direct Debit Guarantee. You can cancel at any time from your plan: you keep the credits you&apos;ve paid for until the end of the period.</p>
          <Link href="/account/plan" className="members-btn members-btn-solid w-full sm:w-auto">
            Back to your plan
          </Link>
        </Confirmation>
      ) : waiting ? (
        <Confirmation
          variant="members"
          state="waiting"
          headingId="dd-heading"
          eyebrow={`${m.plan_name} membership`}
          title="Confirming your Direct Debit."
          lede="Stripe is confirming your bank details. This usually takes a few seconds, and this page updates by itself."
          steps={[
            { label: "Bank details sent to Stripe", status: "done" },
            { label: "Waiting for Stripe's confirmation", status: "active" },
            { label: "Your Direct Debit is ready", status: "todo" },
          ]}
        />
      ) : (
        <Confirmation
          variant="members"
          state="waiting"
          headingId="dd-heading"
          eyebrow={`${m.plan_name} membership`}
          title="Still confirming your Direct Debit."
          lede="Stripe has your bank details, but its confirmation is taking longer than usual. You don't need to wait here: we'll email you as soon as it's confirmed. Until then your membership carries on as it is."
        >
          <Link href="/account/plan" className="members-btn members-btn-solid w-full sm:w-auto">
            Back to your plan
          </Link>
        </Confirmation>
      )}
    </MembersShell>
  );
}

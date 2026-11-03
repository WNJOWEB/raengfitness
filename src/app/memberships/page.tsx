import type { Metadata } from "next";
import { BILLING_WEEKS, membershipPlans } from "@/content/memberships";
import { getService } from "@/content/services";
import { formatPenceShort, maxSavingPence } from "@/lib/membership";
import { pageMetadata } from "@/lib/metadata";
import { Section, SectionHeading } from "@/components/ui/Section";
import { PageHeader } from "@/components/sections/PageHeader";
import { CancellationPolicy } from "@/components/memberships/CancellationPolicy";
import { PaygExtra, PlanList } from "@/components/memberships/PlanList";
import { MembershipTerms } from "@/components/memberships/MembershipTerms";

export const metadata: Metadata = pageMetadata({
  title: "Kettlebell Memberships",
  description:
    "RAENG Fitness memberships: Starter, Regular and Dedicated, with class credits every four weeks and the saving against pay as you go. Cumbernauld, Glasgow.",
  path: "/memberships",
});

const payg = getService("group-classes").prices[0];

// Reads in the order a visitor decides (Alex, via the owner, 2026-11-03): the
// plans first (people who tap "Change plan" or "Memberships" expect to see the
// options at once), then how memberships work and the membership terms, then
// the cancellation policy (other pages link to #cancellation). There is no
// closing "Ready to start" band: someone already a member doesn't need
// reminding to book, and the plan list has its own button. What pay as you go
// costs on top is one plain link under the plans, closed until asked for.
export default function MembershipsPage() {
  return (
    <div className="section-rules">
      <PageHeader eyebrow="Kettlebell memberships" title="Choose your membership." intro={`Class credits, renewed every ${BILLING_WEEKS} weeks.`} />
      <Section id="memberships" labelledBy="plans-heading" className="pt-0 sm:pt-0 lg:pt-0">
        <SectionHeading
          id="plans-heading"
          title="Compare the prices."
          intro={`Save up to ${formatPenceShort(maxSavingPence(membershipPlans, payg.amountGbp))} every ${BILLING_WEEKS} weeks, against pay as you go at £${payg.amountGbp} a class.`}
        />
        <PlanList className="mt-8" />
        <PaygExtra className="mt-6" />
      </Section>
      <MembershipTerms />
      <CancellationPolicy />
    </div>
  );
}

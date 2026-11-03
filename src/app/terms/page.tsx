import type { Metadata } from "next";
import Link from "next/link";
import { classWaiver, membershipCancellation, membershipTermsAlex } from "@/content/policy";
import { pageMetadata } from "@/lib/metadata";
import { Section, SectionHeading } from "@/components/ui/Section";
import { PageHeader } from "@/components/sections/PageHeader";
import { CancellationPolicy } from "@/components/memberships/CancellationPolicy";

export const metadata: Metadata = pageMetadata({
  title: "Terms",
  description: "RAENG Fitness terms in one place: memberships, cancellations and refunds, and the health and risk terms for classes.",
  path: "/terms",
});

/**
 * The terms in one place for anyone who wants them before paying. Nothing here
 * is new: it shows the wording already published on /memberships and ticked at
 * booking (content/policy.ts), so a change there changes this page too.
 */
export default function TermsPage() {
  return (
    <div className="section-rules">
      <PageHeader
        eyebrow="Terms"
        title="Terms and policies."
        intro="Memberships, cancellations and refunds, and the health and risk terms for classes. The details you agree to when you book are the same as here."
      />
      <Section id="memberships" labelledBy="membership-terms-heading" className="pt-0 sm:pt-0 lg:pt-0">
        <SectionHeading id="membership-terms-heading" title={membershipTermsAlex.title} intro={membershipTermsAlex.intro} />
        <ul className="lined mt-6 max-w-2xl">
          {membershipTermsAlex.items.map((item) => (
            <li key={item.title}>
              <h3 className="card-title">{item.title}</h3>
              <p className="mt-1">{item.body}</p>
            </li>
          ))}
          <li>
            <h3 className="card-title">{membershipCancellation.title}</h3>
            <div className="mt-1 space-y-2">
              {membershipCancellation.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </li>
        </ul>
      </Section>
      <CancellationPolicy />
      <Section id="health-and-risk" labelledBy="health-heading">
        <SectionHeading id="health-heading" title={classWaiver.title} intro={classWaiver.intro} />
        <ol className="lined mt-6 max-w-2xl">
          {classWaiver.points.map((point, i) => (
            <li key={point.title}>
              <h3 className="card-title">
                {i + 1}. {point.title}
              </h3>
              <p className="mt-1">{point.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 max-w-2xl">
          How we look after your details is in the{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:no-underline">
            privacy notice
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}

import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { smallGroupCoaching as small } from "@/content/smallGroup";
import { coachingIntro } from "@/content/coaching";
import { images } from "@/content/images";
import { getPrimaryCtaFor } from "@/lib/booking";
import { StartTraining } from "@/components/ui/StartTraining";
import { Section, SectionHeading } from "@/components/ui/Section";
import { PageHeader } from "@/components/sections/PageHeader";
import { FocusFrame } from "@/components/sections/CoachingGraphics";
import { CtaBand } from "@/components/sections/CtaBand";
import { Boxes } from "@/components/coaching/Boxes";

export const metadata: Metadata = pageMetadata({
  title: "Small Group Kettlebell Coaching",
  description:
    "Small group kettlebell coaching in Cumbernauld, Glasgow: individual guidance with the motivation and energy of training alongside others. Enquire about availability.",
  path: "/coaching/small-group",
});

/**
 * Small Group Coaching: its own page (Alex, 2026-11-05). No price, group
 * size or times have been supplied, so none are shown; the button is an
 * enquiry (never a booking) and says pricing and availability follow.
 */
export default function SmallGroupPage() {
  const enquiry = getPrimaryCtaFor("small-group");

  return (
    <div className="section-rules">
      <PageHeader
        panel={<FocusFrame photo={images.coachHeader} tag="Train together" />}
        eyebrow="Coaching"
        title="Small Group Coaching."
        intro={<p>{coachingIntro}</p>}
      >
        <StartTraining
          href={enquiry.href}
          label={enquiry.kind === "booking" ? small.askLabel : enquiry.label}
          srSuffix=" (small group coaching)"
          external={enquiry.external}
          className="w-full sm:w-[22rem]"
        />
      </PageHeader>

      <Section id="about-small-group" labelledBy="small-group-heading">
        <SectionHeading id="small-group-heading" eyebrow="Small Group Coaching" title={small.heading} intro={small.summary} />
      </Section>

      <Section tone="white" id="benefits" labelledBy="benefits-heading">
        <SectionHeading id="benefits-heading" eyebrow="Small group coaching" title="Benefits." />
        <div className="mt-8">
          <Boxes items={small.benefits} label="Benefits of small group coaching" />
        </div>
      </Section>

      <Section id="included" labelledBy="included-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="included-heading" className="lg:col-span-5" eyebrow="What to expect" title="What's included." />
          <ul className="lined mt-8 lg:col-span-7 lg:mt-0">
            {small.included.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </Section>

      <Section tone="white" id="pricing" labelledBy="pricing-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="pricing-heading" className="lg:col-span-5" eyebrow="Pricing" title="Pricing and availability." />
          <p className="mt-8 lg:col-span-7 lg:mt-0">{small.pricing}</p>
        </div>
      </Section>

      <CtaBand tone="plain" body="Book a class, request 1:1 coaching or enquire about small group coaching." />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/metadata";
import { getService } from "@/content/services";
import { smallGroupCoaching } from "@/content/smallGroup";
import { coachingIntro, coachingPages } from "@/content/coaching";
import { images } from "@/content/images";
import { getPrimaryCta } from "@/lib/booking";
import { StartTraining } from "@/components/ui/StartTraining";
import { Section, SectionHeading } from "@/components/ui/Section";
import { publishable } from "@/lib/publish";
import { formatGbp } from "@/lib/schedule";
import { PageHeader } from "@/components/sections/PageHeader";
import { FocusFrame } from "@/components/sections/CoachingGraphics";
import { CtaBand } from "@/components/sections/CtaBand";

export const metadata: Metadata = pageMetadata({
  title: "Kettlebell Coaching",
  description:
    "Personalised, face-to-face kettlebell coaching in Cumbernauld, Glasgow: 1:1 personal coaching and small group coaching, designed around your goals, experience and ability.",
  path: "/coaching",
});

/**
 * Coaching overview (Alex, 2026-11-05): his intro, then a way into each of
 * the two coaching services, which have their own pages (and their own
 * entries in the menu): 1:1 Personal Coaching and Small Group Coaching.
 */
export default function CoachingPage() {
  const booking = getPrimaryCta();
  const lead = publishable(getService("one-to-one").prices)[0];
  const cards = [
    { ...coachingPages[0], body: "Individual coaching focused on your goals, technique and progression.", price: lead ? `${formatGbp(lead.amountGbp)} ${lead.unit}` : null },
    { ...coachingPages[1], body: smallGroupCoaching.summary, price: null },
  ];

  return (
    <div className="section-rules">
      <PageHeader
        panel={<FocusFrame photo={images.coachHeader} tag="Coaching with Alex" />}
        eyebrow="Coaching"
        title="Coaching built around you."
        intro={<p>{coachingIntro}</p>}
      >
        <StartTraining href={booking.href} label={booking.label} external={booking.external} className="w-full sm:w-[22rem]" />
      </PageHeader>

      <Section id="choose" labelledBy="choose-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="choose-heading" className="lg:col-span-5" eyebrow="Two ways to train" title="Choose your coaching." />
          <ul className="mt-8 flex flex-col gap-3 lg:col-span-7 lg:mt-0">
            {cards.map((c) => (
              <li key={c.href}>
                <Link href={c.href} className="group block rounded-[1.25rem] bg-white px-5 py-5 hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                  <span className="flex items-baseline justify-between gap-4">
                    <span className="card-title">{c.label}</span>
                    {c.price ? <span className="shrink-0 text-[0.9375rem] font-semibold lg:text-base">{c.price}</span> : null}
                  </span>
                  <span className="mt-1 flex items-baseline justify-between gap-4 text-[0.9375rem] lg:text-base">
                    <span>{c.body}</span>
                    <span aria-hidden="true" className="shrink-0 font-semibold underline underline-offset-4 group-hover:no-underline">
                      Explore
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* "Get in touch" here is the owner's own wording (2026-10-29); it still opens the 1:1 booking request. */}
      <CtaBand title="Ready to train 1:1?" body={null} service="one-to-one" label="Get in touch" />
    </div>
  );
}

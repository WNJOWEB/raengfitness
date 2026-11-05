import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { getService } from "@/content/services";
import { oneToOne } from "@/content/coaching";
import { images } from "@/content/images";
import { getPrimaryCtaFor } from "@/lib/booking";
import { StartTraining } from "@/components/ui/StartTraining";
import { Section, SectionHeading } from "@/components/ui/Section";
import { publishable } from "@/lib/publish";
import { formatGbp } from "@/lib/schedule";
import { revealDelay } from "@/lib/reveal";
import { PageHeader } from "@/components/sections/PageHeader";
import { FocusFrame } from "@/components/sections/CoachingGraphics";
import { PriceList } from "@/components/sections/PriceList";
import { CtaBand } from "@/components/sections/CtaBand";
import { Boxes } from "@/components/coaching/Boxes";

export const metadata: Metadata = pageMetadata({
  title: "1:1 Personal Kettlebell Coaching",
  description:
    "Personalised, face-to-face 1:1 kettlebell coaching in Cumbernauld, Glasgow, focused on your goals, technique and progression. A single session or a monthly package.",
  path: "/coaching/one-to-one",
});

/** 1:1 Personal Coaching: its own page (Alex, 2026-11-05). Wording from his website changes. */
export default function OneToOnePage() {
  const service = getService("one-to-one");
  const booking = getPrimaryCtaFor("one-to-one");
  const prices = publishable(service.prices);

  return (
    <div className="section-rules">
      <PageHeader
        panel={<FocusFrame photo={images.coachHeader} />}
        eyebrow="1:1 Personal Coaching"
        title={`${oneToOne.heading}.`}
        intro={<p>{oneToOne.intro}</p>}
      >
        <StartTraining href={booking.href} label={booking.label} srSuffix=" (1:1 personal coaching)" external={booking.external} className="w-full sm:w-[22rem]" />
      </PageHeader>

      <Section id="focus" labelledBy="focus-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="focus-heading" className="lg:col-span-5" eyebrow="What you'll work on" title="Strength, technique, movement." />
          <ul className="mt-8 flex flex-col gap-3 lg:col-span-7 lg:mt-0">
            {oneToOne.cards.map((f, i) => (
              <li key={f.title} data-reveal style={revealDelay(i)} className="grid grid-cols-1 gap-1 rounded-[1.25rem] bg-white px-5 py-5 min-[421px]:grid-cols-[7.5rem_1fr] min-[421px]:gap-4">
                <h3 className="font-bold">{f.title}</h3>
                <p className="min-w-0">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section tone="white" id="included" labelledBy="included-heading">
        <SectionHeading id="included-heading" eyebrow="1:1 personal coaching" title="What's included." />
        <div className="mt-8">
          <Boxes items={oneToOne.included} label="What's included in 1:1 coaching" />
        </div>
      </Section>

      <Section id="pricing" labelledBy="pricing-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="pricing-heading" className="lg:col-span-5" eyebrow="Pricing" title="Sessions and monthly coaching." intro={oneToOne.pricingIntro} />
          <div className="mt-8 lg:col-span-7 lg:mt-0">
            {prices.length > 0 && prices.every((p) => p.sessions) ? (
              // Boxes (owner's design): the bundle in ink, dots for its sessions.
              <ul className="grid grid-cols-1 gap-3 min-[361px]:grid-cols-2">
                {prices.map((p, i) => {
                  const bundle = (p.sessions ?? 1) > 1;
                  const note = bundle ? `${p.unit}, ${formatGbp(p.amountGbp / (p.sessions ?? 1))} a session` : p.unit;
                  return (
                    <li
                      key={p.label}
                      data-reveal
                      style={revealDelay(i)}
                      className={`flex min-w-0 flex-col gap-2 rounded-[1.375rem] border-[1.5px] border-ink px-[1.125rem] py-[1.375rem] ${bundle ? "bg-ink text-paper" : ""}`}
                    >
                      <h3 className="text-[0.8125rem] font-semibold tracking-[0.12em] uppercase">{p.label}</h3>
                      <p className="font-display text-[clamp(2rem,9vw,2.75rem)] leading-none font-bold tracking-tight tabular-nums">{formatGbp(p.amountGbp)}</p>
                      <p>{note}</p>
                      {p.description ? <p className="text-sm">{p.description}</p> : null}
                      <span aria-hidden="true" className="mt-1.5 flex gap-1.5">
                        {Array.from({ length: p.sessions ?? 1 }, (_, n) => (
                          <i key={n} className="size-2.5 rounded-full border-[1.5px] border-current bg-current" />
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <PriceList prices={service.prices} />
            )}
          </div>
        </div>
      </Section>

      <CtaBand title="Ready to train 1:1?" body={null} service="one-to-one" tone="white" />
    </div>
  );
}

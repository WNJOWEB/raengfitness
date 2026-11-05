import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { getService } from "@/content/services";
import { smallGroupCoaching } from "@/content/smallGroup";
import { coachingIntro, oneToOne } from "@/content/coaching";
import { images } from "@/content/images";
import { getPrimaryCta, getPrimaryCtaFor } from "@/lib/booking";
import { StartTraining } from "@/components/ui/StartTraining";
import { Section, SectionHeading } from "@/components/ui/Section";
import { publishable } from "@/lib/publish";
import { formatGbp } from "@/lib/schedule";
import { revealDelay } from "@/lib/reveal";
import { PageHeader } from "@/components/sections/PageHeader";
import { FocusFrame } from "@/components/sections/CoachingGraphics";
import { PriceList } from "@/components/sections/PriceList";
import { CtaBand } from "@/components/sections/CtaBand";

export const metadata: Metadata = pageMetadata({
  title: "1:1 Personal & Small Group Coaching",
  description:
    "Personalised, face-to-face kettlebell coaching in Cumbernauld, Glasgow: 1:1 personal coaching and small group coaching, designed around your goals, experience and ability.",
  path: "/coaching",
});

const card = "rounded-[1.25rem] bg-white px-5 py-5";

/** Numbered white boxes ("What's included", small group benefits). */
function Boxes({ items, label }: { items: readonly { title: string; body: string }[]; label: string }) {
  return (
    <ol aria-label={label} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {items.map((item, i) => (
        <li key={item.title} data-reveal style={revealDelay(i)} className={card}>
          <p className="eyebrow" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </p>
          <h4 className="mt-3 font-bold">{item.title}</h4>
          <p className="mt-2">{item.body}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Coaching, as Alex asked on 2026-11-05: Alex's intro, then two clearly
 * separate sections, 1:1 Personal Coaching and Small Group Coaching, each with
 * its own description, benefits, what's included and pricing or information.
 * Small group has no price yet (none supplied), so it says so; its button is
 * an enquiry, never a booking. The closing band is the 1:1 booking request.
 */
export default function CoachingPage() {
  const service = getService("one-to-one");
  const booking = getPrimaryCta();
  const prices = publishable(service.prices);
  const small = smallGroupCoaching;
  const enquiry = getPrimaryCtaFor("small-group");

  return (
    <div className="section-rules">
      <PageHeader
        panel={<FocusFrame photo={images.coachHeader} />}
        eyebrow="1:1 & small group coaching"
        title="Coaching built around you."
        intro={<p>{coachingIntro}</p>}
      >
        <StartTraining href={booking.href} label={booking.label} external={booking.external} className="w-full sm:w-[22rem]" />
      </PageHeader>

      <Section id="one-to-one" labelledBy="one-to-one-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="one-to-one-heading" className="lg:col-span-5" eyebrow="1:1 Personal Coaching" title={`${oneToOne.heading}.`} intro={oneToOne.intro} />
          {/* The three information cards: the name beside its line, like "What we stand for" on About. */}
          <ul className="mt-8 flex flex-col gap-3 lg:col-span-7 lg:mt-0">
            {oneToOne.cards.map((f, i) => (
              <li key={f.title} data-reveal style={revealDelay(i)} className="grid grid-cols-1 gap-1 rounded-[1.25rem] bg-white px-5 py-5 min-[421px]:grid-cols-[7.5rem_1fr] min-[421px]:gap-4">
                <h3 className="font-bold">{f.title}</h3>
                <p className="min-w-0">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div id="included" className="mt-14">
          <h3 className="font-display text-h3">What&apos;s included</h3>
          <div className="mt-6">
            <Boxes items={oneToOne.included} label="What's included in 1:1 coaching" />
          </div>
        </div>

        <div id="pricing" className="mt-14 lg:grid lg:grid-cols-12 lg:gap-x-14">
          <div className="lg:col-span-5">
            <h3 className="font-display text-h3">Pricing</h3>
            <p className="mt-3 max-w-md">{oneToOne.pricingIntro}</p>
          </div>
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
                      <h4 className="text-[0.8125rem] font-semibold tracking-[0.12em] uppercase">{p.label}</h4>
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

      <Section tone="white" id="small-group" labelledBy="small-group-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <div className="lg:col-span-5">
            <SectionHeading id="small-group-heading" eyebrow="Small Group Coaching" title={small.heading} intro={small.summary} />
            <StartTraining
              href={enquiry.href}
              label={enquiry.kind === "booking" ? small.askLabel : enquiry.label}
              srSuffix=" (small group coaching)"
              external={enquiry.external}
              className="mt-8 w-full sm:w-[22rem]"
            />
          </div>
          <div className="mt-10 lg:col-span-7 lg:mt-0">
            <h3 className="eyebrow">What to expect</h3>
            <ul className="lined mt-4">
              {small.included.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <h3 className="eyebrow mt-10">Pricing and availability</h3>
            <p className="mt-4">{small.pricing}</p>
          </div>
        </div>
        <div className="mt-14">
          <h3 className="font-display text-h3">Benefits</h3>
          <div className="mt-6">
            <Boxes items={small.benefits} label="Benefits of small group coaching" />
          </div>
        </div>
      </Section>

      {/* "Get in touch" here is the owner's own wording (2026-10-29); it still opens the 1:1 booking request. */}
      <CtaBand title="Ready to train 1:1?" body={null} service="one-to-one" label="Get in touch" />
    </div>
  );
}

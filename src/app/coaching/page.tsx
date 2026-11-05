import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/content/site";
import Link from "next/link";
import type { Service } from "@/content/types";
import { getService } from "@/content/services";
import { coachingIntro, oneToOne, smallGroup } from "@/content/coaching";
import { getOnlineCoachingAction, getPrimaryCtaFor } from "@/lib/booking";
import { InstagramAlternative } from "@/components/ui/InstagramAlternative";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { StartTraining } from "@/components/ui/StartTraining";
import { Section } from "@/components/ui/Section";
import { PageHeader } from "@/components/sections/PageHeader";
import { PriceList } from "@/components/sections/PriceList";
import { CtaBand } from "@/components/sections/CtaBand";
import { KeepHyphens } from "@/components/ui/KeepHyphens";

export const metadata: Metadata = pageMetadata({
  title: "1:1 Personal, Small Group & Online Kettlebell Coaching",
  description:
    "Personalised, face-to-face kettlebell coaching in Cumbernauld: 1:1 personal coaching, small group coaching, or online coaching with personalised programming, support and progression.",
  path: "/coaching",
});

type Tone = "paper" | "ink";

const muted = (tone: Tone) => (tone === "ink" ? "text-muted-inverse" : "text-muted");

/** A short numbered box: "01 · Title" and a sentence. */
function NumberedBoxes({ items, tone, label }: { items: { title: string; body: string }[]; tone: Tone; label: string }) {
  return (
    <ol aria-label={label} className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {items.map((item, i) => (
        <li key={item.title} className={cn("border p-6", tone === "ink" ? "border-line-inverse" : "border-ink")}>
          <p className={cn("eyebrow", muted(tone))} aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </p>
          <h4 className="mt-3 text-lg font-bold">{item.title}</h4>
          <p className={cn("mt-2", muted(tone))}>{item.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** Label and sentence rows, ruled like a table. */
function InfoRows({ items, tone }: { items: { title: string; body: string }[]; tone: Tone }) {
  return (
    <dl className={cn("divide-y border-y", tone === "ink" ? "divide-line-inverse border-line-inverse" : "divide-line border-line")}>
      {items.map((item) => (
        <div key={item.title} className="grid grid-cols-1 gap-1 py-5 sm:grid-cols-[8rem_1fr] sm:gap-6">
          <dt className="font-display text-lg">{item.title}</dt>
          <dd className={muted(tone)}>{item.body}</dd>
        </div>
      ))}
    </dl>
  );
}

function OneToOneSection() {
  const service = getService("one-to-one");
  const cta = getPrimaryCtaFor("one-to-one");
  return (
    <Section id="one-to-one" labelledBy="one-to-one-heading">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <p className="eyebrow text-muted">01 · 1:1 Personal Coaching</p>
          <h2 id="one-to-one-heading" className="mt-4 font-display text-h2 text-balance">
            {oneToOne.heading}
          </h2>
          <p className="mt-6 max-w-xl text-lede text-muted">{oneToOne.intro}</p>
          <StartTraining
            href={cta.href}
            label={cta.label}
            srSuffix=" (1:1 personal coaching)"
            external={cta.external}
            tone="light"
            className="mt-10 w-full sm:w-[22rem]"
          />
          {cta.kind === "booking" ? (
            <>
              <p className="mt-4 max-w-xl text-sm text-muted">
                Send a booking request with the days and times that suit you, and Alex confirms your session.
              </p>
              <InstagramAlternative className="mt-2" />
            </>
          ) : null}
        </div>
        <div className="lg:col-span-5 lg:col-start-8">
          <h3 className="eyebrow mb-4 text-muted">What you&apos;ll work on</h3>
          <InfoRows items={oneToOne.cards} tone="paper" />
        </div>
      </div>

      <div className="mt-16">
        <h3 className="font-display text-h3">What&apos;s included</h3>
        <div className="mt-6">
          <NumberedBoxes items={oneToOne.included} tone="paper" label="What's included in 1:1 coaching" />
        </div>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h3 className="font-display text-h3">Pricing</h3>
          <p className="mt-3 max-w-md text-muted">{oneToOne.pricingIntro}</p>
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          <PriceList prices={service.prices} />
        </div>
      </div>
    </Section>
  );
}

function SmallGroupSection() {
  const cta = getPrimaryCtaFor("small-group");
  return (
    <Section tone="ink" id="small-group" labelledBy="small-group-heading">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <p className="eyebrow text-muted-inverse">02 · {smallGroup.eyebrow}</p>
          <h2 id="small-group-heading" className="mt-4 font-display text-h2 text-balance">
            {smallGroup.heading}
          </h2>
          <p className="mt-6 max-w-xl text-lede text-muted-inverse">{smallGroup.intro}</p>
          <StartTraining
            href={cta.href}
            label={cta.kind === "booking" ? smallGroup.cta : cta.label}
            srSuffix=" (small group coaching)"
            external={cta.external}
            tone="dark"
            className="mt-10 w-full sm:w-[22rem]"
          />
        </div>
        <div className="space-y-10 lg:col-span-5 lg:col-start-8">
          <div>
            <h3 className="eyebrow text-muted-inverse">What to expect</h3>
            <ul className="mt-4 divide-y divide-line-inverse border-y border-line-inverse">
              {smallGroup.included.map((point) => (
                <li key={point} className="py-4 font-semibold">
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="eyebrow mb-4 text-muted-inverse">Pricing and availability</h3>
            <p className="border-y border-line-inverse py-4 text-muted-inverse">{smallGroup.pricing}</p>
          </div>
        </div>
      </div>

      <div className="mt-16">
        <h3 className="font-display text-h3">Benefits</h3>
        <div className="mt-6">
          <NumberedBoxes items={smallGroup.benefits} tone="ink" label="Benefits of small group coaching" />
        </div>
      </div>
    </Section>
  );
}

function OnlineSection({ service }: { service: Service }) {
  const enquiry = getOnlineCoachingAction();
  return (
    <Section id="online" labelledBy="online-heading">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <p className="eyebrow text-muted">03 · Online coaching</p>
          <h2 id="online-heading" className="mt-4 font-display text-h2 text-balance">
            <KeepHyphens>{service.name}</KeepHyphens>
          </h2>
          <p className="mt-6 max-w-xl text-lede text-muted">
            Online coaching with personalised programming, support and progression, so you can train with a plan wherever
            you are. Tell Alex about your goals and he&apos;ll reply personally to talk it through.
          </p>
          <StartTraining href={enquiry.href} label={enquiry.label} external={enquiry.external} tone="light" className="mt-10 w-full sm:w-[22rem]" />
        </div>
        <div className="space-y-10 lg:col-span-5 lg:col-start-8">
          {service.points.length > 0 ? (
            <div>
              <h3 className="eyebrow text-muted">What it involves</h3>
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {service.points.map((point) => (
                  <li key={point} className="py-4 font-semibold">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h3 className="eyebrow mb-4 text-muted">Pricing</h3>
            <PriceList prices={service.prices} />
          </div>
        </div>
      </div>
    </Section>
  );
}

export default function CoachingPage() {
  return (
    <>
      <PageHeader image={site.pageImages.coaching} eyebrow="Personal coaching" title="Coaching built around you" intro={coachingIntro}>
        <nav aria-label="Coaching options" className="flex flex-wrap gap-3">
          <ButtonLink href="#one-to-one" variant="secondary">
            1:1 personal
          </ButtonLink>
          <ButtonLink href="#small-group" variant="secondary">
            Small group
          </ButtonLink>
          <ButtonLink href="#online" variant="secondary">
            Online
          </ButtonLink>
        </nav>
      </PageHeader>

      <OneToOneSection />
      <SmallGroupSection />
      <OnlineSection service={getService("online-coaching")} />

      <Section tone="surface" spacing="compact" labelledBy="classes-link-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="classes-link-heading" className="text-lg font-bold">
            Prefer training in a group?
          </h2>
          <Link
            href="/classes"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] underline underline-offset-[6px] hover:no-underline"
          >
            See group classes <span aria-hidden="true">→</span>
          </Link>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}

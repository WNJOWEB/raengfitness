import type { Metadata } from "next";
import Image from "next/image";
import { site } from "@/content/site";
import { pageMetadata } from "@/lib/metadata";
import { getPrimaryCta } from "@/lib/booking";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { StartTraining } from "@/components/ui/StartTraining";
import { Section, SectionHeading } from "@/components/ui/Section";
import { HowToBook } from "@/components/sections/HowToBook";
import { Faq } from "@/components/sections/Faq";
import { CtaBand } from "@/components/sections/CtaBand";
import { HeroVideo } from "@/components/sections/HeroVideo";
import { Journey } from "@/components/sections/Journey";
import { WaysToTrain } from "@/components/sections/WaysToTrain";
import { revealDelay } from "@/lib/reveal";

export const metadata: Metadata = pageMetadata({ description: site.description, path: "/" });

// Benefits are hedged and make no promises about specific results. Four short
// points (2026-10-18): the earlier six repeated each other and read as a list.
const benefits = [
  { title: "Build strength", body: "Swings, squats and presses work the whole body." },
  { title: "Get fitter", body: "Train strength and conditioning in the same session." },
  { title: "Move well", body: "Learn the key lifts with a coach on your technique." },
  { title: "Train anywhere", body: "One kettlebell. At home, in the gym or away." },
];

function Hero() {
  const booking = getPrimaryCta();
  const video = site.heroVideo;
  const intro = `Expert kettlebell coaching in ${site.location.town}.`;
  // Phones show only the first sentence: under the display headline a small two-line paragraph read as cramped.
  const introMore = "Build strength, improve technique and move with confidence.";

  // Phones and tablets (<1024px): the video at its full 4:5 frame, never
  // cropped, with the headline, intro line and button over its lower part on a
  // dark fade, so video, headline and button fit the first screen. Phones run
  // it edge to edge (it breaks out of the gutters); tablets keep the gutters
  // and cap its width so the whole frame fits the screen height. The DOM order
  // (headline, intro, button, video) stays the same.
  // Desktop: text beside the video, which is as large as the first view
  // allows (up to its half of the grid) without cropping.
  return (
    <section aria-labelledby="hero-heading" className="relative bg-paper">
      {/* Tablets: ink fills the gap under the header (same height as the
          container's top padding) so header and video join up. Phones have no
          gap; desktop keeps the video on paper. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 hidden h-6 bg-ink sm:block lg:hidden" />
      {/* Phones: no bottom padding, so the edge-to-edge video runs straight into the ink "What I offer" band. */}
      <div className="container-page pt-0 pb-0 sm:pt-6 sm:pb-10 lg:pt-4 lg:pb-8">
        <div className="lg:grid lg:min-h-[calc(100svh-7rem)] lg:grid-cols-12 lg:grid-rows-[1fr_auto_auto_1fr] lg:gap-x-10">
          <div className="relative -mx-4 sm:mx-0 sm:w-[min(100%,calc((100svh-6.5rem)*0.8))] lg:contents">
            {/* Phones and tablets: laid over the bottom of the video. Desktop: grid cells. */}
            <div className="absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-ink/90 via-ink/70 via-65% to-transparent max-sm:from-ink max-sm:from-10% px-4 pt-28 pb-3 sm:px-8 sm:pt-44 sm:pb-8 lg:contents">
              <div className="lg:col-span-6 lg:row-start-2">
                <h1 id="hero-heading" className="hero-headline font-display text-display text-balance lg:text-display-split">
                  <span className="block">Get stronger.</span>
                  <span className="block">Move better.</span>
                </h1>
                <p className="mt-3 max-w-md text-base text-paper/85 lg:mt-5 lg:text-lede lg:text-muted">
                  {intro}
                  <span className="max-sm:hidden"> {introMore}</span>
                </p>
              </div>
              <div className="mt-5 sm:mt-6 lg:col-span-6 lg:row-start-3 lg:mt-8">
                <StartTraining
                  href={booking.href}
                  label={booking.label}
                  external={booking.external}
                  tone="light"
                  className="w-full max-lg:bg-paper max-lg:text-ink max-lg:focus-visible:outline-paper sm:w-[22rem]"
                  handleClassName="max-lg:bg-ink max-lg:text-paper"
                />
              </div>
            </div>
            {video ? (
              <div className="lg:col-span-6 lg:col-start-7 lg:row-span-4 lg:row-start-1 lg:flex lg:items-center lg:justify-end">
                <HeroVideo
                  sources={video.sources}
                  poster={video.poster}
                  className="w-full lg:w-[min(100%,calc((100svh-7rem)*0.8),44rem)]"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

// No button here: the hero (above) and "Choose how you train" (below) carry it.
// Minimal: four numbered points in a 2 × 2 grid with hairlines, not a long list.
function Benefits() {
  return (
    <Section tone="surface" id="why-kettlebells" labelledBy="benefits-heading">
      <div className="grid grid-cols-1 gap-10 sm:gap-12 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-5">
          <SectionHeading
            id="benefits-heading"
            eyebrow="Why kettlebells"
            title="Stronger, fitter, more confident"
            intro="One simple tool that trains the whole body. Good coaching gets the most from it."
          />
        </div>
        <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:gap-x-8 sm:gap-y-10 lg:col-span-7">
          {benefits.map((b, i) => (
            <li key={b.title} data-reveal style={revealDelay(i)} className="border-t border-line pt-4 sm:pt-5">
              <p className="eyebrow text-muted" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-3 font-display text-base sm:text-lg">{b.title}</h3>
              <p className="mt-1.5 text-sm text-muted sm:text-base">{b.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}


/**
 * About RAENG: the brand, its identity and values: not the coach. Alex's
 * portrait and coach biography were removed 2026-11-05 at his request. The
 * values restate what the site already says about how the coaching works
 * (personal, technique-led, structured, supportive); Alex to review the wording.
 */
const values = [
  { title: "Personal", body: "Coaching shaped around your goals, experience and ability." },
  { title: "Technique first", body: "Learn the key movements properly, with guidance and feedback." },
  { title: "Progressive", body: "Structured training that builds strength, fitness and confidence." },
  { title: "Supportive", body: "A welcoming environment, whatever your level." },
];

function About() {
  const stills = site.trainingStills.slice(0, 3);
  const { instagram } = site.social;
  return (
    <Section id="about" labelledBy="about-heading">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-center lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHeading
            id="about-heading"
            eyebrow="About RAENG"
            title="Strength, technique, confidence"
            intro={
              <p>
                RAENG is kettlebell coaching in {site.location.town}, built around personal attention, good technique
                and steady progression. In a group, a small group or one to one, the aim is the same: help you get
                stronger, move better and feel more confident.
              </p>
            }
          />
          <dl className="mt-8 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {values.map((v) => (
              <div key={v.title} className="border-t border-line py-4">
                <dt className="font-display text-base">{v.title}</dt>
                <dd className="mt-1 text-sm text-muted">{v.body}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <ButtonLink href={instagram.url} external variant="secondary">
              Follow {instagram.handle}
            </ButtonLink>
            <p className="text-sm text-muted">
              <span className="font-display text-h3 text-ink">{instagram.followers}</span> followers on Instagram
            </p>
            <a
              href={site.social.facebook.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:no-underline"
            >
              Also on Facebook<span className="sr-only"> ({site.social.facebook.name}, opens in a new tab)</span>
            </a>
          </div>
        </div>
        {stills.length > 0 ? (
          // Phones: a swipeable row of large photos (the next one peeks in), not
          // three thumbnails. From sm: three across, staggered on desktop. The
          // row is focusable so keyboard users can scroll it with the arrow keys.
          <ul
            className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:col-span-7"
            aria-label="From the training"
            tabIndex={0}
          >
            {stills.map((photo, i) => (
              <li
                key={photo.src}
                data-reveal
                style={revealDelay(i)}
                className={cn("w-[72%] shrink-0 snap-start sm:w-auto", i === 1 ? "lg:mt-16" : i === 2 ? "lg:mt-8" : undefined)}
              >
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  sizes="(min-width: 1024px) 18vw, (min-width: 640px) 33vw, 72vw"
                  className="aspect-[4/5] w-full object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  );
}


export default function HomePage() {
  return (
    <>
      <Hero />
      {/* Order answers Alex's four questions: why kettlebells, what he offers, who he is, where and how to book. */}
      <Benefits />
      <WaysToTrain />
      <About />
      <Journey />
      <HowToBook />
      <Faq />
      <CtaBand />
    </>
  );
}

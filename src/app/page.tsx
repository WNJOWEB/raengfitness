import type { Metadata } from "next";
import { site } from "@/content/site";
import { pageMetadata } from "@/lib/metadata";
import { CoachStory } from "@/components/home/CoachStory";
import { ClassPicker, classesTitle } from "@/components/home/ClassPicker";
import { Hero } from "@/components/home/Hero";
import { homeCoach } from "@/content/home";
import { MoreWays } from "@/components/home/MoreWays";
import { Testimonials } from "@/components/home/Testimonials";
import { WhyKettlebells } from "@/components/home/WhyKettlebells";
import { PlanList, PlanTerms } from "@/components/memberships/PlanList";
import { CtaBand } from "@/components/sections/CtaBand";
import { getPrimaryCtaFor } from "@/lib/booking";
import { Faq } from "@/components/sections/Faq";
import { PhilosophyTeaser } from "@/components/home/PhilosophyTeaser";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/ui/Section";

export const metadata: Metadata = pageMetadata({
  description: site.description,
  path: "/",
});

// Home order: Alex's layout (2026-10-29; his feedback overrides earlier owner
// decisions, including the 2026-10-27 order): the film and Book now; services;
// why kettlebells; the classes (rows of days and times, one box to view
// classes and book, the address); memberships; Meet your coach ("less about
// me"), then members' words once there are any; RAENG's philosophy; the
// questions; and the closing "Ready to start?" band (the owner, 2026-10-29: it
// isn't one of the Book now buttons Alex meant, which were in the location part).
// Phones read top to bottom; from lg the heading sits left of its content.
const split = "lg:grid lg:grid-cols-12 lg:gap-x-14";
export default function HomePage() {
  return (
    <>
      <Hero />
      <div className="section-rules">
        <MoreWays />
        <Section id="classes" labelledBy="classes-heading">
          <div className={split}>
            {/* The owner's class times (2026-10-28), also on /classes; the count comes from the timetable. */}
            <SectionHeading
              id="classes-heading"
              className="lg:col-span-5"
              eyebrow="Classes"
              title={classesTitle()}
            />
            <ClassPicker className="mt-8 lg:col-span-7 lg:mt-0" />
          </div>
        </Section>
        {/* Alex via the owner, 2026-10-29: no "Save up to" line or intro (each price says "every 4 weeks"), and less space before the next section. */}
        <Section
          id="memberships"
          labelledBy="memberships-heading"
          className="pb-4 sm:pb-8 lg:pb-12"
        >
          <div className={split}>
            <SectionHeading
              id="memberships-heading"
              className="lg:col-span-5"
              title="Memberships."
            />
            <div className="mt-8 lg:col-span-7 lg:mt-0">
              <PlanList />
              <PlanTerms className="mt-8" />
            </div>
          </div>
        </Section>
        {/* Why kettlebells sits under Memberships (owner, 2026-10-30). */}
        <WhyKettlebells />
        <CoachStory tone="plain" alex={homeCoach} showAboutLink={false} />
        <Testimonials />
        <PhilosophyTeaser />
        <Faq
          tone="plain"
          ids={["beginners", "bring", "length", "where", "one-to-one-vs-small-group"]}
          footer={
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:no-underline"
            >
              More questions and contact details
            </Link>
          }
        />
        {/* The closing button reads "Book a class" (owner, 2026-10-29), like the hero; where booking is off it keeps the page's honest wording. */}
        <CtaBand
          id="book"
          body={null}
          instagram={false}
          tone="plain"
          label={
            getPrimaryCtaFor("any").kind === "booking"
              ? "Book a class"
              : undefined
          }
        />
      </div>
    </>
  );
}

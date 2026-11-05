import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { onlineJoinEnabled } from "@/lib/membership-checkout";
import { PayAsYouGo, PlanList, PlanTerms } from "@/components/memberships/PlanList";
import { Faq } from "@/components/sections/Faq";
import { ClassPicker, classesTitle } from "@/components/home/ClassPicker";
import { CancellationPolicy } from "@/components/memberships/CancellationPolicy";
import { images } from "@/content/images";
import { getPrimaryCtaFor } from "@/lib/booking";
import { Section, SectionHeading } from "@/components/ui/Section";
import { ClassesHero } from "@/components/classes/ClassesHero";
import { StudioLocation } from "@/components/classes/StudioLocation";

// Read at build time like every booking setting: the request form when it's open, else a message.
const bookingOpen = getPrimaryCtaFor("group-class").kind === "booking";

export const metadata: Metadata = pageMetadata({
  title: "Group Kettlebell Classes",
  description: bookingOpen
    ? onlineJoinEnabled()
      ? "Group kettlebell classes in Cumbernauld. See the class times and price, and book and pay online."
      : "Group kettlebell classes in Cumbernauld. See the class times and price, and request your place online."
    : "Group kettlebell classes in Cumbernauld. Book now to join a session.",
  path: "/classes",
});

/**
 * The classes page, in the order of Alex's layout (2026-10-29): the full
 * timetable, the studio location, memberships, pay as you go, the booking and
 * cancellation policy, the questions. Nothing else (no "what the classes
 * build", no "other ways to train" line). The class film and its Book a class
 * button open the page.
 */
export default function ClassesPage() {
  const booking = getPrimaryCtaFor("group-class");

  return (
    <div className="section-rules">
      <ClassesHero
        photo={images.classes}
        title="Group kettlebell training."
        eyebrow="Classes in Cumbernauld"
        cta={{
          href: booking.href,
          // Alex's wording for the hero button (the owner, 2026-10-29), as on the home page.
          label: booking.kind === "booking" ? "Book a class" : booking.label,
          external: booking.external,
        }}
      />

      <Section id="timetable" labelledBy="timetable-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="timetable-heading" className="lg:col-span-5" eyebrow="Timetable" title={classesTitle()} />
          <ClassPicker className="mt-8 lg:col-span-7 lg:mt-0" location={false} button={false} />
        </div>
      </Section>

      <Section id="location" labelledBy="location-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="location-heading" className="lg:col-span-5" eyebrow="Studio location" title="Where we train." />
          <StudioLocation className="mt-8 lg:col-span-7 lg:mt-0" />
        </div>
      </Section>

      <Section id="memberships" labelledBy="memberships-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="memberships-heading" className="lg:col-span-5" title="Memberships." />
          <div className="mt-8 lg:col-span-7 lg:mt-0">
            <PlanList includePayg={false} />
            <PlanTerms className="mt-8" />
          </div>
        </div>
      </Section>

      <Section id="pay-as-you-go" labelledBy="payg-heading">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="payg-heading" className="lg:col-span-5" title="Pay as you go." />
          <PayAsYouGo className="mt-8 lg:col-span-7 lg:mt-0" />
        </div>
      </Section>

      <CancellationPolicy title="Booking and cancellation policy" />

      <Faq tone="plain" ids={["beginners", "bring", "length", "where"]} />
    </div>
  );
}

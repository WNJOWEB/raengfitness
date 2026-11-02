import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { PinIcon } from "@/components/ui/ContactIcons";
import { MailIcon } from "@/components/ui/MailIcon";
import { RevealPhone } from "@/components/ui/RevealPhone";
import { scramblePhone } from "@/lib/phone";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/metadata";
import { mapsUrl, site } from "@/content/site";
import { faq } from "@/content/faq";
import { firstClassSteps } from "@/content/home";
import { isPublishable } from "@/lib/publish";
import { Section, SectionHeading } from "@/components/ui/Section";
import { PageHeader } from "@/components/sections/PageHeader";
import { Faq } from "@/components/sections/Faq";

export const metadata: Metadata = pageMetadata({
  title: "FAQs & Contact",
  description:
    "Common questions and contact details for RAENG Fitness: classes, memberships, 1:1 coaching and small group coaching in Cumbernauld, Glasgow.",
  path: "/contact",
});

const linkClass = "inline-flex min-h-11 shrink-0 items-center font-semibold underline underline-offset-4 hover:no-underline";

/** One way in: an icon, what it is (and its detail), and its link on the right. */
function Way({ title, detail, icon, children }: { title: string; detail?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-[1.25rem] bg-white px-5 py-3 max-[400px]:flex-col max-[400px]:items-start max-[400px]:gap-0 sm:px-6">
      <div className="flex min-w-0 items-center gap-4 py-1">
        {icon ? (
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-paper text-ink">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="card-title">{title}</p>
          {detail ? <div className="mt-0.5 text-[0.9375rem] max-[400px]:text-[0.875rem] [overflow-wrap:anywhere]">{detail}</div> : null}
        </div>
      </div>
      {/* Under 400px the link sits under the text (its left edge lines up with the text, past the icon) so an email address stays on one line. */}
      <div className="shrink-0 max-[400px]:pl-[3.75rem]">{children}</div>
    </li>
  );
}

/**
 * FAQs & Contact (owner, 2026-11-02, replacing Alex's order of 2026-10-29): the
 * contact details first (email, Instagram, phone once confirmed, then the
 * address with directions), then the common questions, then getting started.
 * Instagram is one of the contact rows (no section of its own). Nothing else
 * (no Book row, no Facebook; the footer has it).
 */
export default function ContactPage() {
  const { email, phone } = site.contact;
  const l = site.location;
  const live = (id: string) => {
    const item = faq.find((f) => f.id === id);
    return item !== undefined && isPublishable(item.status);
  };
  const started: string[] = [];
  if (live("beginners")) started.push(firstClassSteps.beginners);
  if (live("first-session")) started.push(firstClassSteps.firstSession);
  if (live("bring")) started.push(firstClassSteps.bring);

  return (
    <div className="section-rules">
      <PageHeader eyebrow="FAQs & Contact" title="FAQs & Contact" intro="Book, message Alex, or come and find us." compact />

      <Section tone="white" id="contact-details" labelledBy="details-heading" className="pt-6 sm:pt-8 lg:pt-10">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
          <SectionHeading id="details-heading" className="lg:col-span-5" eyebrow="Contact details" title="Find us." />
          <ul id="ways" className="mt-8 flex max-w-2xl flex-col gap-3 lg:col-span-7 lg:mt-0">
            {email ? (
              <Way title="Email" detail={email} icon={<MailIcon className="size-6" />}>
                <a href={`mailto:${email}`} className={linkClass}>
                  Email<span className="sr-only"> {email}</span>
                </a>
              </Way>
            ) : null}
            <Way title="Instagram" detail={site.social.raeng.handle} icon={<InstagramIcon className="size-6" />}>
              <a href={site.social.raeng.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                Open<span className="sr-only"> {site.social.raeng.handle} on Instagram (opens in a new tab)</span>
              </a>
            </Way>
            {phone ? <RevealPhone mode="row" scrambled={scramblePhone(phone)} /> : null}
            <Way title={l.street} detail={<address className="not-italic">{`${l.town}, ${l.city}, ${l.postcode}`}</address>} icon={<PinIcon className="size-6" />}>
              <a href={mapsUrl()} target="_blank" rel="noopener noreferrer" className={linkClass}>
                Directions<span className="sr-only"> to the class location (opens in a new tab)</span>
              </a>
            </Way>
          </ul>
        </div>
      </Section>

      <Faq tone="plain" />

      {started.length > 0 ? (
        <Section tone="white" id="getting-started" labelledBy="started-heading">
          <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
            <SectionHeading id="started-heading" className="lg:col-span-5" eyebrow="Getting started" title="Your first class." />
            <div className="mt-8 lg:col-span-7 lg:mt-0">
              <ul className="lined max-w-xl">
                {started.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Link href="/classes" className={`mt-4 ${linkClass}`}>
                View classes and book
              </Link>
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

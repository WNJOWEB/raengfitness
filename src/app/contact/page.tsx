import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { PinIcon } from "@/components/ui/ContactIcons";
import { tileBadgeClass, tileClass } from "@/components/ui/contact-tile";
import { MailIcon } from "@/components/ui/MailIcon";
import { RevealPhone } from "@/components/ui/RevealPhone";
import { scramblePhone } from "@/lib/phone";
import type { Metadata } from "next";
import Link from "next/link";
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

/** The email address, with a break allowed just before the @ so a narrow tile wraps it neatly. */
function EmailText({ email }: { email: string }) {
  const at = email.indexOf("@");
  return at < 0 ? <>{email}</> : (<>{email.slice(0, at)}<wbr />{email.slice(at)}</>);
}

/**
 * FAQs & Contact (owner, 2026-11-02, replacing Alex's order of 2026-10-29): the
 * contact details first (email, Instagram, phone once confirmed, then the
 * address with directions), then the common questions, then getting started.
 * Instagram is one of the four contact tiles (no section of its own). Nothing else
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
      <PageHeader eyebrow="FAQs & Contact" title="FAQs & Contact" intro="Questions, bookings or directions: everything is here." compact />

      <Section tone="white" id="contact-details" labelledBy="details-heading" className="!pt-2 !pb-10 sm:!pt-4 lg:!pt-6">
        <h2 id="details-heading" className="sr-only">
          Contact details
        </h2>
        <ul id="ways" className="grid max-w-2xl grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          {email ? (
            <li>
              <a href={`mailto:${email}`} className={tileClass}>
                <span aria-hidden="true" className={tileBadgeClass}>
                  <MailIcon className="size-6" />
                </span>
                <span>
                  <span className="card-title block">Email</span>
                  <span className="block min-[360px]:min-h-[2.6rem] text-[0.8125rem]">
                    <EmailText email={email} />
                  </span>
                </span>
                <span className="sr-only">Email {email}</span>
              </a>
            </li>
          ) : null}
          <li>
            <a href={site.social.raeng.messageUrl} target="_blank" rel="noopener noreferrer" className={tileClass}>
              <span aria-hidden="true" className={tileBadgeClass}>
                <InstagramIcon className="size-6" />
              </span>
              <span>
                <span className="card-title block">Instagram</span>
                <span className="block min-[360px]:min-h-[2.6rem] text-[0.8125rem]">{site.social.raeng.handle}</span>
              </span>
              <span className="sr-only">Message {site.social.raeng.handle} on Instagram (opens in a new tab)</span>
            </a>
          </li>
          {phone ? <RevealPhone mode="tile" scrambled={scramblePhone(phone)} /> : null}
          <li>
            <a href={mapsUrl()} target="_blank" rel="noopener noreferrer" className={tileClass}>
              <span aria-hidden="true" className={tileBadgeClass}>
                <PinIcon className="size-6" />
              </span>
              <span>
                <span className="card-title block">Directions</span>
                <address className="block min-[360px]:min-h-[2.6rem] text-[0.8125rem] not-italic">
                  {l.street}, {l.town}&nbsp;{l.postcode.replace(" ", "\u00a0")}
                </address>
              </span>
              <span className="sr-only">Directions to the class location (opens in a new tab)</span>
            </a>
          </li>
        </ul>
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

import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/content/site";
import { Section } from "@/components/ui/Section";
import { PageHeader } from "@/components/sections/PageHeader";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Notice",
  description: "How Alex K Bells uses the details you send through the website.",
  path: "/privacy",
});

// Describes what this website actually does. Review with Alex before the
// booking form goes live (see DEPLOYMENT.md); update if anything changes.
const LAST_UPDATED = "18 October 2026";

const sections: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "Who we are",
    body: (
      <p>
        This website belongs to {site.name}, a kettlebell coach based at {site.location.venue},{" "}
        {site.location.street}, {site.location.town}, {site.location.postcode}. You can contact us on
        Instagram at{" "}
        <a href={site.social.instagram.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
          {site.social.instagram.handle}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    ),
  },
  {
    heading: "What we collect",
    body: (
      <p>
        When you send a booking request we receive your name, email address, phone number (if you
        give one), the service and class date or times you choose, your kettlebell experience and any note you
        write. When you send an online coaching enquiry we receive your answers (your goal,
        experience and where you train), your name, email address, how you&apos;d like to be
        contacted and the phone number or Instagram username you give for that. We don&apos;t ask
        about your health; please don&apos;t include medical details.
      </p>
    ),
  },
  {
    heading: "Why we use it",
    body: (
      <p>
        Only to reply to your request or enquiry and arrange your coaching, because you asked us to
        (UK GDPR Article 6(1)(b)). We don&apos;t use it for marketing and we don&apos;t sell or share it.
      </p>
    ),
  },
  {
    heading: "Where it goes",
    body: (
      <p>
        What you send is stored in our database (Supabase, hosted in the EU, Ireland) so Alex can see
        it in his password-protected coach area, and may also be sent to him by email, and we email you an acknowledgement, using our email
        provider (Resend). These providers handle it on our behalf. The website is hosted by Vercel, which processes
        standard technical information such as IP addresses to deliver and protect the site. These
        providers may process data outside the UK under appropriate safeguards.
      </p>
    ),
  },
  {
    heading: "How long we keep it",
    body: <p>Only as long as we need it to arrange and run your coaching, then we delete it.</p>,
  },
  {
    heading: "Cookies",
    body: (
      <p>
        This website does not use analytics, advertising or tracking cookies. The coach login sets
        two cookies that keep the coach signed in; they are only used on the coach&apos;s pages.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <p>
        You can ask to see, correct or delete the details we hold about you by contacting us on
        Instagram. If you&apos;re unhappy with how we&apos;ve handled your information, you can complain to
        the Information Commissioner&apos;s Office at{" "}
        <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
          ico.org.uk<span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Privacy" title="Privacy notice" intro={`Last updated ${LAST_UPDATED}.`} />
      <Section labelledBy="privacy-heading">
        <h2 id="privacy-heading" className="sr-only">
          How we use your details
        </h2>
        <div className="max-w-2xl space-y-10">
          {sections.map((s) => (
            <section key={s.heading}>
              <h3 className="text-lg font-bold">{s.heading}</h3>
              <div className="mt-2 text-muted">{s.body}</div>
            </section>
          ))}
        </div>
      </Section>
    </>
  );
}

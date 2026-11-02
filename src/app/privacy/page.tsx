import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/content/site";
import { Section } from "@/components/ui/Section";
import { PageHeader } from "@/components/sections/PageHeader";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Notice",
  description: "How RAENG uses the details you send through the website.",
  path: "/privacy",
});

// Describes what this website actually does. Review with Alex before the
// booking form goes live (see DEPLOYMENT.md); update if anything changes.
// 2026-10-26: membership requests and member accounts added (wording from
// docs/MEMBER_ACCOUNTS_DRAFT.md, approved by the owner; Alex to confirm,
// with a retention period and contact email if he wants one).
// 2026-10-28: accounts for everyone who has booked and paid (not only members),
// and the sign-in cookie is site-wide so booking forms can fill in details.
// 2026-10-28: online coaching area: programme, logged sets, weekly check-in
// ratings and notes, form-video links, messages (Alex to confirm).
// 2026-10-28: account menu pages: device and browser kind per session, class
// reminder choice, coded copy of the calendar link (Alex to confirm).
const LAST_UPDATED = "28 October 2026";

const sections: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "Who we are",
    body: (
      <p>
        This website belongs to {site.name}, a kettlebell coach based at{" "}
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
        contacted and the phone number or Instagram username you give for that. When you send a
        membership request we also receive the plan you choose, your first class if you pick one, and the
        date and time you agreed to the membership terms and cancellation policy. When you book a class or session we keep a record that you ticked the participation and risk terms: which version of the wording, and when. We don&apos;t ask for or keep any health details. If you pay online, you pay on
        Stripe&apos;s secure page: Stripe receives your card details, and we never see them; we receive the amount,
        the date and Stripe&apos;s reference for the payment. For a membership, the card you pay with is saved
        by Stripe, with your agreement on its page, so your membership can renew every four weeks until you
        cancel: we keep only Stripe&apos;s reference for it, the card&apos;s brand and last four digits (for example
        &quot;Visa ending 4242&quot;, so you can see which card is used), and whether each payment succeeded or failed.
        You can change the card or cancel from your account. If Direct Debit is offered and you choose it, Stripe
        receives your bank details and the mandate, and we never see them. If you book a class online, we also keep a coded copy
        of the private link we email you to cancel it, and of any class credit link. Once you&apos;ve paid for a
        class or a membership, you have an account: you can sign in with your email to see your classes and
        credits, and we keep your name, email and phone so the booking form can fill them in next time. When
        you sign in, we keep a record of each sign-in: a coded copy of the sign-in link and of
        your session, and when they were created, last used and ended, with the kind of device and browser
        (for example &quot;iPhone, Safari&quot;) so you can tell your devices apart and sign one out. Your
        account records don&apos;t hold where you are or your IP address. If you turn on class reminders we keep that choice and note which
        classes we&apos;ve reminded you of; if you make a calendar link we keep only a coded copy of it. If you
        have online coaching, your coaching area holds your programme, the weights and reps you log for each
        session, your weekly check-ins (how you rate your energy, sleep and training from 1 to 5, and what you write
        about your week), any link you paste to a form video (we keep the link, never the video), and your messages
        with Alex, so he can coach you. We don&apos;t ask about your health beyond that; please don&apos;t include
        medical details.
      </p>
    ),
  },
  {
    heading: "Why we use it",
    body: (
      <p>
        To reply to your request or enquiry and arrange your coaching, and to run your membership and your
        account, because you asked us to (UK GDPR Article 6(1)(b)); and to keep your account secure, which is
        in both our interests (Article 6(1)(f)). We don&apos;t use it for marketing and we don&apos;t sell or share it.
      </p>
    ),
  },
  {
    heading: "Where it goes",
    body: (
      <p>
        What you send is stored in our database (Supabase, hosted in the EU, Ireland) so Alex can see
        it in his password-protected coach area, and may also be sent to him by email using our email
        provider (Resend). Sign-in links, membership confirmations and payment links are emailed to you by the same
        provider. Online payments are taken by Stripe, which also processes them under its own privacy notice. These providers handle it on our behalf. The website is hosted by Vercel, which processes
        standard technical information such as IP addresses to deliver and protect the site. These
        providers may process data outside the UK under appropriate safeguards.
      </p>
    ),
  },
  {
    heading: "How long we keep it",
    body: (
      <p>
        Only as long as we need it to arrange and run your coaching, then we delete it. Sign-in links are
        deleted after a day, and records of your sessions 30 days after you sign out or they expire. Records of
        reminders sent are deleted after 60 days. Payment and booking records are kept for 6 years, because we
        need them for our accounts and tax records. Your name, email, phone and notes are deleted or made
        anonymous 2 years after your last booking, payment or message. A request or enquiry that never became a
        booking is deleted after 12 months. You can ask us to delete your details sooner (see below), except
        payment records we must keep.
      </p>
    ),
  },
  {
    heading: "Cookies",
    body: (
      <p>
        This website does not use analytics, advertising or tracking cookies. If you sign in to your account,
        we set one cookie that keeps you signed in for up to 30 days; it&apos;s only used for your account pages
        and to fill in your details on the booking forms, and signing out removes it. The coach login sets two cookies that keep the coach signed in;
        they are only used on the coach&apos;s pages.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <p>
        You can ask to see, correct or delete the details we hold about you by contacting us on
        Instagram. You can sign out of every device from your account page, or ask Alex to. If you&apos;re unhappy with how we&apos;ve handled your information, you can complain to
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
              <div className="mt-2 ">{s.body}</div>
            </section>
          ))}
        </div>
      </Section>
    </>
  );
}

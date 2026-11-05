import { formatAddressLines, mapsUrl, site } from "@/content/site";
import { timetable } from "@/content/classes";
import { getPrimaryCta } from "@/lib/booking";
import { isPublishable } from "@/lib/publish";
import { describeTimetable } from "@/lib/schedule";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { StartTraining } from "@/components/ui/StartTraining";
import { Section } from "@/components/ui/Section";
import { revealDelay } from "@/lib/reveal";
import { InstagramAlternative } from "@/components/ui/InstagramAlternative";

/**
 * "Where and how can I book?" answered in one place: the steps, the
 * "Book now" button, and where and when sessions happen. When the
 * booking flow is open, step 2 is the request form; otherwise a message.
 * Either way Alex confirms each place, so it never promises an instant booking.
 */
export function HowToBook() {
  const times = isPublishable(timetable.status) ? describeTimetable(timetable.sessions) : null;
  const cta = getPrimaryCta();

  const steps = [
    { title: "Choose how you train", body: "Group classes, 1:1 personal coaching, or a small group coaching enquiry." },
    cta.kind === "booking"
      ? { title: "Send your request", body: "Pick a class date, or the days and times that suit you for coaching, and send it in a minute." }
      : { title: "Get in touch", body: `Message Alex on Instagram (${site.social.instagram.handle}) with what you'd like to book.` },
    { title: "Alex confirms your place", body: `Then you come along to ${site.location.venue}.` },
  ];

  return (
    <Section tone="surface" id="how-to-book" labelledBy="how-to-book-heading">
      <div className="grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-7">
          <p className="eyebrow text-muted">Booking</p>
          <h2 id="how-to-book-heading" className="mt-4 font-display text-h2 text-balance">
            Where and how to book
          </h2>
          <ol className="mt-10 space-y-7">
            {steps.map((step, i) => (
              <li key={step.title} data-reveal style={revealDelay(i)} className="grid grid-cols-[3rem_1fr] gap-x-4 border-t border-ink pt-5">
                <span className="font-display text-h3 leading-none" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-lg font-bold">{step.title}</h3>
                  <p className="mt-1 text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <StartTraining href={cta.href} label={cta.label} external={cta.external} tone="light" className="mt-10 w-full sm:w-[22rem]" />
          {cta.kind === "booking" ? <InstagramAlternative className="mt-4" /> : null}
        </div>

        <div className="space-y-10 lg:col-span-5">
          <div>
            <h3 className="eyebrow text-muted">Where</h3>
            <address className="mt-4 border-t-2 border-ink pt-5 text-lg not-italic leading-relaxed">
              {formatAddressLines().map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <p className="mt-2 text-sm text-muted">Group classes and coaching sessions, just outside Glasgow.</p>
            <ButtonLink href={mapsUrl()} external variant="secondary" className="mt-6">
              Get directions
            </ButtonLink>
          </div>
          <div>
            <h3 className="eyebrow text-muted">When</h3>
            <p className="mt-4 border-t-2 border-ink pt-5 text-lg">
              {times ?? "Alex will let you know the current class times."}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

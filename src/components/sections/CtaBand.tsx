import { timetable } from "@/content/classes";
import { site } from "@/content/site";
import { getPrimaryCtaFor } from "@/lib/booking";
import { isPublishable } from "@/lib/publish";
import { groupedSessions } from "@/lib/schedule";
import { StartTraining } from "@/components/ui/StartTraining";
import { statement } from "@/lib/title";
import { Section, type SectionTone } from "@/components/ui/Section";
import { hero } from "@/content/home";
import type { BookableService } from "@/lib/booking-options";

interface CtaBandProps {
  title?: string;
  /** The line under the title; the class times unless given. `null` shows no line (home: the times are already at the top). */
  body?: string | null;
  headingId?: string;
  /** Section id, for in-page links and the home page's order test. */
  id?: string;
  /** Where Book now goes: the /book chooser at step 1 (default, owner 2026-10-27), or a service's own step. */
  service?: BookableService | "any";
  tone?: SectionTone;
  /** The button's words where a page wants its own (Coaching: "Get in touch", the owner, 2026-10-29). */
  label?: string;
  /** The quieter Instagram link; off on home, where Meet your coach already links it. */
  instagram?: boolean;
}

/**
 * Closing call to action: one line (the class times unless the page gives its
 * own), one booking button and Instagram as a quieter link (a new message to RAENG, owner 2026-11-04). No arrow (owner rule). Nothing here books anything: the button opens
 * the booking request flow.
 */
export function CtaBand({ title = "Ready to start?", body, headingId = "cta-heading", id, service = "any", tone = "white", instagram: showInstagram = true, label }: CtaBandProps) {
  const cta = getPrimaryCtaFor(service);
  const times = isPublishable(timetable.status) ? groupedSessions(timetable.sessions) : [];

  return (
    <Section tone={tone} id={id} labelledBy={headingId}>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-end lg:gap-16">
        <div data-reveal className="lg:col-span-7">
          <h2 id={headingId} className="font-display text-h1 text-balance">
            {statement(title)}
          </h2>
          {body === null ? null : (
            <p className="mt-5 max-w-xl text-lede">
              {body ?? (times.length > 0 ? `Classes run ${times.map((t) => `${t.days} ${t.time}`).join(", ")}.` : "Book now to join a class.")}
            </p>
          )}
        </div>
        <div data-reveal className="lg:col-span-5">
          <StartTraining href={cta.href} label={label ?? (cta.kind === "booking" ? hero.primaryLabel : cta.label)} external={cta.external} className="w-full" />
          {showInstagram ? (
            <a
              href={site.social.raeng.messageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-4 inline-flex min-h-11 items-center gap-2 font-semibold"
            >
              <span className="underline underline-offset-4 group-hover:no-underline">Message on Instagram</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

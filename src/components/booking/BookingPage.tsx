import { formatAddressLines, mapsUrl, site } from "@/content/site";
import { statement } from "@/lib/title";
import { bookingMode, parseBookingUrl } from "@/lib/booking";
import type { BookableService, OneToOneOption } from "@/lib/booking-options";
import { groupClass, onlineClassBooking } from "@/content/classes";
import { onlineJoinEnabled } from "@/lib/membership-checkout";
import { getService } from "@/content/services";
import { publishedClasses } from "@/lib/class-sessions";
import { publishable } from "@/lib/publish";
import { formatGbp } from "@/lib/schedule";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { BookingWizard, type ClassInfo } from "./BookingWizard";
import { ChosenPlan } from "./ChosenPlan";
import { DemoNotice, InstagramFallback } from "./ui";

interface BookingPageProps {
  title: string;
  initialService?: BookableService;
}

/** Shared by /book, /book/group-class, /book/one-to-one and /book/small-group. */
export function BookingPage({ title, initialService }: BookingPageProps) {
  const mode = bookingMode();
  const external = mode === "external" ? parseBookingUrl(process.env.BOOKING_URL) : null;

  const price = publishable(getService("group-classes").prices)[0];
  const classInfo: ClassInfo = groupClass;
  // Group classes are booked and paid online where Stripe is set up (owner, 2026-10-27); 1:1 stays a request.
  // BOOKING_DEMO_PAY (previews only, with BOOKING_DEMO) shows the paying screens in the labelled demo, so they can be looked at before Stripe is on: nothing is charged, booked or sent.
  const showPay = (mode === "request" && onlineJoinEnabled()) || (mode === "demo" && process.env.BOOKING_DEMO_PAY === "true");
  const pay = showPay && price ? { price: formatGbp(price.amountGbp), ...onlineClassBooking } : null;

  // The two 1:1 options with their published prices (services.ts), shown on the "when" step.
  const oneToOnePrices = publishable(getService("one-to-one").prices);
  const priceText = (i: number) => {
    const p = oneToOnePrices[i];
    return p ? `${formatGbp(p.amountGbp)} ${p.unit}` : undefined;
  };
  const optionPrices: Partial<Record<OneToOneOption, string>> = {
    ...(priceText(0) ? { single: priceText(0) } : {}),
    ...(priceText(1) ? { monthly: priceText(1) } : {}),
  };

  const intro =
    mode === "demo"
      ? initialService
        ? "Choose a date and time."
        : "Choose a service, then a date and time."
      : mode === "request" && pay && initialService === "group-class"
        ? "Choose a class, then pay online to book your place."
        : mode === "request" && pay && !initialService
          ? "Choose a service, then when suits you. Group classes are booked and paid online; Alex confirms one-to-one sessions personally."
          : mode === "request" && initialService === "small-group"
            ? "Choose the days and times that suit you, and Alex will reply about availability."
            : mode === "request"
            ? `${initialService ? "Choose when suits you." : "Choose a service, then when suits you."} Alex confirms every place personally.`
            : "Group classes, 1:1 personal coaching and small group coaching in Cumbernauld.";

  return (
    <section aria-labelledby="book-heading" className="bg-paper">
      <div className="container-page pt-6 pb-16 sm:pt-10 lg:pb-24">
        <header className="max-w-2xl">
          <p className="eyebrow text-muted">Book · {site.location.town}</p>
          <h1 id="book-heading" className="mt-3 font-display text-h2 text-balance">
            {statement(title)}
          </h1>
          <p className="mt-5 text-lede text-muted">{intro}</p>
        </header>
        {!initialService || initialService === "group-class" ? <ChosenPlan /> : null}

        {mode === "demo" ? (
          <div className="mt-5 max-w-2xl">
            <DemoNotice>
              <strong>Prototype booking page.</strong> Availability is sample data, not Alex&apos;s real timetable,
              and nothing you choose is booked or sent.
            </DemoNotice>
          </div>
        ) : null}

        <div className="mt-8 lg:mt-10">
          {external ? (
            <div className="card max-w-2xl p-8 sm:p-10">
              <p className="text-lede">Bookings are taken on Alex&apos;s booking page.</p>
              <ButtonLink href={external.toString()} external className="mt-6">
                Continue to booking
              </ButtonLink>
            </div>
          ) : mode === "demo" || mode === "request" ? (
            <>
              <noscript>
                <p className="mb-6 border-2 border-ink p-5">
                  Booking needs JavaScript. You can also message Alex on Instagram ({site.social.instagram.handle}).
                </p>
              </noscript>
              <BookingWizard mode={mode} initialService={initialService} classes={publishedClasses()} classInfo={classInfo} pay={pay} optionPrices={optionPrices} />
            </>
          ) : (
            <div className="max-w-2xl">
              <InstagramFallback>
                Online booking isn&apos;t open yet. To book a class, or ask about 1:1 or small group coaching, send Alex a message on
                Instagram.
              </InstagramFallback>
            </div>
          )}
        </div>

        <p className="mt-10 max-w-2xl text-sm text-muted">
          Sessions take place at {formatAddressLines().join(", ")}.{" "}
          <a href={mapsUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">
            Get directions<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </div>
    </section>
  );
}

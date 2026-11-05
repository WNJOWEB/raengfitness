import Link from "next/link";
import { getService } from "@/content/services";
import { smallGroupCoaching } from "@/content/smallGroup";
import { publishable } from "@/lib/publish";
import { formatGbp } from "@/lib/schedule";
import { Section, SectionHeading } from "@/components/ui/Section";

function leadPrice(id: "one-to-one") {
  const price = publishable(getService(id).prices)[0];
  return price ? `${price.prefix ? `${price.prefix} ` : ""}${formatGbp(price.amountGbp)} ${price.unit}` : null;
}

/**
 * Services, straight under the hero (Alex's layout, 2026-10-29; he offers group
 * kettlebell classes, 1:1 coaching and small group coaching): one white card
 * each, name and price on the first line, what it is and "Explore"
 * on the second. The whole row is the way into its page. Only confirmed prices
 * are shown (small group coaching has none yet).
 */
export function MoreWays() {
  const classPrice = publishable(getService("group-classes").prices)[0];
  const ways = [
    { href: "/classes", title: "Group classes", body: "Coached kettlebell sessions, all levels.", price: classPrice ? `${formatGbp(classPrice.amountGbp)} a class` : null },
    { href: "/coaching/one-to-one", title: "1:1 personal coaching", body: "Face-to-face coaching with Alex.", price: leadPrice("one-to-one") },
    { href: "/coaching/small-group", title: smallGroupCoaching.name, body: smallGroupCoaching.summary, price: null },
  ];
  return (
    <Section id="ways" labelledBy="ways-heading">
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-14">
        <SectionHeading id="ways-heading" className="lg:col-span-5" eyebrow="Services" title="Find your training." />
        <ul className="mt-8 flex flex-col gap-3 lg:col-span-7 lg:mt-0">
          {ways.map((w) => (
            <li key={w.href}>
              <Link href={w.href} className="group block rounded-[1.25rem] bg-white px-5 py-5 hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                <span className="flex items-baseline justify-between gap-4">
                  <span className="card-title">{w.title}</span>
                  {w.price ? <span className="shrink-0 text-[0.9375rem] font-semibold lg:text-base">{w.price}</span> : null}
                </span>
                <span className="mt-1 flex items-baseline justify-between gap-4 text-[0.9375rem] lg:text-base">
                  <span>{w.body}</span>
                  {/* A plain cue that the row is a link (no arrows on the site). */}
                  <span aria-hidden="true" className="shrink-0 font-semibold underline underline-offset-4 group-hover:no-underline">
                    Explore
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

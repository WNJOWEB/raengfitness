import type { Metadata } from "next";
import { getService } from "@/content/services";
import { formatLongDate, type DateKey } from "@/lib/availability/dates";
import { CLASS_WINDOW_DAYS } from "@/lib/availability/timetable";
import { getPrimaryCtaFor } from "@/lib/booking";
import { publishedClasses } from "@/lib/class-sessions";
import { pageMetadata } from "@/lib/metadata";
import { usesCredits, bookingWeeks, SLOT_LABEL, type WeekSlot } from "@/lib/member-view";
import { AccountUnavailable } from "@/components/members/Cards";
import { MembersShell } from "@/components/members/MembersShell";
import type { SheetPayload } from "@/components/members/sheet";
import { SheetTrigger } from "@/components/members/SheetTrigger";
import { WeekTabs } from "@/components/members/WeekTabs";
import { loadMembers } from "../data";
import { bookSheet, cancelSheet, creditSheet, sheetHref, sheetKey } from "../sheets";

export const metadata: Metadata = pageMetadata({
  title: "Book a class",
  description: "Book RAENG classes with your credits.",
  path: "/account/book",
  noindex: true,
});

/**
 * Members Book (owner's members design, 2026-10-28): week tabs, three class
 * cards a week. Tap a class to book it (a confirm sheet), tap a booked one to
 * cancel it (the real 24-hour rule). Classes after the credit period say
 * "Next period"; full, cancelled and past ones can't be tapped. Without a
 * membership, a class credit books in the same way, otherwise the card goes to
 * the booking page to pay.
 */
export default async function AccountBookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const o = d.overview.data;
  // A cancelled membership with nothing left to use reads as pay as you go (owner, 2026-11-03).
  const m = usesCredits(o) ? o.membership : null;
  const left = o.period?.left ?? 0;
  const credit = o.class_credits[0] ?? null;
  // A class that has already gone and wasn't theirs is only noise: left out (their own attended and missed ones stay).
  const weeks = bookingWeeks(o, { today: d.today, now: d.now, classes: publishedClasses(), windowDays: CLASS_WINDOW_DAYS, full: d.full, paymentDue: Boolean(d.due) })
    .map((w) => ({ ...w, slots: w.slots.filter((s) => s.state !== "past") }))
    .filter((w) => w.slots.length > 0);
  const payg = getService("group-classes").prices[0];
  const booking = getPrimaryCtaFor("group-class");

  /** The sheet a card opens, if any. */
  const sheetFor = (s: WeekSlot): { key: string; payload: SheetPayload } | null => {
    if (s.state === "book") return { key: sheetKey.book(s), payload: bookSheet(s, left, "book") };
    if (s.state === "use-credit" && credit) return { key: sheetKey.book(s), payload: creditSheet(s, credit.id, "book") };
    if (s.state === "booked" && s.place) return { key: sheetKey.cancel(s.place), payload: cancelSheet(s.place, "book") };
    return null;
  };
  const initial = d.confirm ? (weeks.flatMap((w) => w.slots).map(sheetFor).find((x) => x?.key === d.confirm)?.payload ?? null) : null;

  const [title, sub] = m
    ? [
        `${left} credit${left === 1 ? "" : "s"} to use.`,
        o.period ? `Before ${formatLongDate(o.period.end as DateKey)}. One credit per class.` : "Your next period hasn't started yet.",
      ]
    : credit
      ? [`${o.class_credits.length} class credit${o.class_credits.length === 1 ? "" : "s"} to use.`, `Before ${formatLongDate(credit.expires_on as DateKey)}. Nothing to pay.`]
      : ["Book a class.", payg ? `£${payg.amountGbp} a class, paid when you book.` : "Pick a class, then pay when you book."];

  return (
    <MembersShell view="book" overview={o} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={initial}>
      <div className="flex flex-col gap-2">
        <p className="members-eyebrow">Book a class</p>
        <h1 className="text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">{title}</h1>
        <p className="text-ink">{sub}</p>
      </div>

      {weeks.length === 0 ? (
        <p className="border-y border-line py-4 text-ink">No classes are published just now. Message Alex to book.</p>
      ) : (
        <WeekTabs
          labels={weeks.map((w) => w.label)}
          // After booking or cancelling, stay on the week of that class.
          initial={Math.max(0, weeks.findIndex((w) => w.slots.some((s) => `${s.date}.${s.slot}` === d.justBooked)))}
          panels={weeks.map((w) => (
            <ul key={w.label} className="grid grid-cols-3 gap-2.5">
              {w.slots.map((s) => (
                <li key={`${s.slot}|${s.date}`} className="min-w-0">
                  <SlotCard slot={s} sheet={sheetFor(s)} payHref={booking.kind === "booking" ? `${booking.href}?class=${s.slot}&date=${s.date}` : booking.href} />
                </li>
              ))}
            </ul>
          ))}
        />
      )}
      <p className="text-sm text-ink">Tap a class to book it. Tap a booked class to cancel.</p>
    </MembersShell>
  );
}

const CARD =
  "members-slot flex min-h-[9.5rem] w-full flex-col items-center gap-0.5 rounded-[20px] border-[1.5px] px-1.5 pt-4.5 pb-3.5 text-center transition-[transform,background-color,color] duration-200";

function CardBody({ s }: { s: WeekSlot }) {
  return (
    <>
      <span aria-hidden="true" className="text-xs font-semibold tracking-[0.2em]">
        {s.day}
      </span>
      <span aria-hidden="true" className="text-[clamp(1.625rem,7.6vw,2.125rem)] leading-[1.1] font-extrabold tracking-[-0.03em] tabular-nums">
        {s.dayNumber}
      </span>
      <span aria-hidden="true" className="text-sm">
        {s.time}
      </span>
      <span aria-hidden="true" className="mt-2 rounded-full border border-current px-2 py-0.5 text-[0.6875rem] font-semibold tracking-[0.1em] whitespace-nowrap uppercase">
        {SLOT_LABEL[s.state]}
      </span>
      <span className="sr-only">
        {s.label}: {SLOT_LABEL[s.state]}
      </span>
    </>
  );
}

function SlotCard({ slot: s, sheet, payHref }: { slot: WeekSlot; sheet: { key: string; payload: SheetPayload } | null; payHref: string }) {
  if (sheet) {
    const booked = s.state === "booked";
    return (
      <SheetTrigger
        payload={sheet.payload}
        href={sheetHref("book", sheet.key)}
        className={`${CARD} ${booked ? "border-ink bg-ink text-paper" : "border-ink hover:bg-ink hover:text-paper"}`}
      >
        <CardBody s={s} />
      </SheetTrigger>
    );
  }
  if (s.state === "pay") {
    return (
      <a href={payHref} className={`${CARD} border-ink hover:bg-ink hover:text-paper`}>
        <CardBody s={s} />
      </a>
    );
  }
  // Past, full, cancelled, next period, no credits, unpaid: shown, not tappable.
  const faded = s.state === "past" || s.state === "attended" || s.state === "missed";
  return (
    <div aria-disabled="true" className={`${CARD} border-line ${faded ? "border-dashed opacity-55" : "opacity-75"}`}>
      <CardBody s={s} />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { site } from "@/content/site";
import { isClassDate } from "@/lib/availability/timetable";
import { publishedClasses } from "@/lib/class-sessions";
import { CLASS_BOOK_PATH } from "@/lib/class-checkout";
import { londonToday } from "@/lib/coach/time";
import { isToken } from "@/lib/member-auth";
import { pageMetadata } from "@/lib/metadata";
import { whenFor } from "@/lib/waitlist";
import { WaitlistForm } from "@/components/booking/WaitlistForm";
import { buttonClasses } from "@/components/ui/ButtonLink";
import { Section } from "@/components/ui/Section";
import { leaveWaitlistAction } from "./actions";

export const metadata: Metadata = pageMetadata({
  title: "Join the waitlist",
  description: "Join the waitlist for a full RAENG Fitness class.",
  path: "/book/waitlist",
  noindex: true,
});

const heading = "mt-3 font-display text-h1 text-balance";

/**
 * The waitlist for a full class (owner, 2026-11-04). Three ways in:
 * ?class=<slot>&date=<day> from a full time on the booking page (join);
 * ?leave=<token> from the confirmation email (leave, on a button so an email
 * scanner opening the link changes nothing); ?left= after leaving.
 */
export default async function WaitlistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const leave = one("leave");
  const left = one("left");

  if (left) {
    return (
      <Section labelledBy="waitlist-heading">
        <div className="max-w-xl" role="status">
          <p className="eyebrow">Waitlist</p>
          <h1 id="waitlist-heading" className={heading}>
            {left === "1" ? "You've left the waitlist." : "That link has expired."}
          </h1>
          <p className="mt-5 text-lede">{left === "1" ? "We won't email you about that class. You can still book any class with a place free." : "If you still want to leave a waitlist, reply to the email we sent and we'll sort it."}</p>
          <Link href={CLASS_BOOK_PATH} className={buttonClasses("action", "mt-8 w-full px-6 sm:w-auto")}>
            Book a class
          </Link>
        </div>
      </Section>
    );
  }

  if (leave) {
    return (
      <Section labelledBy="waitlist-heading">
        <div className="max-w-xl">
          <p className="eyebrow">Waitlist</p>
          <h1 id="waitlist-heading" className={heading}>
            Leave the waitlist?
          </h1>
          <p className="mt-5 text-lede">You won&apos;t be emailed if a place opens in that class.</p>
          {isToken(leave) ? (
            <form action={leaveWaitlistAction} className="mt-8">
              <input type="hidden" name="token" value={leave} />
              <button type="submit" className={buttonClasses("action", "w-full px-6 sm:w-auto")}>
                Leave the waitlist
              </button>
            </form>
          ) : (
            <p className="mt-6 font-semibold">That link isn&apos;t right. Use the link in your email.</p>
          )}
        </div>
      </Section>
    );
  }

  const slot = publishedClasses().find((c) => c.id === one("class"));
  const date = one("date");
  if (!slot || !isClassDate(date, slot, londonToday())) {
    return (
      <Section labelledBy="waitlist-heading">
        <div className="max-w-xl">
          <p className="eyebrow">Waitlist</p>
          <h1 id="waitlist-heading" className={heading}>
            Choose a class first.
          </h1>
          <p className="mt-5 text-lede">The waitlist is for classes that are full. Pick a class on the booking page, and a full one will say so.</p>
          <Link href={CLASS_BOOK_PATH} className={buttonClasses("action", "mt-8 w-full px-6 sm:w-auto")}>
            See the classes
          </Link>
        </div>
      </Section>
    );
  }

  const when = whenFor(slot.id, date);
  return (
    <Section labelledBy="waitlist-heading">
      <div className="max-w-xl">
        <p className="eyebrow">This class is full</p>
        <h1 id="waitlist-heading" className={heading}>
          Join the waitlist.
        </h1>
        <p className="mt-5 text-lede">
          {when}, at {site.location.street}, {site.location.town}. Join the waitlist and we&apos;ll email you if a place opens. It&apos;s free, and you can leave any time.
        </p>
        <p className="mt-3">Places aren&apos;t held: they go to whoever books first, so book soon when you hear from us.</p>
        <div className="mt-8">
          <WaitlistForm slot={slot.id} date={date} when={when} />
        </div>
      </div>
    </Section>
  );
}

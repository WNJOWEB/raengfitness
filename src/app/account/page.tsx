import type { Metadata } from "next";
import Link from "next/link";
import { groupClass } from "@/content/classes";
import { mapsUrl, site } from "@/content/site";
import { formatLongDate, type DateKey } from "@/lib/availability/dates";
import { formatClock, toLondon } from "@/lib/coach/time";
import { pageMetadata } from "@/lib/metadata";
import { MEMBERS_VIEW_PATH } from "@/lib/members-app";
import { countdown, firstName, greeting, longWhen, pastPlaces, upcomingPlaces } from "@/lib/member-view";
import type { MemberPlace } from "@/lib/member-auth";
import { AccountUnavailable, ClassCredits, PayAsYouGo, PaymentDue } from "@/components/members/Cards";
import { CoachingCard } from "@/components/members/CoachingCards";
import { CreditRing } from "@/components/members/CreditRing";
import { MembersShell } from "@/components/members/MembersShell";
import { SheetTrigger } from "@/components/members/SheetTrigger";
import { loadMembers } from "./data";
import { cancelSheet, paidWith, sheetHref, sheetKey } from "./sheets";

export const metadata: Metadata = pageMetadata({
  title: "Your account",
  description: "Your RAENG classes, credits and membership.",
  path: "/account",
  noindex: true,
});

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * Members Home (owner's members design, 2026-10-28): the greeting, the next
 * class as the one ink card (countdown, Add to calendar, Directions), credits
 * as a ring, then what's booked, each with Cancel (a confirm sheet with the
 * real 24-hour rule). Pay-as-you-go customers see their plan and class credits
 * where members see the ring.
 */
export default async function AccountHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const o = d.overview.data;
  const m = o.membership;
  const upcoming = upcomingPlaces(o, d.now);
  const past = pastPlaces(o, d.now);
  const next = upcoming[0] ?? null;
  const name = firstName(o.client.name);
  const sheet = d.confirm ? (upcoming.map((p) => [sheetKey.cancel(p), cancelSheet(p, "home")] as const).find(([k]) => k === d.confirm)?.[1] ?? null) : null;

  return (
    <MembersShell view="home" overview={o} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={sheet}>
      <div className="flex flex-col gap-2">
        <p className="members-eyebrow">{m ? "Members" : "Your account"}</p>
        <h1 className="text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance">
          {greeting(d.now)}
          {name ? `, ${name}` : ""}.
        </h1>
      </div>

      {d.due ? <PaymentDue due={d.due} /> : null}

      {next ? (
        <NextClass place={next} now={d.now} />
      ) : (
        <section aria-labelledby="next-heading" className="flex flex-col items-start gap-3 rounded-3xl border-[1.5px] border-dashed border-line p-6">
          <h2 id="next-heading" className="members-eyebrow">
            No class booked
          </h2>
          <p>
            {m && o.period
              ? `You have ${o.period.left} credit${o.period.left === 1 ? "" : "s"} to use before ${formatLongDate(o.period.end as DateKey)}.`
              : "Pick a class and it will show here."}
          </p>
          <Link href={MEMBERS_VIEW_PATH.book} className="members-btn members-btn-solid px-6">
            Book a class
          </Link>
        </section>
      )}

      {d.coaching?.active ? <CoachingCard coaching={d.coaching} /> : null}

      {m && o.period ? (
        <section aria-labelledby="credits-heading" className="grid grid-cols-[96px_1fr] items-center gap-5 py-1">
          <CreditRing left={o.period.left} of={o.period.credits} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="credits-heading" className="text-lg font-bold tracking-[-0.01em]">
              {o.period.left} credit{o.period.left === 1 ? "" : "s"} left
            </h2>
            <p className="text-sm text-ink">
              {m.plan_name}
              {m.status === "active" && m.renews_on ? ` · renews ${formatLongDate(m.renews_on as DateKey).split(" ").slice(1).join(" ")}` : m.status === "paused" ? " · paused" : " · cancelled"}
            </p>
            <p className="text-sm text-ink">Unused credits don&apos;t roll over.</p>
          </div>
        </section>
      ) : null}
      {!m ? <PayAsYouGo o={o} today={d.today} /> : null}
      <ClassCredits o={o} />

      <section id="booked" aria-labelledby="booked-heading" className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="booked-heading" className="members-eyebrow">
            Booked
          </h2>
          {upcoming.length > 0 ? (
            <Link href={MEMBERS_VIEW_PATH.book} className="members-link">
              Book more
            </Link>
          ) : null}
        </div>
        {upcoming.length === 0 ? (
          <p className="border-y border-line py-4 text-ink">Nothing booked yet.</p>
        ) : (
          <ul className="border-t border-line">
            {upcoming.map((p) => (
              <BookedRow key={p.id} place={p} highlight={d.justBooked === `${p.class_date}.${p.slot}`} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
          <h2 id="recent-heading" className="members-eyebrow">
            The last 4 weeks
          </h2>
          <ul className="border-t border-line">
            {past.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3">
                <span>{longWhen(p.starts_at)}</span>
                <span className="text-sm text-ink">{p.status === "no_show" ? "Missed" : "Done"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.coaching && !d.coaching.active ? <CoachingCard coaching={d.coaching} /> : null}
    </MembersShell>
  );
}

/** The next class: the one ink card on Home. */
function NextClass({ place, now }: { place: MemberPlace; now: Date }) {
  const { date, time } = toLondon(place.starts_at);
  return (
    <section aria-labelledby="next-heading" className="flex flex-col gap-3.5 rounded-3xl bg-ink px-5.5 pt-5.5 pb-4.5 text-paper">
      <h2 id="next-heading" className="text-xs font-semibold tracking-[0.24em] uppercase opacity-75">
        Your next class
      </h2>
      <p className="text-[clamp(1.625rem,7.4vw,2.125rem)] leading-[1.08] font-extrabold tracking-[-0.03em]">
        {formatLongDate(date as DateKey)}
        <br />
        {formatClock(time)}
      </p>
      <p className="text-[0.9375rem] opacity-80">
        {groupClass.name} · {site.location.street}, {site.location.town}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-grey pt-3.5">
        <span className="font-semibold tabular-nums">{countdown(place.starts_at, now)}</span>
        <div className="flex flex-wrap gap-2">
          <a href={`/account/calendar?place=${place.id}`} className="members-chip">
            Add to calendar
          </a>
          <a href={mapsUrl()} {...external} className="members-chip">
            Directions<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function BookedRow({ place, highlight }: { place: MemberPlace; highlight: boolean }) {
  return (
    <li className={`flex min-w-0 items-center justify-between gap-3 border-b border-line py-4 ${highlight ? "-mx-3 rounded-2xl bg-white px-3 ring-2 ring-ink" : ""}`}>
      <div className="flex min-w-0 flex-col">
        {highlight ? <span className="members-eyebrow mb-1">Just booked</span> : null}
        <span className="font-semibold">{longWhen(place.starts_at)}</span>
        <span className="text-sm text-ink">{paidWith(place)}</span>
      </div>
      <SheetTrigger payload={cancelSheet(place, "home")} href={sheetHref("home", sheetKey.cancel(place))} className="members-link shrink-0">
        {place.can_cancel ? "Cancel" : "Change"}
        <span className="sr-only"> {longWhen(place.starts_at)}</span>
      </SheetTrigger>
    </li>
  );
}

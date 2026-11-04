import Link from "next/link";
import type { ReactNode } from "react";
import { bookClass, bookClassWithCredit, cancelClass, joinWaitlist, leaveWaitlist } from "@/app/account/actions";
import { mapsUrl, site } from "@/content/site";
import type { MemberOverview } from "@/lib/member-auth";
import type { CoachingStatus } from "@/lib/coaching";
import type { MemberSettings } from "@/lib/member-settings";
import { MEMBERS_VIEW_PATH, type MembersView } from "@/lib/members-app";
import { usesCredits, countdown, firstName, shortWhen, upcomingPlaces } from "@/lib/member-view";
import { ClearStatus } from "@/components/account/ClearStatus";
import { AccountMenu } from "./AccountMenu";
import { AccountMenuContent } from "./AccountMenuContent";
import { CoachingCard } from "./CoachingCards";
import { ConfirmSheet } from "./ConfirmSheet";
import { external, Icon, NEW_TAB } from "./icons";
import { MembersDrawer } from "./MembersDrawer";
import type { SheetPayload } from "./sheet";
import { TabPending } from "./TabPending";
import { Toast } from "./Toast";

const PUBLIC_LINKS: [string, string][] = [
  ["/classes", "Classes"],
  ["/coaching", "Coaching"],
  ["/about", "About"],
  ["/contact", "FAQs & Contact"],
];


/**
 * The members area's frame (owner's members design, 2026-10-28): a slim header
 * (members menu, RAENG MEMBERS, the avatar's account menu), the view, a bottom
 * tab bar (Home / Book / Plan), the confirm sheet and the toast. Every page
 * checks the session itself; this only lays out what it is given.
 */
export function MembersShell({
  view,
  overview,
  settings = null,
  coaching = null,
  now,
  done,
  error,
  sheet,
  children,
}: {
  /** The tab to mark current; null on the settings pages, which belong to the account menu. */
  view: MembersView | null;
  overview: MemberOverview;
  /** Reminders and calendar link, for the account menu's "On" and "Connected" (left out if null). */
  settings?: MemberSettings | null;
  /** Whether they have online coaching (the card in the menu, the avatar's ring, the account menu's Coaching). */
  coaching?: CoachingStatus | null;
  now: Date;
  done: string | null;
  error: string | null;
  /** The sheet rendered open (no-JavaScript fallback for ?confirm=…). */
  sheet: SheetPayload | null;
  children: ReactNode;
}) {
  const o = overview;
  // A cancelled membership with nothing left to use reads as pay as you go (owner, 2026-11-03).
  const m = usesCredits(o) ? o.membership : null;
  const name = firstName(o.client.name) || "Member";
  const initial = name.slice(0, 1).toUpperCase();
  const left = o.period?.left ?? 0;
  const next = upcomingPlaces(o, now)[0] ?? null;
  const status = m ? `${m.plan_name} · ${left} credit${left === 1 ? "" : "s"} left` : o.class_credits.length > 0 ? `Pay as you go · ${o.class_credits.length} class credit${o.class_credits.length === 1 ? "" : "s"}` : "Pay as you go";
  const path = MEMBERS_VIEW_PATH[view ?? "home"];

  return (
    <div data-members-app className="members-app min-h-dvh bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-paper">
        <div className="mx-auto grid h-[60px] max-w-[620px] grid-cols-[44px_1fr_44px] items-center px-5">
          <MembersDrawer>
            <div className="flex items-center gap-3.5 border-b border-line pb-4.5">
              <span aria-hidden="true" className="grid size-[46px] shrink-0 place-items-center rounded-full bg-ink text-lg font-bold text-paper">
                {initial}
              </span>
              <div className="min-w-0">
                <p className="text-[1.0625rem] font-bold">{o.client.name || name}</p>
                <p className="text-sm text-ink">{status}</p>
              </div>
            </div>
            <Link href={MEMBERS_VIEW_PATH.home} className="mt-4 flex flex-col gap-0.5 rounded-[20px] bg-ink px-4.5 py-4 text-paper">
              <span className="text-[0.6875rem] font-semibold tracking-[0.2em] uppercase opacity-75">Next class</span>
              <span className="text-lg font-bold tracking-[-0.01em]">{next ? shortWhen(next.starts_at) : "Nothing booked"}</span>
              <span className="text-[0.8125rem] opacity-80">
                {next ? `${countdown(next.starts_at, now)} · ${site.location.town}` : m ? `${left} credit${left === 1 ? "" : "s"} to use` : "Book a class to see it here"}
              </span>
            </Link>
            {coaching ? <CoachingCard coaching={coaching} small className="mt-3" /> : null}
            <Link href={MEMBERS_VIEW_PATH.book} className="members-btn mt-3">
              Book a class
            </Link>
            <ul className="mt-3.5 mb-6 grid grid-cols-2 gap-2.5">
              <li>
                <Link href={`${MEMBERS_VIEW_PATH.home}#booked`} className="members-tile">
                  <Icon name="list" />
                  My bookings
                </Link>
              </li>
              <li>
                <Link href={MEMBERS_VIEW_PATH.plan} className="members-tile">
                  <Icon name="plan" />
                  {m ? `${left} credit${left === 1 ? "" : "s"}` : "Your plan"}
                </Link>
              </li>
              <li>
                <a href={mapsUrl()} {...external} className="members-tile">
                  <Icon name="pin" />
                  <span>Directions{NEW_TAB}</span>
                </a>
              </li>
              <li>
                <a href={site.social.instagram.url} {...external} className="members-tile">
                  <Icon name="chat" />
                  <span>Message Alex{NEW_TAB}</span>
                </a>
              </li>
            </ul>
            <nav aria-label="RAENG website" className="mt-auto flex flex-wrap gap-x-3.5 gap-y-0.5 border-t border-line pt-4.5 text-sm">
              {PUBLIC_LINKS.map(([href, label]) => (
                <Link key={href} href={href} className="inline-flex min-h-11 items-center text-ink hover:text-ink hover:underline">
                  {label}
                </Link>
              ))}
            </nav>
          </MembersDrawer>

          <Link href={MEMBERS_VIEW_PATH.home} className="justify-self-center pl-[0.34em] text-center text-[1.0625rem] leading-tight font-extrabold tracking-[0.34em]">
            RAENG
            <span className="-mt-0.5 block text-[0.5625rem] font-semibold tracking-[0.4em] text-ink">MEMBERS</span>
            <span className="sr-only"> members home</span>
          </Link>

          <AccountMenu initial={initial} label="Account menu" coaching={coaching?.active === true}>
            <AccountMenuContent overview={o} settings={settings} coaching={coaching} />
          </AccountMenu>
        </div>
      </header>

      <div className="mx-auto max-w-[620px] px-5 pt-7 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        {error ? (
          <p role="alert" className="mb-6 rounded-2xl border-2 border-ink bg-white px-5 py-4 font-semibold">
            {error}
          </p>
        ) : null}
        <div className="members-view flex flex-col gap-7">{children}</div>
      </div>

      <nav aria-label="Members" className="members-tabs fixed inset-x-0 bottom-0 z-20 border-t border-line pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-[620px] grid-cols-3">
          {(["home", "book", "plan"] as const).map((v) => (
            <li key={v}>
              <Link href={MEMBERS_VIEW_PATH[v]} aria-current={v === view ? "page" : undefined} className="members-tab">
                <Icon name={v} />
                {v === "home" ? "Home" : v === "book" ? "Book" : "Plan"}
                <TabPending />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <ConfirmSheet actions={{ book: bookClass, credit: bookClassWithCredit, cancel: cancelClass, waitlist: joinWaitlist, "waitlist-leave": leaveWaitlist }} initial={sheet} closeHref={path} />
      <Toast message={done} />
      {done || error ? <ClearStatus /> : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/members/icons";
import { TabPending } from "@/components/members/TabPending";

const TABS = [
  { key: "today", label: "Today", href: "/coach", icon: "sun", owns: (p: string) => p === "/coach" },
  { key: "schedule", label: "Schedule", href: "/coach/schedule", icon: "calendar", owns: (p: string) => ["/coach/schedule", "/coach/classes", "/coach/sessions"].some((x) => p.startsWith(x)) },
  { key: "members", label: "Members", href: "/coach/members", icon: "people", owns: (p: string) => ["/coach/members", "/coach/clients", "/coach/memberships", "/coach/online"].some((x) => p.startsWith(x)) },
  { key: "inbox", label: "Inbox", href: "/coach/inbox", icon: "inbox", owns: (p: string) => ["/coach/inbox", "/coach/requests"].some((x) => p.startsWith(x)) },
] as const;

/**
 * The coach portal's tab bar (owner's coach design, 2026-10-28): Today,
 * Schedule, Members and Inbox (with a count of what's waiting). Each tab also
 * owns the detail pages that belong to it, so the right one is marked while
 * a class, client or request is open.
 */
export function CoachTabs({ inbox }: { inbox: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Coach" className="members-tabs fixed inset-x-0 bottom-0 z-20 border-t border-line pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-[720px] grid-cols-4">
        {TABS.map((t) => (
          <li key={t.key} className="relative">
            <Link href={t.href} aria-current={t.owns(pathname) ? "page" : undefined} className="members-tab">
              <Icon name={t.icon} />
              {t.label}
              <TabPending />
              {t.key === "inbox" && inbox > 0 ? <span className="sr-only">, {inbox} waiting</span> : null}
            </Link>
            {/* Outside the link: inactive tabs are dimmed, and the count must stay at full contrast. */}
            {t.key === "inbox" && inbox > 0 ? (
              <b className="pointer-events-none absolute top-1.5 left-[calc(50%+6px)] grid min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[0.6875rem] leading-[18px] font-semibold text-paper tabular-nums" aria-hidden="true">
                {inbox > 99 ? "99+" : inbox}
              </b>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}

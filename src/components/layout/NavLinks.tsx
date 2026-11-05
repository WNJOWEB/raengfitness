"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { coachLoginNav, mainNav, memberSignInNav, pageNav } from "@/content/site";
import { cn } from "@/lib/cn";

type MenuItem = { label: string; href: string };
const menuItems: readonly MenuItem[] = [...mainNav, ...pageNav];

/** "page" for the page you're on (a section's sub-pages count too); Home only matches exactly. */
function currentFor(pathname: string, href: string): "page" | undefined {
  if (href === "/") return pathname === "/" ? "page" : undefined;
  return pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined;
}

/**
 * The one navigation, at every width: a Menu button at the top left that opens
 * a dropdown (full width on phones, a panel under the button from lg).
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close the menu whenever the route changes (e.g. back/forward). Links in the
  // panel also close it on click, which covers a link to the page you're on.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Return focus to the toggle so keyboard users aren't stranded.
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close" : "Menu"}
        onClick={() => setOpen((v) => !v)}
        className="-ml-2.5 inline-flex size-11 items-center justify-center"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5">
          {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M2 6h16M2 14h16" />}
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="menu-panel absolute inset-x-0 top-full h-[calc(100dvh-6.75rem)] overflow-y-auto overscroll-contain bg-paper pb-8 sm:h-[calc(100dvh-9rem)] lg:inset-x-auto lg:left-[max(2.5rem,calc((100vw-78rem)/2+2.5rem))] lg:h-auto lg:max-h-[calc(100dvh-10rem)] lg:w-[24rem] lg:rounded-3xl lg:bg-white lg:pt-2 lg:pb-6"
      >
        <nav aria-label="Main" className="px-4 sm:px-6">
          <ul>
            {menuItems.map((item, i) => {
              const active = Boolean(currentFor(pathname, item.href));
              return (
                <li key={item.href} className="menu-rise" style={{ "--i": i } as CSSProperties}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn("relative flex min-h-14 items-center justify-between font-display text-2xl", active ? "underline decoration-2 underline-offset-8" : "hover:underline hover:underline-offset-8")}
                  >
                    {/* A bar in the gutter marks where you are. */}
                    {active ? <span aria-hidden="true" className="absolute inset-y-3 -left-4 w-1 bg-ink sm:-left-6 lg:-left-6" /> : null}
                    {item.label}
                    {active ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ink" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* No Book now here: the header's Book now is always on screen (owner, 2026-10-26). */}
          <Link
            href={memberSignInNav.href}
            style={{ "--i": mainNav.length + pageNav.length } as CSSProperties}
            onClick={() => setOpen(false)}
            aria-current={currentFor(pathname, "/account")}
            className="menu-rise mt-6 flex min-h-12 items-center justify-center rounded-full border border-ink bg-ink px-6 text-base font-semibold text-white hover:bg-white hover:text-ink"
          >
            {memberSignInNav.label}
          </Link>
          <Link
            href={coachLoginNav.href}
            style={{ "--i": mainNav.length + pageNav.length + 1 } as CSSProperties}
            onClick={() => setOpen(false)}
            aria-current={currentFor(pathname, coachLoginNav.href)}
            className="menu-rise mt-2 flex min-h-11 items-center justify-center text-sm font-semibold underline underline-offset-4 hover:no-underline"
          >
            {coachLoginNav.label}
          </Link>
        </nav>
      </div>
    </div>
  );
}

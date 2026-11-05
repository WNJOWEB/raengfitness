"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { coachLoginNav, mainNav, pageNav } from "@/content/site";
import { cn } from "@/lib/cn";

/** Homepage sections linked from the menu ("/#ways-to-train" → "ways-to-train"). */
const SECTION_IDS = mainNav.map((item) => item.href.slice(2));

/**
 * The homepage section being read: the last menu section whose top has passed
 * 35% of the way down the screen. Null above the first (the hero) and on
 * other pages.
 */
function useCurrentSection(pathname: string): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (pathname !== "/") return;
    let frame = 0;
    const update = () => {
      const line = window.innerHeight * 0.35;
      let found: string | null = null;
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const { top, bottom } = el.getBoundingClientRect();
        if (top <= line && bottom > line) found = id;
      }
      setCurrent(found);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("hashchange", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("hashchange", onScroll);
    };
  }, [pathname]);
  return pathname === "/" ? current : null;
}

/**
 * aria-current for a menu link: "location" for the homepage section being
 * read, "page" for the page you're on.
 */
function currentFor(pathname: string, section: string | null, href: string): "location" | "page" | undefined {
  if (href.startsWith("/#")) return section === href.slice(2) ? "location" : undefined;
  return pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined;
}

export function DesktopNav() {
  const pathname = usePathname();
  const section = useCurrentSection(pathname);
  return (
    <nav aria-label="Main" className="hidden xl:block">
      <ul className="flex items-center gap-5 2xl:gap-7">
        {mainNav.map((item) => {
          const current = currentFor(pathname, section, item.href);
          const active = Boolean(current);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current}
                className={cn(
                  "relative inline-flex min-h-11 items-center whitespace-nowrap text-sm font-semibold uppercase tracking-[0.1em] transition-colors",
                  "after:absolute after:inset-x-0 after:bottom-2 after:h-px after:origin-left after:bg-current after:transition-transform after:duration-200",
                  active
                    ? "text-paper after:scale-x-100"
                    : "text-muted-inverse after:scale-x-0 hover:text-paper hover:after:scale-x-100",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const section = useCurrentSection(pathname);
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close the menu whenever the route changes (e.g. back/forward). Links in the
  // panel also close it on click: a same-page anchor like /#ways-to-train
  // doesn't change the pathname, so the route check alone leaves it open.
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
    <div className="xl:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-2 px-1 text-sm font-semibold uppercase tracking-[0.1em] text-paper"
      >
        {open ? "Close" : "Menu"}
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5">
          {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M2 6h16M2 14h16" />}
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t border-line-inverse bg-ink pb-8 sm:h-[calc(100dvh-5rem)]"
      >
        <nav aria-label="Main" className="container-page">
          <ul className="divide-y divide-line-inverse">
            {[...mainNav, ...pageNav].map((item) => {
              const current = currentFor(pathname, section, item.href);
              const active = Boolean(current);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={current}
                    className={cn(
                      "relative flex min-h-14 items-center justify-between font-display text-2xl transition-colors",
                      active ? "text-paper" : "text-muted-inverse hover:text-paper",
                    )}
                  >
                    {/* A bar in the gutter marks where you are. */}
                    {active ? <span aria-hidden="true" className="absolute inset-y-3 -left-4 w-1 bg-paper sm:-left-6" /> : null}
                    {item.label}
                    {active ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-paper" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href={coachLoginNav.href}
            onClick={() => setOpen(false)}
            aria-current={currentFor(pathname, null, coachLoginNav.href)}
            className="mt-6 flex min-h-12 items-center justify-center border border-line-inverse px-6 text-sm font-semibold uppercase tracking-[0.08em] text-muted-inverse transition-colors hover:border-paper hover:text-paper"
          >
            {coachLoginNav.label}
          </Link>
        </nav>
      </div>
    </div>
  );
}

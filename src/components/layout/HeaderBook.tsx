"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Same beat as a tapped class card on the timetable (ClassWeek): the colour settles, then the page opens. */
const PRESS_MS = 450;

/**
 * The header's "Book now" (Alex, 2026-11-05): light, and on a tap it eases
 * to ink like the timetable's class cards, then the booking options open.
 * One smooth fill instead of an instant flash. Reduce Motion, new-tab clicks
 * and no JavaScript go straight to the page.
 */
export function HeaderBook({ href, label, external }: { href: string; label: string; external: boolean }) {
  const router = useRouter();
  const [pressed, setPressed] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const press = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (external || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (pressed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(href);
      return;
    }
    setPressed(true);
    router.prefetch(href);
    timers.current.push(
      window.setTimeout(() => router.push(href), PRESS_MS),
      // Back on this page (the back button), it's light again.
      window.setTimeout(() => setPressed(false), PRESS_MS + 1500),
    );
  };

  return (
    <Link
      href={href}
      onClick={press}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      data-pressed={pressed ? "" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border-[1.5px] border-ink px-4 text-xs font-semibold tracking-[0.08em] uppercase select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:px-6 sm:text-sm",
        "motion-safe:transition-colors motion-safe:duration-[600ms] motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]",
        pressed ? "bg-ink text-white" : "bg-white text-ink hover:bg-paper",
      )}
    >
      {label}
      {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </Link>
  );
}

import Link from "next/link";
import { getPrimaryCta } from "@/lib/booking";
import { LinkPending } from "@/components/members/LinkPending";
import { Logo } from "./Logo";
import { MobileNav } from "./NavLinks";

/**
 * The Menu dropdown at the left, the whole logo centred (tagline included,
 * in the artwork's own proportions: owner, 2026-10-26), the same at every
 * width, and "Book now" at the top right (Alex asked for it back, 2026-11-05;
 * it had been removed 2026-10-29). It opens the booking options (/book).
 */
export function SiteHeader() {
  const cta = getPrimaryCta();
  return (
    <header className="sticky top-0 z-40 bg-paper text-ink">
      <div className="container-page grid h-[84px] grid-cols-[1fr_auto_1fr] items-center gap-2 sm:h-28 sm:gap-6">
        <div className="justify-self-start">
          <MobileNav />
        </div>
        <Logo priority />
        <div className="justify-self-end">
          <Link
            href={cta.href}
            {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="header-book inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-4 text-xs font-semibold uppercase tracking-[0.08em] focus-visible:outline-ink sm:px-6 sm:text-sm"
          >
            {cta.label}
            <LinkPending />
            {cta.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </Link>
        </div>
      </div>
    </header>
  );
}

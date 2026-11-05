import { getPrimaryCta } from "@/lib/booking";
import { HeaderBook } from "./HeaderBook";
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
          <HeaderBook href={cta.href} label={cta.label} external={cta.external} />
        </div>
      </div>
    </header>
  );
}

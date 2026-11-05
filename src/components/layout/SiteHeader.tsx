import Link from "next/link";
import { getPrimaryCta } from "@/lib/booking";
import { StartTraining } from "@/components/ui/StartTraining";
import { Logo } from "./Logo";
import { DesktopNav, MobileNav } from "./NavLinks";

export function SiteHeader() {
  const cta = getPrimaryCta();

  return (
    <header className="sticky top-0 z-40 bg-ink text-paper">
      <div className="container-page relative flex h-16 items-center justify-between gap-3 sm:h-20 sm:gap-6">
        <Logo tone="dark" priority />
        <div className="flex items-center gap-3 sm:gap-6 lg:gap-8">
          <DesktopNav />
          {/* Top-right "Book now": the full button from md; a compact one on phones, so it never hides in the menu. */}
          <div className="hidden md:block">
            <StartTraining href={cta.href} label={cta.label} external={cta.external} tone="dark" variant="button" />
          </div>
          <Link
            href={cta.href}
            {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="inline-flex min-h-11 items-center justify-center whitespace-nowrap bg-paper px-4 text-xs font-semibold uppercase tracking-[0.08em] text-ink transition-colors duration-200 hover:bg-white focus-visible:outline-paper active:translate-y-px md:hidden"
          >
            {cta.label}
            {cta.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

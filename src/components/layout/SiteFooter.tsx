import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { RevealPhone } from "@/components/ui/RevealPhone";
import { scramblePhone } from "@/lib/phone";
import Link from "next/link";
import type { ReactNode } from "react";
import { footerNav, formatAddressLines, mapsUrl, site } from "@/content/site";
import { Logo } from "./Logo";

// 44px tap targets on touch layouts; compact rows on desktop.
const footerLink =
  "inline-flex min-h-11 items-center hover:underline underline-offset-4 lg:min-h-0 lg:py-1";

/**
 * A collapsible block on phones (native details, no script); from lg the
 * content is always shown and the heading is plain.
 */
function FooterGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <details className={`footer-group border-t border-grey lg:border-0 ${className ?? ""}`}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between lg:pointer-events-none lg:min-h-0 [&::-webkit-details-marker]:hidden">
        <h2 className="eyebrow">{title}</h2>
        <span aria-hidden="true" className="text-lg leading-none lg:hidden">+</span>
      </summary>
      <div className="pb-4 lg:pb-0">{children}</div>
    </details>
  );
}

export function SiteFooter() {
  const { email, phone } = site.contact;

  return (
    <footer className="bg-white text-ink">
      {/* Mobile: brand, then Explore (sized to its links) | Contact + Find us. */}
      <div className="container-page grid grid-cols-1 py-10 sm:py-12 lg:grid-cols-12 lg:gap-8">
        <div className="mb-8 lg:order-1 lg:col-span-5">
          <Logo variant="lockup" />
          <p className="mt-5 max-w-sm text-sm ">
            Kettlebell classes in Cumbernauld, Glasgow, with flexible memberships, plus 1:1
            coaching.
          </p>
        </div>

        <nav aria-label="Footer" className="lg:order-2 lg:col-span-2">
          <FooterGroup title="Explore">
          <ul className="text-sm lg:mt-4">
            {footerNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={footerLink}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          </FooterGroup>
        </nav>

        {/* lg:contents lets both blocks rejoin the 12-column grid on desktop. */}
        <div className="flex min-w-0 flex-col lg:contents">
          <FooterGroup title="Contact" className="lg:order-4 lg:col-span-2">
            <ul className="text-sm lg:mt-4">
              <li>
                <a
                  href={site.social.raeng.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={footerLink}
                >
                  <span className="inline-flex items-center gap-2">
                    <InstagramIcon className="size-4 shrink-0" />
                    Instagram
                  </span>
                  <span className="sr-only"> {site.social.raeng.handle} (opens in a new tab)</span>
                </a>
              </li>
              <li>
                <a
                  href={site.social.facebook.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={footerLink}
                >
                  Facebook
                  <span className="sr-only"> {site.social.facebook.name} (opens in a new tab)</span>
                </a>
              </li>
              {email ? (
                <li>
                  <a href={`mailto:${email}`} className={`${footerLink} break-all`}>
                    {email}
                  </a>
                </li>
              ) : null}
              {phone ? (
                <li className="text-sm">
                  <RevealPhone mode="footer" scrambled={scramblePhone(phone)} />
                </li>
              ) : null}
            </ul>
          </FooterGroup>

          <FooterGroup title="Find us" className="lg:order-3 lg:col-span-3">
            <address className="text-sm lg:mt-4 not-italic leading-relaxed">
              {formatAddressLines().map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <a
              href={mapsUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className={`${footerLink} mt-1 text-sm underline lg:mt-2`}
            >
              Open in Google Maps<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </FooterGroup>
        </div>
      </div>

      <div className="border-t border-grey">
        <div className="container-page flex flex-col gap-1 py-5 text-xs  sm:flex-row sm:items-center sm:justify-between">
          <p>
            {site.name} · {site.descriptor}
          </p>
          <p className="flex flex-wrap items-center gap-x-4">
            <span>
              {site.location.town}, {site.location.region}
            </span>
            <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline">
              Terms
            </Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline">
              Privacy notice
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

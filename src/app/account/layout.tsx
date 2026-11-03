import type { Metadata } from "next";
import type { ReactNode } from "react";

// Account pages read the member's session cookie, so they render per request
// on the server rather than prerender a shell (as the coach portal does).
export const instant = false;

// Never indexed (also Disallowed in robots.txt and absent from the sitemap).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The loading screens (loading.tsx) are sent first and the page replaces them
 * a moment later; the replacement needs JavaScript. Without JavaScript the
 * page is still sent, just held back, so this reveals it and hides the loading
 * screen. (Booking and signing in have to keep working without JavaScript.)
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <noscript>
        <style>{`[id^="S:"]{display:block!important}[data-skeleton]{display:none!important}`}</style>
      </noscript>
      {children}
    </>
  );
}

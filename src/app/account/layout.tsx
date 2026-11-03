import type { Metadata } from "next";
import type { ReactNode } from "react";

// Account pages read the member's session cookie, so they render per request
// on the server rather than prerender a shell (as the coach portal does).
export const instant = false;

// Never indexed (also Disallowed in robots.txt and absent from the sitemap).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}

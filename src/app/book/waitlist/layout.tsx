import type { Metadata } from "next";
import type { ReactNode } from "react";

// Reads the address (the class, or a private leave link) on every visit, so it
// renders per request on the server (as the booking confirmation does).
export const instant = false;

// Never indexed (also Disallowed in robots.txt and absent from the sitemap).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function WaitlistLayout({ children }: { children: ReactNode }) {
  return children;
}

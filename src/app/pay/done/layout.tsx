import type { Metadata } from "next";
import type { ReactNode } from "react";

// Reads the link's state from the database on every visit, so it renders
// per request on the server (as the account pages do).
export const instant = false;

// Never indexed (also Disallowed in robots.txt and absent from the sitemap).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PayDoneLayout({ children }: { children: ReactNode }) {
  return children;
}

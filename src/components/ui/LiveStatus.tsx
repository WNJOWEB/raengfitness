"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Asks the server again, in place, while a confirmation screen waits for
 * Stripe's word (owner, 2026-11-03: no flashing reloads). After `delayMs` it
 * swaps to `href` as a soft navigation: the server re-reads the database and
 * only the changed screen is redrawn, so the waiting screen turns into the
 * confirmation without a white flash. Without JavaScript, the same address
 * loads by a plain refresh instead.
 */
export function LiveStatus({ href, delayMs = 2500 }: { href: string; delayMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setTimeout(() => router.replace(href, { scroll: false }), delayMs);
    return () => window.clearTimeout(t);
  }, [router, href, delayMs]);
  return (
    <noscript>
      <meta httpEquiv="refresh" content={`${Math.ceil(delayMs / 1000)};url=${href}`} />
    </noscript>
  );
}

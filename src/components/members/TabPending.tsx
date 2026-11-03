"use client";

import { useLinkStatus } from "next/link";

/**
 * Inside a tab link: the moment the tab is tapped it looks pressed (the line
 * above it appears and the label turns bold) while the next page is fetched,
 * so a slower answer never looks like a missed tap (owner, 2026-11-02, after the
 * speed audit). The page itself is still sent whole, so everything keeps
 * working without JavaScript. Screen readers hear "(loading)".
 */
export function TabPending() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-hidden="true" className={pending ? "tab-pending" : undefined} />
      {pending ? <span className="sr-only"> (loading)</span> : null}
    </>
  );
}

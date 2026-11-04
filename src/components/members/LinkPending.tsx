"use client";

import { useLinkStatus } from "next/link";

/**
 * Inside a link in the account menu: the moment it is tapped the tile or
 * button stays pressed (dark, with the label inverted) until the next page has
 * arrived, so a slower answer never looks like a missed tap (owner,
 * 2026-11-04). There is no pause added: a quick page just opens. Screen readers
 * hear "(loading)". Everything works without JavaScript.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-hidden="true" className={pending ? "link-pending" : undefined} />
      {pending ? <span className="sr-only"> (loading)</span> : null}
    </>
  );
}

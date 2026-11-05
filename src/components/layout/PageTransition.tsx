"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isMembersApp } from "@/lib/members-app";

/**
 * The public site's page fade (owner, 2026-11-05; CSS in globals.css → Page
 * transitions). The members area and the coach portal are app screens with
 * their own frame and keep their instant tab changes: wrapping them dropped
 * the page title after a redirect there.
 *
 * The fade runs only when the page itself changes (a new pathname): the old
 * page exits and the new one enters. Keyed by pathname with `default="none"`,
 * so updates within one page never fade it, even when they come through the
 * router: the booking steps' #hash history (step 2 → 3, and Back) used to fade
 * the whole page out and in again just after the step had appeared.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isMembersApp(pathname)) return children;
  return (
    <ViewTransition key={pathname} enter="page" exit="page" default="none">
      {children}
    </ViewTransition>
  );
}

"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isMembersApp } from "@/lib/members-app";

/**
 * The public site's page fade (owner, 2026-11-05; CSS in globals.css → Page
 * transitions). The members area and the coach portal are app screens with
 * their own frame and keep their instant tab changes: wrapping them dropped
 * the page title after a redirect there.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return isMembersApp(usePathname()) ? children : <ViewTransition default="page">{children}</ViewTransition>;
}

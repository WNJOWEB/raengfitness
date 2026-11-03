/**
 * The signed-in members area (owner's members design, 2026-10-28): these
 * pages have their own app header, menu and tab bar instead of the public
 * site's header and footer. Sign-in and confirm keep the site's.
 */
export const MEMBERS_APP_PATHS = [
  "/account",
  "/account/book",
  "/account/plan",
  "/account/profile",
  "/account/security",
  "/account/calendar-sync",
  "/account/notifications",
  "/account/payments",
  "/account/coaching",
  "/account/coaching/programme",
  "/account/coaching/check-in",
  "/account/coaching/messages",
  "/account/coaching/unlock",
] as const;

export type MembersView = "home" | "book" | "plan";

export const MEMBERS_VIEW_PATH: Record<MembersView, string> = {
  home: "/account",
  book: "/account/book",
  plan: "/account/plan",
};

export function isMembersApp(pathname: string | null): boolean {
  if (pathname === null) return false;
  const path = pathname.replace(/\/$/, "") || "/";
  // The coach portal (owner's coach design, 2026-10-28) has the same kind of frame; its login page keeps the site's.
  if (path === "/coach" || (path.startsWith("/coach/") && path !== "/coach/login")) return true;
  // A receipt (/account/payments/<id>) is inside the members area too.
  if (path.startsWith("/account/payments/")) return true;
  return (MEMBERS_APP_PATHS as readonly string[]).includes(path);
}

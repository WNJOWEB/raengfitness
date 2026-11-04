import { NextResponse, type NextRequest } from "next/server";
import { coachLoginConfig, isCoach, refreshSessionShared } from "@/lib/coach-auth";
import { ACCESS_COOKIE, COACH_HOME, COACH_LOGIN, REFRESH_COOKIE, sessionCookies } from "@/lib/coach-cookies";
import { MEMBER_SESSION_COOKIE, memberCookieOptions } from "@/lib/member-auth";

/**
 * Keeps members signed in while they use their account (below), and the coach
 * signed in: when the short-lived access cookie has expired,
 * swaps the refresh token for a new session before the page renders (requests
 * that arrive together share one refresh: see refreshSessionShared). Pages
 * still verify the session themselves (lib/coach-session.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Members (owner, 2026-11-03): each visit to the account renews the cookie's 30 days, so a member who
  // keeps using it stays signed in. The database decides whether the session is still good
  // (akb_member_session_client, which moves its end the same way, up to a year).
  if (pathname === "/account" || pathname.startsWith("/account/")) {
    const session = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
    const response = NextResponse.next();
    // Page views only: a form post may be signing out, and must not get the cookie back.
    if (session && request.method === "GET") response.cookies.set(MEMBER_SESSION_COOKIE, session, memberCookieOptions());
    return response;
  }
  if (pathname === COACH_LOGIN || request.cookies.has(ACCESS_COOKIE)) return NextResponse.next();

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const config = coachLoginConfig();
  if (refreshToken && config) {
    const result = await refreshSessionShared(config.supabase, refreshToken);
    if (result.ok && isCoach(config, result.session.email)) {
      const cookies = sessionCookies(result.session);
      // Forward the new tokens to this render as well as to the browser.
      for (const [name, value] of cookies) request.cookies.set(name, value);
      const response = NextResponse.next({ request: { headers: request.headers } });
      for (const [name, value, options] of cookies) response.cookies.set(name, value, options);
      return response;
    }
  }

  const response = NextResponse.redirect(new URL(COACH_LOGIN, request.url));
  response.cookies.delete({ name: REFRESH_COOKIE, path: COACH_HOME });
  return response;
}

export const config = {
  matcher: ["/coach/:path*", "/account", "/account/:path*"],
};

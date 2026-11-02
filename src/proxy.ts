import { NextResponse, type NextRequest } from "next/server";
import { coachLoginConfig, isCoach, refreshSessionShared } from "@/lib/coach-auth";
import { ACCESS_COOKIE, COACH_HOME, COACH_LOGIN, REFRESH_COOKIE, sessionCookies } from "@/lib/coach-cookies";

/**
 * Keeps the coach signed in: when the short-lived access cookie has expired,
 * swaps the refresh token for a new session before the page renders (requests
 * that arrive together share one refresh: see refreshSessionShared). Pages
 * still verify the session themselves (lib/coach-session.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  matcher: ["/coach/:path*"],
};

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { coachLoginConfig, currentUserEmail, isCoach } from "./coach-auth";
import { ACCESS_COOKIE, COACH_LOGIN } from "./coach-cookies";

export interface Coach {
  email: string;
}

/**
 * Checks the session with Supabase once per request: the portal's frame and
 * the page both ask who is signed in, and each check is a call across the
 * network. `cache` shares the answer only within one request (never between
 * requests or people), so a revoked session still stops working at once.
 */
const verifiedCoach = cache(async (): Promise<Coach | null> => {
  const config = coachLoginConfig();
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!config || !token) return null;
  const email = await currentUserEmail(config.supabase, token);
  if (!email || !isCoach(config, email)) return null;
  return { email };
});

/**
 * The signed-in coach, verified with Supabase on every request; otherwise a
 * redirect to the login page. Call it in every coach page and Server Action:
 * the proxy only refreshes sessions, it doesn't authorise anything.
 */
export async function requireCoach(): Promise<Coach> {
  const coach = await verifiedCoach();
  if (!coach) redirect(COACH_LOGIN);
  return coach;
}

import { isValidEmail } from "./form-validation";
import { supabaseConfig, type Env, type SupabaseConfig } from "./env";

/**
 * Coach login against Supabase Auth's REST API (GoTrue). Plain fetch, like
 * send-email.ts: no SDK dependency. Every call runs on the server with the
 * secret key; nothing here reaches the browser.
 *
 * Only addresses in COACH_EMAIL may sign in, so an account created in
 * Supabase for anyone else (or a public sign-up) never gets in.
 */

export interface CoachLoginConfig {
  supabase: SupabaseConfig;
  coaches: readonly string[];
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  email: string;
}

export type SignInResult =
  | { ok: true; session: AuthSession }
  | { ok: false; reason: "invalid" | "rate-limited" | "unavailable" };

/** COACH_EMAIL: one address, or several separated by commas. */
export function coachEmails(env: Env = process.env): string[] {
  return (env.COACH_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(isValidEmail);
}

/** Null (login switched off) unless Supabase and at least one coach address are set. */
export function coachLoginConfig(env: Env = process.env): CoachLoginConfig | null {
  const supabase = supabaseConfig(env);
  const coaches = coachEmails(env);
  return supabase && coaches.length > 0 ? { supabase, coaches } : null;
}

export function isCoach(config: CoachLoginConfig, email: string): boolean {
  return config.coaches.includes(email.trim().toLowerCase());
}

function headers(config: SupabaseConfig, accessToken?: string): HeadersInit {
  return {
    apikey: config.secretKey,
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function parseSession(body: unknown): AuthSession | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const user = (typeof b.user === "object" && b.user !== null ? b.user : {}) as Record<string, unknown>;
  if (
    typeof b.access_token !== "string" ||
    typeof b.refresh_token !== "string" ||
    typeof b.expires_in !== "number" ||
    typeof user.email !== "string"
  ) {
    return null;
  }
  return { accessToken: b.access_token, refreshToken: b.refresh_token, expiresIn: b.expires_in, email: user.email };
}

async function tokenRequest(
  config: SupabaseConfig,
  grant: "password" | "refresh_token",
  payload: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<SignInResult> {
  try {
    const response = await fetchImpl(`${config.url}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429) return { ok: false, reason: "rate-limited" };
    // GoTrue answers 400 for wrong credentials and for spent refresh tokens.
    if (response.status === 400 || response.status === 401) return { ok: false, reason: "invalid" };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const session = parseSession(await response.json());
    return session ? { ok: true, session } : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function signInWithPassword(
  config: SupabaseConfig,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SignInResult> {
  return tokenRequest(config, "password", { email, password }, fetchImpl);
}

export function refreshSession(
  config: SupabaseConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SignInResult> {
  return tokenRequest(config, "refresh_token", { refresh_token: refreshToken }, fetchImpl);
}

/** How long a refresh result is shared with other requests carrying the same refresh token (Supabase's own reuse window is 10 s). */
export const REFRESH_SHARE_MS = 10_000;
const recentRefreshes = new Map<string, { at: number; result: Promise<SignInResult> }>();

/**
 * Refreshes once for requests that arrive together. A page load can send
 * several requests at the same moment (the page and its link prefetches), all
 * carrying the same refresh token. Refresh tokens are single-use, so the
 * second would be refused, and its redirect would delete the cookie the first
 * had just renewed: the coach is signed out at random. Requests with the same
 * token within REFRESH_SHARE_MS now share one refresh and all get the same new
 * session. Only a successful refresh is remembered; a failure is retried.
 */
export function refreshSessionShared(config: SupabaseConfig, refreshToken: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<SignInResult> {
  for (const [token, entry] of recentRefreshes) if (now - entry.at > REFRESH_SHARE_MS) recentRefreshes.delete(token);
  const shared = recentRefreshes.get(refreshToken);
  if (shared) return shared.result;
  const result = refreshSession(config, refreshToken, fetchImpl);
  recentRefreshes.set(refreshToken, { at: now, result });
  void result.then((r) => {
    if (!r.ok) recentRefreshes.delete(refreshToken);
  }, () => recentRefreshes.delete(refreshToken));
  return result;
}

/** The signed-in user's email, checked with Supabase on every call (so a revoked session stops working). */
export async function currentUserEmail(
  config: SupabaseConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(`${config.url}/auth/v1/user`, {
      headers: headers(config, accessToken),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const user = (await response.json()) as Record<string, unknown> | null;
    return typeof user?.email === "string" ? user.email : null;
  } catch {
    return null;
  }
}

/** Ends this session in Supabase. Best effort: the caller clears the cookies anyway. */
export async function signOut(config: SupabaseConfig, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(`${config.url}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: headers(config, accessToken),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Ignored: the refresh token can't be used once its cookie is gone.
  }
}

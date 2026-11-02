/** Minimal env shape so helpers can be tested without the full ProcessEnv. */
export type Env = Readonly<Record<string, string | undefined>>;

function parseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Canonical site origin for metadata, sitemap and structured data.
 * Set SITE_URL on Vercel production once the domain is decided
 * (e.g. https://www.example.co.uk). Invalid values are ignored.
 * Falls back to the Vercel production URL, then localhost.
 */
export function siteUrl(env: Env = process.env): string {
  return (
    parseOrigin(env.SITE_URL) ??
    parseOrigin(
      env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
    ) ??
    "http://localhost:3000"
  );
}

export type SupabaseConfig = Readonly<{ url: string; secretKey: string }>;

/** The live Supabase project's ref. Test-only features (Stripe test mode) refuse to run against it. */
export const PRODUCTION_SUPABASE_REF = "sqkpixwvugrxllrxlexs";

/** True when SUPABASE_URL points at the live project (or can't be read, to fail safe). */
export function usesProductionDatabase(env: Env = process.env): boolean {
  const raw = env.SUPABASE_URL?.trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname.split(".")[0] === PRODUCTION_SUPABASE_REF;
  } catch {
    return true;
  }
}

/**
 * Supabase project "Alexkbells" (ref sqkpixwvugrxllrxlexs, eu-west-1).
 * Returns null unless SUPABASE_URL is a valid https origin and
 * SUPABASE_SECRET_KEY is set, so features that need the database stay off
 * until it is configured. The secret key bypasses RLS: use it only in server
 * code, and never expose it with NEXT_PUBLIC_.
 */
export function supabaseConfig(env: Env = process.env): SupabaseConfig | null {
  const url = parseOrigin(env.SUPABASE_URL);
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  // http only on localhost, for the e2e stand-in (tests/e2e/mock-supabase-auth.mjs).
  const secure = url?.startsWith("https://") || url?.startsWith("http://localhost:");
  if (!url || !secure || !secretKey) return null;
  return { url, secretKey };
}

/** True only on Vercel production deployments (VERCEL_ENV is set by Vercel). */
export function isProductionDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/** True only on Vercel preview deployments, not on production, local or CI builds (no VERCEL_ENV). */
export function isPreviewDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

/**
 * Search engines may index this build only when it is the real site:
 * Vercel production, or a local build (no VERCEL_ENV) without preview content.
 */
export function isIndexable(env: Env = process.env): boolean {
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "production") return false;
  return env.CONTENT_PREVIEW !== "true" || isProductionDeployment(env);
}

import { usesProductionDatabase, type Env } from "../env";

/**
 * Stripe settings, server only (never NEXT_PUBLIC_). Stripe stays off unless
 * every value is present and the environment matches the deployment:
 * - a live key (sk_live_ / rk_live_), real money, only on Vercel production;
 * - a test key (sk_test_ / rk_test_), test money, everywhere else, never on
 *   Vercel production and never against the live Supabase project.
 * So a preview or local build can't take a real payment, and production can't
 * be pointed at test keys by mistake; the database refuses it too
 * (akb_database_role, 20261021000000 and 20261102000100).
 * "sandbox" / "production" are the names the database stores for test / live.
 */

export type StripeEnvironment = "sandbox" | "production";

/** Pinned so Stripe's responses don't change under us. */
export const STRIPE_API_VERSION = "2024-06-20";

const BASE_URL = "https://api.stripe.com";

export interface StripeConfig {
  environment: StripeEnvironment;
  baseUrl: string;
  secretKey: string;
}

export interface StripeWebhookConfig {
  environment: StripeEnvironment;
  /** Signing secret of the webhook endpoint (whsec_...). */
  signingSecret: string;
}

function environment(env: Env): StripeEnvironment | null {
  const key = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const isProductionDeployment = env.VERCEL_ENV === "production";
  if (/^(sk|rk)_live_/.test(key)) return isProductionDeployment ? "production" : null;
  if (/^(sk|rk)_test_/.test(key)) return isProductionDeployment || usesProductionDatabase(env) ? null : "sandbox";
  return null;
}

/** For the API in tests only: a localhost stand-in, never on Vercel. */
function baseUrl(env: Env): string {
  const override = env.STRIPE_API_URL?.trim();
  if (override && !env.VERCEL_ENV && /^http:\/\/localhost:\d+$/.test(override)) return override;
  return BASE_URL;
}

export function stripeConfig(env: Env = process.env): StripeConfig | null {
  const name = environment(env);
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!name || !secretKey) return null;
  return { environment: name, baseUrl: baseUrl(env), secretKey };
}

export function stripeWebhookConfig(env: Env = process.env): StripeWebhookConfig | null {
  const name = environment(env);
  const signingSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!name || !signingSecret || !signingSecret.startsWith("whsec_")) return null;
  return { environment: name, signingSecret };
}

/**
 * Whether members are offered a Direct Debit (Bacs). Off until Stripe has
 * approved Bacs for the account (DIRECT_DEBIT_ENABLED=true on Vercel): until
 * then renewals are charged to the member's saved card.
 */
export function directDebitEnabled(env: Env = process.env): boolean {
  return env.DIRECT_DEBIT_ENABLED?.trim() === "true" && stripeConfig(env) !== null;
}

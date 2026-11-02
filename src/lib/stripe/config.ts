import { usesProductionDatabase, type Env } from "../env";

/**
 * Stripe settings, server only (never NEXT_PUBLIC_). Stripe stays off unless
 * every value is present and the key's mode matches the deployment:
 * - a live key (sk_live_ / rk_live_, real money) only on Vercel production;
 * - a test-mode key (sk_test_ / rk_test_, "sandbox") everywhere else, never on
 *   Vercel production.
 * So a preview or local build can't take a real payment, and production can't
 * run on test credentials by mistake. Test mode also refuses to run against
 * the live Supabase project, so test money can't reach the live ledger; the
 * database refuses it too (akb_database_role, 20261021000000).
 */

export type StripeEnvironment = "sandbox" | "production";

/** Pinned so a Stripe-side default change can't alter the fields this code reads. */
export const STRIPE_API_VERSION = "2024-10-28.acacia";

export interface StripeConfig {
  environment: StripeEnvironment;
  baseUrl: string;
  secretKey: string;
}

export interface StripeWebhookConfig {
  environment: StripeEnvironment;
  /** The endpoint's signing secret (whsec_…), per endpoint and per mode. */
  signingSecret: string;
}

function keyEnvironment(key: string | undefined): StripeEnvironment | null {
  if (!key) return null;
  if (/^(sk|rk)_live_[A-Za-z0-9]+$/.test(key)) return "production";
  if (/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) return "sandbox";
  return null;
}

function environment(env: Env): StripeEnvironment | null {
  const name = keyEnvironment(env.STRIPE_SECRET_KEY?.trim());
  const isProductionDeployment = env.VERCEL_ENV === "production";
  if (name === "production") return isProductionDeployment ? "production" : null;
  if (name === "sandbox") return isProductionDeployment || usesProductionDatabase(env) ? null : "sandbox";
  return null;
}

/** For the API in tests only: a localhost stand-in, never on Vercel. */
function baseUrl(env: Env): string {
  const override = env.STRIPE_API_URL?.trim();
  if (override && !env.VERCEL_ENV && /^http:\/\/localhost:\d+$/.test(override)) return override;
  return "https://api.stripe.com";
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
  if (!name || !signingSecret || !/^whsec_\S+$/.test(signingSecret)) return null;
  return { environment: name, signingSecret };
}

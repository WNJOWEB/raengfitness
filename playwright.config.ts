import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3200);
/** Second server: configured as Vercel production, to prove demo data can't appear there. */
export const productionPort = Number(process.env.E2E_PRODUCTION_PORT ?? 3201);
export const mockEmailPort = Number(process.env.MOCK_EMAIL_PORT ?? 3299);
export const mockSupabasePort = Number(process.env.MOCK_SUPABASE_PORT ?? 3298);
export const mockStripePort = Number(process.env.MOCK_STRIPE_PORT ?? 3297);
/** A build where members join and pay online (Stripe test-key settings, against the Stripe stand-in). */
export const payPort = Number(process.env.E2E_PAY_PORT ?? 3202);
// Optional: point at a preinstalled Chromium (e.g. /opt/pw-browsers/chromium).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

const emailEnv = {
  RESEND_API_KEY: "re_e2e_test_key",
  RESEND_API_URL: `http://localhost:${mockEmailPort}/emails`,
  BOOKING_NOTIFY_EMAIL: "alex-e2e@example.com",
  BOOKING_FROM_EMAIL: "RAENG <bookings-e2e@example.com>",
  // Authorises GET /api/cron/request-alerts (tests/e2e/booking.spec.ts).
  CRON_SECRET: "e2e-cron-secret-0123456789",
};

// Coach login against the Supabase Auth stand-in (tests/e2e/mock-supabase-auth.mjs).
const coachEnv = {
  SUPABASE_URL: `http://localhost:${mockSupabasePort}`,
  SUPABASE_SECRET_KEY: "sb_secret_e2e",
  COACH_EMAIL: "coach-e2e@example.com",
};

// Stripe with a test key against tests/e2e/mock-stripe.mjs (never real Stripe).
const stripeEnv = {
  STRIPE_SECRET_KEY: "sk_test_e2e_not_real",
  STRIPE_API_URL: `http://localhost:${mockStripePort}`,
  STRIPE_WEBHOOK_SECRET: "whsec_e2e_not_real",
  // Bacs is approved on the live account (2026-11-02): Direct Debit is offered first.
  DIRECT_DEBIT_ENABLED: "true",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: { executablePath },
    // Tests start as returning visitors, so the first-visit opening curtain
    // (lib/reveal.ts) doesn't play; tests/e2e/site.spec.ts covers it separately.
    storageState: {
      cookies: [],
      origins: [port, productionPort].map((p) => ({ origin: `http://localhost:${p}`, localStorage: [{ name: "raeng-intro", value: "1" }] })),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node tests/e2e/mock-email-server.mjs`,
      url: `http://localhost:${mockEmailPort}/`,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_EMAIL_PORT: String(mockEmailPort) },
    },
    {
      command: `node tests/e2e/mock-supabase-auth.mjs`,
      url: `http://localhost:${mockSupabasePort}/`,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_SUPABASE_PORT: String(mockSupabasePort) },
    },
    {
      command: `node tests/e2e/mock-stripe.mjs`,
      url: `http://localhost:${mockStripePort}/`,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_STRIPE_PORT: String(mockStripePort), MOCK_STRIPE_WEBHOOK_URL: `http://localhost:${payPort}/api/stripe/webhook`, MOCK_STRIPE_WEBHOOK_SECRET: stripeEnv.STRIPE_WEBHOOK_SECRET },
    },
    // Main server: a production build without CONTENT_PREVIEW, with booking
    // demo mode on (as on a Vercel preview) and email wired to the mock.
    {
      command: `npm run build && npx next start -p ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: { CONTENT_PREVIEW: "false", BOOKING_DEMO: "true", ...emailEnv, ...coachEnv },
    },
    // Vercel-production configuration, with BOOKING_DEMO set by mistake.
    {
      command: `npx next build && npx next start -p ${productionPort}`,
      url: `http://localhost:${productionPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: { NEXT_DIST_DIR: ".next-e2e-production", VERCEL_ENV: "production", BOOKING_DEMO: "true", CONTENT_PREVIEW: "true", ...emailEnv, ...coachEnv },
    },
    // Joining and paying online: booking requests on (no demo), Stripe test key against the stand-in.
    {
      command: `npx next build && npx next start -p ${payPort}`,
      url: `http://localhost:${payPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: { NEXT_DIST_DIR: ".next-e2e-pay", CONTENT_PREVIEW: "false", SITE_URL: `http://localhost:${payPort}`, ...emailEnv, ...coachEnv, ...stripeEnv },
    },
  ],
});

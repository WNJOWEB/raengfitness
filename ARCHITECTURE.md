# ARCHITECTURE — Alex K Bells

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.4 (App Router), React 19.3 | `cacheComponents` + `partialPrefetching` enabled (scaffold defaults). All routes prerender as static. |
| Language | TypeScript, `strict` | No `any`. |
| Styling | Tailwind CSS v4 | Tokens in `src/app/globals.css` `@theme` |
| Fonts | `next/font/google` (Archivo variable) | Downloaded at build and self-hosted; no runtime request to Google |
| Unit tests | Vitest 5 | `src/**/*.test.ts` |
| E2E / a11y | Playwright 1.56 + axe-core | `tests/e2e` |
| Hosting | Vercel | `vercel.json` pins the Next.js framework preset. Static output. Account ownership and plan: see DEPLOYMENT.md |
| Package manager | npm (lockfile committed) | Node ≥ 22 |

No database, auth or payment SDK is installed: Supabase is reached with plain `fetch` (Auth and PostgREST). The only database-related package is `@electric-sql/pglite` (devDependency, tests only; see Coach portal → Testing).

**Supabase** (connected 2026-10-17, config only): project `Alexkbells`, ref `sqkpixwvugrxllrxlexs`, region eu-west-1, URL `https://sqkpixwvugrxllrxlexs.supabase.co`. `supabaseConfig()` in `src/lib/env.ts` reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server-only; bypasses RLS) on the server and returns null when either is missing. Used by the coach login and booking request storage (both plain `fetch`, server-only); `@supabase/supabase-js` is not installed. Link the CLI with `npx supabase link --project-ref sqkpixwvugrxllrxlexs`. **Caution:** the project's `public` schema also holds another app's tables (the booking table is prefixed `akb_` to keep clear of them); on 2026-10-17 it held (Prisma-managed `User`, `Listing`, `Booking`, `Review`, PMS and affiliate tables, with rows) — apparently FYStay's. Decide whether to clear it or create a fresh project before any migration from this repo.

Next 16 differs from older versions; read `node_modules/next/dist/docs/` before using an unfamiliar API (see AGENTS.md).

### Coach login (2026-10-17)

`/coach/login` signs Alex in with Supabase Auth (email + password), modelled on the coach login of his Lovable site. Plain `fetch` to the Auth REST API with the secret key, on the server only (`lib/coach-auth.ts`), so no SDK and nothing in the browser bundle.
- Only `COACH_EMAIL` addresses may sign in; any other address gets the "don't match" message without reaching Supabase.
- Session: two httpOnly, SameSite=Lax cookies scoped to `/coach` (`lib/coach-cookies.ts`): the access token (expires a minute before Supabase's, ≤1 h) and the refresh token (7 days).
- `src/proxy.ts` (matcher `/coach/:path*`) only refreshes an expired access cookie. Every coach page and Server Action authorises itself with `requireCoach()` (`lib/coach-session.ts`), which checks the token with Supabase on each request.
- `/coach` is partially prerendered: the static shell plus a `<Suspense>` section that reads the session and lists booking requests and enquiries.
- Not indexed (`noindex`, robots `Disallow: /coach$` and `/coach/`; a bare `/coach` would also block `/coaching`), not in the sitemap; linked from the footer and the phone menu.
- E2E runs against `tests/e2e/mock-supabase-auth.mjs`.

### Coach portal (2026-10-19)

The coach area grew into a portal for running the business: Dashboard, Requests, Clients, Classes, PT sessions, Online coaching and Finances (`src/app/coach/(portal)/`, a route group so `/coach/login` stays outside it).

**Authentication and authorisation.** The existing coach login is reused, with no second auth system. Every portal page calls `portalContext()` and every Server Action and the CSV route call `actionContext()` (`lib/coach/context.ts`). Both run `requireCoach()`, which checks the session token with Supabase on each request and requires a `COACH_EMAIL` address; an email match alone never grants access. Links are hidden from nobody: protection is the server-side check. Pages render per request behind `<Suspense>`; the portal layout sets `instant = false` because ids in URLs can't be prerendered.

**Data access.** `lib/coach/db.ts` calls PostgREST with the secret key (`apikey` header only), on the server, after `requireCoach()`. Every call returns `{ ok, data } | { ok: false, error }` with kinds `unavailable`, `not-set-up` (migration not applied), `conflict`, `rule` and `invalid`. Pages show "couldn't be loaded" rather than empty data; actions show what to do and say nothing was saved. Logs carry operation, relation and error code only: no row data, messages or keys.

**Schema** (`supabase/migrations/20261019000000_akb_coach_portal.sql`; all tables `akb_`-prefixed, RLS on, no policies, `anon`/`authenticated` revoked, functions executable by `service_role` only):

| Table | Purpose |
|---|---|
| `akb_clients` | One record per person: name, email (unique, case-insensitive), phone, Instagram, preferred contact, status `lead/active/paused/former`, admin notes. No health fields |
| `akb_client_consents`, `akb_follow_ups` | Consent records (privacy notice, photos, marketing; given/withdrawn dates); follow-up actions with due dates |
| `akb_booking_requests` (existing) | Gains `client_id`, `decided_at`, `decision_note`, `notified_at`, `class_date`, `class_slot`; statuses `new/awaiting/confirmed/declined/cancelled/completed`. Existing rows kept |
| `akb_class_sessions`, `akb_class_attendance` | A row per timetable class date (created on first use; optional capacity, notes) and one place per person per class (`booked/attended/cancelled/no_show`) |
| `akb_pt_sessions`, `akb_packages` | One-to-one sessions (start/end, agreed price or a package, `scheduled/attended/no_show/cancelled`); no two non-cancelled sessions may overlap (exclusion constraint). Packages of N sessions |
| `akb_subscriptions`, `akb_check_ins` | Online coaching plans (monthly price, start/end/renewal, status, check-in interval, next check-in) and check-ins (summary, agreed actions) |
| `akb_charges`, `akb_payments`, `akb_payment_allocations`, `akb_refunds` | The ledger (below) |
| `akb_events` | Activity log: decisions, reschedules (old time kept), voids, refunds |
| Views `akb_charge_balances`, `akb_payment_balances`, `akb_package_balances`, `akb_client_balances`, `akb_class_overview` | Derived totals (`security_invoker`, so as closed as the tables) |

Rules enforced in the database (so no browser or stale page can break them): one client per email; one place per person per class; capacity counted under a row lock; package places counted under a lock (a session holds at most one place, so it can't be deducted twice; cancellations give it back, no-shows don't); no overlapping one-to-ones; one charge per subscription period; payments and refunds can't be edited or deleted (only a payment's status can change to `failed`/`void`, which releases its allocations, logged).

**Atomic operations** (Postgres functions, one transaction each, called as RPC): `akb_confirm_request` (pick or create the client, book the class place or session with its charge, mark confirmed, log), `akb_add_attendee`, `akb_add_pt_session`, `akb_reschedule_pt_session`, `akb_set_pt_status`, `akb_set_attendance` (cancelling also cancels an unpaid charge), `akb_add_package`, `akb_charge_subscription_period`, `akb_record_payment` (idempotent on a per-form key), `akb_allocate_payment`, `akb_record_refund`, `akb_void_charge`, `akb_set_payment_status`.

**Matching returning clients.** A trigger links a new request to the client with the same email (case-insensitive), and a new or edited client picks up earlier requests with their email. A matching phone (last 10 digits) or name is only offered to the coach as a possible match; nothing ambiguous is merged.

**Money definitions** (`lib/coach/revenue.ts`, unit-tested):
- *Payments received*: payments with status `received` dated in the period, minus refunds dated in the period. Each payment counts once, however it is allocated. Failed and void payments never count.
- *Revenue by service*: the same, grouped by the service recorded on the payment (cash basis; a refund follows its payment's service).
- *Outstanding*: charges due on or before today, not cancelled, minus allocations to them. Charges due later are shown separately; unallocated money is shown as credit.
- *Expected recurring income*: monthly price of active, unended online subscriptions. A forecast, labelled as such, never counted as received.
- *Package sales*: price of packages sold in the period, the amount collected on them so far, and sessions delivered.
- GBP only, stored in pence. A refund comes out of a payment's unallocated money first; beyond that it reduces its allocation to a chosen charge, which is owed again unless the coach cancels it.

**Notifications.** The site never messages clients. After a decision, the request page shows a ready-written message (confirmed or declined) with an "Open in email" `mailto:` link and a "Mark as told" button (`notified_at`). New-request emails to Alex (Resend) are optional; whether each was sent is recorded on the request (Key decisions 5) and shown on its page as "Email alert".

**CSV export.** `GET /coach/finances/export?from&to&service`: coach-only, `no-store`, UTF-8 with BOM; cells starting with `= + - @` are prefixed with `'` so names can't run as spreadsheet formulas.

**Square card payments (2026-10-21, built, not live).** One flow only: **Square Checkout payment links** (Square-hosted page, so no card data touches this site; no Web Payments SDK). The public booking form is unchanged: a request is still a request, confirmed by Alex.

1. The coach confirms a request; the portal creates the charge (unchanged).
2. On the client's Payments tab, **Card link** (`squareLinkAction` → `createChargeLink`, `lib/square/sync.ts`) inserts an `akb_square_payment_links` row (status `creating`, the charge's outstanding amount, a UUID idempotency key), then calls `POST /v2/online-checkout/payment-links` (quick pay, GBP, Alex's location) with that key, and stores the link id, order id and URL (status `open`). A retry reuses the key, so Square returns the same link; a charge has at most one live link (partial unique index).
3. Alex sends the URL; the client pays on Square's page. Square's own confirmation is what the client sees: there is no redirect back to this site, so no browser state can be mistaken for a payment.
4. Square POSTs `payment.created/updated` to `/api/square/webhook`. The handler checks the size, then `x-square-hmacsha256-signature` = base64 HMAC-SHA256(signature key, registered notification URL + raw body) in constant time (algorithm cross-checked against the official SDK's `WebhooksHelper`), then inserts the `event_id` into `akb_square_events` (repeat deliveries are recognised), then **re-reads the payment from `GET /v2/payments/{id}`** (the event body is never trusted), checks the location, and calls `akb_apply_square_payment`: only a `COMPLETED` GBP payment for one of our orders is recorded, once (provider `square`/`square_sandbox` + unique `provider_payment_id`), as method `card`, allocated to what is still owed on the charge (any excess, or a cancelled charge, becomes credit), and the link is marked `paid`. `APPROVED`/`PENDING` → nothing yet; `FAILED`/`CANCELED` → nothing, the link stays open for another try. Square or database unreachable → 500 so Square redelivers; the event row keeps the attempt count and an error code.
5. Refunds are made in the Square Dashboard. `refund.created/updated` → `GET /v2/refunds/{id}` → its payment is synced first (so arrival order doesn't matter) → `akb_apply_square_refund` records a `COMPLETED` refund once (key `square…-refund:<id>`); the charge is owed again unless the coach cancels it. The portal's own refund and failed/void actions refuse Square payments (`provider_managed`), because they wouldn't move money in Square.
6. `/api/cron/square-reconcile` (daily, `CRON_SECRET`) asks `GET /v2/orders/{order_id}` for each open link's payments and applies them, catching missed webhooks; idempotent with the webhook path.
7. Cancelling a charge retires its live link in the portal (`akb_void_charge`); a payment that still arrives through it becomes credit. Deleting the link at Square is a manual Dashboard step.

Environments: `SQUARE_ENVIRONMENT=production` works only on Vercel production and `sandbox` only off it (`lib/square/config.ts`), so previews can't take real money and production can't run on test credentials. Test payments are stored as provider `square_sandbox`. **Previews share production's Supabase project**, so Sandbox testing happens only against a local Supabase stack, with an HTTPS tunnel to `scripts/square-webhook-gateway.mjs` that forwards nothing but the webhook (DEPLOYMENT.md → Square Sandbox test environment). Two guards keep test money out of the live ledger: Sandbox mode refuses the live `SUPABASE_URL`, and the database refuses Sandbox records unless it carries the `akb_database_role` = `test` marker (no marker = production; the app's role can't set it). No SDK dependency: plain `fetch`, `Square-Version: 2026-09-16`. Logs carry event types, ids, outcomes and status codes only.

**Testing.** `tests/support/postgrest-lite.mjs` runs every migration on PGlite (in-process Postgres 18, WASM) with Supabase's roles and default grants, behind a small PostgREST stand-in (filters, `or`, ordering, inserts with conflict handling, updates, deletes, RPC). The e2e mock (`tests/e2e/mock-supabase-auth.mjs`) and the unit tests (`src/lib/coach/*.test.ts`) both use it, so constraints, triggers and functions are tested for real. Only the HTTP layer is imitated. `@electric-sql/pglite` is a devDependency for this alone; it never ships.

**Applying the migration** (not yet applied to the Supabase project; needs the owner's approval): see DEPLOYMENT.md → Coach portal. It is re-runnable (`if not exists` / `or replace`). Before it is applied, the portal shows "tables aren't set up yet" and the request inbox still works.

## Brand assets

`scripts/brand_assets.py` (Python + Pillow, run manually) crops the supplied
logo in `assets/brand/` into transparent PNGs in `public/brand/` and the
file-based icons in `src/app/` (`icon.png`, `apple-icon.png`), plus the
social preview image `public/og-image.png`. Outputs are committed, so builds
don't need Python.
Pillow was used because `sharp` (bundled with Next) has no native binary in
the development container.

### Supplied photos of Alex

`scripts/supplied_photos.py` (Python + Pillow, run manually) crops the
photos in `assets/journey/` to 4:5 (the before/after pair with matching
framing), resizes them to 720×900 and applies the hero video's black-and-white
grade, writing `public/journey/before.jpg` and `after.jpg` (committed). It still lists the
About portrait (`public/images/alex/about.jpg`), which was removed from the
site 2026-11-05.

### Hero video

`scripts/hero_video.py` (Python + OpenCV + numpy + ffmpeg, run manually)
cuts the hero loop from Alex's reel. It removes his own caption/handle
overlays by building exact per-pixel templates (pixels bright in every frame
across differently lit clips) and inpainting only those pixels, crops each
clip to 4:5, grades to black and white, and encodes VP9 WebM (first source)
and H.264 MP4 (Safari/iOS) from a lossless master, plus a JPEG poster.
Outputs (~1.2 MB each; browsers fetch one) are committed; the 30 MB source
reel is not. `HeroVideo` is the only other client component.

## Structure

```
src/
  app/                 routes, metadata, sitemap.ts, robots.ts, not-found.tsx
  components/
    layout/            SiteHeader, NavLinks (client), SiteFooter, Logo
    booking/           BookingPage, BookingWizard, AvailabilityCalendar, OnlineOnboarding, ui (client)
    coach/             portal forms (client), ui, PortalNav, RevenueChart, LoginForm
    ui/                ButtonLink, Section, Provisional
    sections/          Timetable, PriceList, Location, Faq, CtaBand, PageHeader, JsonLd
  content/             typed business data (single source of truth) + tests
  lib/                 coach/ (portal data layer, money, time, revenue), booking modes, request/enquiry parsing, form validation, publish gate, schedule/format helpers, env, routes
    availability/      availability interface, dates, demonstration provider
tests/e2e/             Playwright specs
```

Lazy loading (2026-10-18): images are `next/image` (lazy below the fold; the hero video and desktop page-header stills load first on purpose). `TrainingIntro` and `AvailabilityCalendar` are `next/dynamic` chunks, fetched on intent (hovering/touching/focusing "Book now"; choosing a service) rather than with the page.

Client components: `NavLinks.tsx` (menu state), `HeroVideo.tsx`, `StartTraining.tsx` / `TrainingIntro.tsx` (swipe button and booking intro), and the booking journeys in `components/booking/`.

## Key decisions

1. **Content as typed modules, not a CMS.** Small, rarely changing data; type-checked; reviewed in Git. Revisit (Supabase table or headless CMS) when Alex needs to edit without a developer — Phase 4.
2. **Status-gated content.** `ContentStatus` + `Provisional` component + `CONTENT_PREVIEW` lets unconfirmed information be reviewed without ever shipping it to production.
3. **Booking boundary** (`src/lib/booking.ts`). Pages ask for a `CallToAction` and a `bookingMode()`; they never know the provider. Modes, in order: `external` (`BOOKING_URL`, https only) → `demo` (`BOOKING_DEMO=true`, impossible on Vercel production) → `request` (Supabase storage and/or Resend email configured) → `unavailable` (Instagram prompt). Since 2026-10-18 `/book` is public: `getPrimaryCta()` sends "Book now" there whenever the mode isn't `unavailable` (and always on previews); `getPrimaryCtaFor()` deep-links a service's own page.
4. **Guided booking** (`components/booking/BookingWizard.tsx`). Three steps — service, when, details — with a stepper, a summary with "Change" links, Back, and a Continue button disabled until the step is complete. Choices are native radios/checkboxes styled as tiles (keyboard and screen readers work by default); focus moves to each new step's heading. State lives in the client until the final step, which posts to a Server Action (`src/app/book/actions.ts`).
   - *demo*: a month calendar of **demonstration availability** (`lib/availability/demo.ts`), labelled "Demo" on the page, above the calendar and in the summary. Finishing shows "No booking has been made"; nothing is sent. The demo module is loaded with a dynamic `import()` so it never downloads in request mode, and the server refuses any posted `slot`.
   - *request*: group classes show real dates from the confirmed timetable (`lib/availability/timetable.ts`, `source: "live"`, next 28 days, every date requestable since capacity is unknown) with the class set out like Alex's listing (`groupClass` in `content/classes.ts`); the server re-checks the date is a real class day in the window (`isClassDate`). One-to-one asks for preferred days and times. Alex confirms each request.
   - **Replacing the demo with real availability:** implement `AvailabilityProvider` (`lib/availability/types.ts`) for the chosen provider or backend, add a `live` mode that uses it, and make the final step create the booking through that provider (server-side, idempotent, confirmed only by the provider's response). The calendar and wizard do not change.
5. **Request and enquiry delivery.** Server-side validation (`src/lib/booking-request.ts`, `src/lib/online-enquiry.ts`; field rules shared with the browser in `src/lib/form-validation.ts`), spam checks (honeypot + minimum fill time), then `deliverRequest()` (`src/lib/deliver-request.ts`): stored in Supabase (`src/lib/request-store.ts`, table `akb_booking_requests`, upsert on an idempotency key so retries store once) and/or emailed via Resend with the same key. Success is shown only when at least one route accepted it. **Alerts to Alex (2026-10-20):** storing and emailing run side by side and never depend on each other. A transient email failure is retried once at once with the same key; then the outcome is written to the row (`alert_status` sent/failed, `alert_attempts`, `alert_error` as a code such as `http-503`, and the exact subject/body) by a separate update, so a missing column or failed update only logs. `GET /api/cron/request-alerts` (Vercel Cron, `CRON_SECRET` bearer, constant-time check) resends failed alerts under 23 hours old, claiming each row by bumping `alert_attempts` from the value it read so concurrent runs can't both send, and sending the stored email unchanged with the original idempotency key: inside Resend's 24-hour key window a lost-but-accepted send can't be delivered twice. Logs carry the request kind, row id and an error code, never names, emails or provider responses (`src/lib/request-alerts.ts`). The coach area (`/coach`) lists stored requests newest first. Table: `supabase/migrations/20261017000000_akb_booking_requests.sql` (applied 2026-10-18): RLS on with no policies and anon/authenticated revoked, so only the server (secret key) reads or writes it.
6. **Online coaching onboarding** (`/online-coaching`, `components/booking/OnlineOnboarding.tsx`). Not a calendar: goal → training → contact → review & send, with progressive disclosure ("Something else" asks for detail; a phone number or Instagram username is asked for only if that contact method is chosen). Reuses the same primitives, validation and delivery (stored in Supabase as `kind: online`, so it appears in the portal's Requests, and/or emailed). No health questions. Every link to it comes from `getOnlineCoachingAction()` ("Enquire about online coaching"), which falls back to `/contact` when sending isn't configured, so no page promises a form that can't send.
7. **e2e servers.** Playwright builds two copies: the main one (`.next`, booking demo on, email to `tests/e2e/mock-email-server.mjs`) and a Vercel-production one (`NEXT_DIST_DIR=.next-e2e-production`, `VERCEL_ENV=production` with `BOOKING_DEMO` and `CONTENT_PREVIEW` set by mistake) that must show no demo or provisional content. `tsconfig.json` lists the second build's types folder so builds don't rewrite it.
8. **No embedded map.** Google Maps link only, avoiding third-party cookies and a consent banner.

## Environment variables

See `.env.example`. All are server/build-time only (no `NEXT_PUBLIC_*`).

| Name | Purpose |
|---|---|
| `SITE_URL` | Canonical origin (metadata, sitemap, JSON-LD). Validated; falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then localhost |
| `BOOKING_URL` | External booking page (https only); takes priority over everything else |
| `BOOKING_DEMO` | `true` shows demonstration availability on `/book` (previews/local only). **Ignored when `VERCEL_ENV=production`** |
| `RESEND_API_KEY`, `BOOKING_NOTIFY_EMAIL`, `BOOKING_FROM_EMAIL` | Booking request form delivery; all three valid → form on, else off. Server-only |
| `RESEND_API_URL` | Tests only: endpoint override, accepted only for https or `http://localhost` |
| `CONTENT_PREVIEW` | `true` on preview deployments only. **Ignored when `VERCEL_ENV=production`** |
| `PLAYWRIGHT_CHROMIUM_PATH`, `NEXT_DIST_DIR`, `E2E_PORT`, `E2E_PRODUCTION_PORT`, `MOCK_EMAIL_PORT` | Tests only |

Per-environment values: DEPLOYMENT.md. Non-production deployments (and local
builds with `CONTENT_PREVIEW=true`) get `robots.txt` Disallow plus a
`noindex, nofollow` meta tag (`isIndexable` in `src/lib/env.ts`).

Metadata: `src/lib/metadata.ts` `pageMetadata()` gives every page its own
title, description, canonical URL and Open Graph/Twitter preview. The share
image (`public/og-image.png`) is declared explicitly because a page-level
`openGraph` object replaces the layout's.

## Security

- Headers (`src/lib/security-headers.ts`, applied in next.config.ts): `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS (no preload); `X-Powered-By` removed.
- CSP on builds (not `next dev`): first-party only for scripts, styles, fonts, media, connections; `frame-ancestors`/`object-src` `'none'`. `script-src` needs `'unsafe-inline'` because nonces would force dynamic rendering. Vercel preview deployments also allow `vercel.live` for the Toolbar. Any new third-party service must be added here deliberately.
- JSON-LD escapes `<`.
- No secrets exist yet; `.env*` is git-ignored except `.env.example`.
- `npm audit --omit=dev` (2026-10-15): **0 vulnerabilities** in production dependencies. Full audit: 5 high-severity advisories, all via `braces` in the dev-only ESLint toolchain (`eslint-config-next` → `fast-glob`); not shipped to the browser. The suggested `--force` fix downgrades to Next 14 config — do not apply; update when `eslint-config-next` publishes a fix.
- `playwright-core` is pinned as a devDependency so `@axe-core/playwright` uses the same Playwright version as the tests.

## Enquiry form options (not implemented)

The booking and online coaching journeys (above) use option 3. The
contact page itself still has no form; options for general enquiries, in
order of effort:

1. **Instagram only (current).** No personal data stored by the site.
2. **`mailto:` link** — needs a confirmed public email address; no backend.
3. **Server Action + email API** (e.g. Resend/Postmark): server-side
   validation, honeypot + rate limit, sends to Alex's inbox, stores nothing.
   Needs: a confirmed recipient address, an email provider account owned by
   Alex with a verified sending domain (needs the domain decision), an API key
   in Vercel env vars, and a privacy notice. Avoid hosted form widgets that
   would need CSP exceptions and third-party data processing.

## Phase 2+ proposals (not implemented)

**Booking & payments** — choose one after confirming capabilities:
- *A. Hosted provider* (Setmore or Square Appointments): set `BOOKING_URL`. Lowest effort, no PII stored by us.
- *B. Custom booking + Square Online Checkout*: Next.js Route Handlers → Supabase Postgres; Square payment links; Square webhooks verified with the documented HMAC-SHA256 `x-square-hmacsha256-signature` (verify against current docs before building). Payment status only ever set from verified webhooks, never from the client.

Draft data model for B:
- `class_types(id, name, duration_min, capacity, price_pence)`
- `class_sessions(id, class_type_id, starts_at, capacity_override, status)`
- `customers(id, auth_user_id, name, email, phone, created_at)` — no health data
- `bookings(id, session_id, customer_id, status[pending|confirmed|cancelled], idempotency_key UNIQUE, created_at)` with `UNIQUE(session_id, customer_id)`
- `payments(id, booking_id, provider, provider_payment_id UNIQUE, status, amount_pence, raw_event_id UNIQUE)`
- Capacity enforced in a transaction (`SELECT … FOR UPDATE` on the session or a counted insert with a check) to handle the last-place race.
- RLS: customers read/write only their own rows; admin role via custom claim; service role only in server code.

**Membership** — Square Subscriptions if enabled on Alex's account; otherwise defer. Never build a checkout for an undefined plan.

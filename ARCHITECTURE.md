# ARCHITECTURE — RAENG

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

**Chosen plan on the booking page (2026-10-26).** `?plan=` is validated against the published plans in three places: `PLAN_SCRIPT` (lib/plan-flag.ts, in `<head>`, sets `<html data-plan>` before first paint so the pre-rendered "Your plan" box shows without a layout shift), `PlanFlag` (keeps the attribute right after in-app navigation and clears it on leaving), and the server action (lib/booking-request.ts) for what is actually stored.

**Memberships** (`20261023000000_akb_memberships.sql`, `lib/coach/memberships.ts`, applied 2026-10-23). `akb_memberships` (one current membership per client, unique partial index; plan name, price and credits copied from `content/memberships.ts` at start) and `akb_membership_periods` (four weeks each, one per membership and start date, each linked to one charge). A class place can carry `membership_period_id`; a trigger checks the period is the member's own and covers the class date, and counts used credits under a lock (booked, attended, no-show, and places cancelled under 24 h before the class, flagged `late_cancel`). Functions: `akb_start_membership`, `akb_renew_memberships` (idempotent; daily cron), `akb_set_membership_status`, `akb_use_membership_credit` (cancels the place's unpaid pay-as-you-go charge), `akb_return_credit`. View `akb_membership_period_balances`. No subscription product: billing is the period charge in the ledger (members who pay online are charged to their saved card: see Renewals by saved card). Confirming a member's class request uses a credit (`periodOn` is checked before anything is saved, then `akb_use_membership_credit`); renewals also catch up on portal visits (`catchUpRenewals`). **Cancelling a class** (`20261024000000_akb_cancel_class.sql`): `akb_cancel_class` cancels every booked place with `akb.return_credit` on (credits back, never a late cancellation), unpaid charges cancelled through `akb_set_attendance`; a trigger refuses new or restored places on a cancelled class; `akb_class_overview` gains `cancelled_at`/`cancel_reason`, and `/api/classes/full` returns `cancelled` keys, which the booking calendar leaves out and the booking action refuses.

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

**Stripe card payments (built 2026-10-21 for Square; moved to Stripe 2026-10-30; live 2026-11-02).** One flow: **Stripe Checkout** (Stripe-hosted page, so no card data touches this site; no card fields of our own). The payment tables and functions keep their `akb_square_*` names (renaming them would touch every function and view for no gain); they now hold Stripe's ids: a checkout session id where a Square order id used to be, a payment intent id where a payment id was. Providers are recorded as `stripe` (live) or `stripe_test`. The public booking form is unchanged.

1. The coach confirms a request; the portal creates the charge (unchanged). Members who join or book online get their charge at once.
2. **Card link** in the coach portal (`createChargeLink`, `lib/stripe/sync.ts`) inserts an `akb_square_payment_links` row (status `creating`, the charge's outstanding amount) and asks Stripe for a Checkout session with an idempotency key, then stores the session id and URL (status `open`). A charge has at most one live link; an old one is replaced.
3. The payer pays on Stripe's page and comes back to `/pay/done` (or the join and booking confirmation pages), which only reads the state from the database and never says "paid" until the verified payment is recorded.
4. Stripe POSTs signed events to `/api/stripe/webhook`. The handler checks the size and the `Stripe-Signature` HMAC (`lib/stripe/signature.ts`), records the event id once (duplicates ignored), then **re-reads the session, payment or refund from Stripe's API** and applies it with one idempotent database function (`akb_apply_square_payment`, `akb_apply_square_refund`). Nothing is trusted from the event body or the browser.
5. Refunds are made in the Stripe Dashboard; `refund.created/updated` and `charge.refunded` are mirrored once into `akb_refunds` and the charge is owed again unless the coach cancels it. Exception (owner, 2026-11-03): once a payment for an online class booking the member has already cancelled is **fully** refunded, an unused class credit from that cancellation is withdrawn (logged `credit_withdrawn`) and the class fee is cancelled, so the member gets the money or a free class, not both and owes nothing. If the credit has already booked another class, the fee stays owed for the coach to decide. Partial refunds are unchanged (`akb_apply_square_refund`, migration `20261108000000`). The other order is handled too (migration `20261109000000`): once a paid class booking has been fully refunded, cancelling it (private link or account) gives no class credit and cancels the fee; both cancel screens and the emails say the payment was already refunded (`akb_class_booking_refunded`). Memberships follow the same rule (migration `20261110000000`): a full refund of a period's payment once the membership is cancelled cancels that period's fee and ends its unused credits (credits already used stay used; logged `credits_withdrawn`). A refund while the membership is still running, or a partial refund, leaves the fee owed for the coach to decide.
6. `/api/cron/stripe-reconcile` (daily, `CRON_SECRET`) re-reads each open link's session (or payment intent, for a saved-card or Direct Debit collection) and applies it, catching missed webhooks; idempotent with the webhook path.
7. Cancelling a charge retires its live link in the portal (`akb_void_charge`); a payment that still arrives through it becomes credit.

Environments: a live key (`sk_live_`) works only on Vercel production and a test key (`sk_test_`) only off it and never against the live database (`lib/stripe/config.ts`), so previews can't take real money and production can't run on test keys; the database refuses it too (`akb_database_role`).

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
grade, writing `public/journey/before.jpg`, `after.jpg` and
`public/images/alex/about.jpg` (committed).

### Hero video

**Current (2026-10-22, latest):** `scripts/hero_edit.py` (Python + ffmpeg, OpenCV for face tracking so the crop keeps heads in frame) cuts the JD Gyms-style hero: varied rhythm, slow motion and speed-ups inside shots, whip-pan swipes with motion blur, push-in zooms, landscape and 9:16 versions. Before that, `scripts/hero_montage.sh` (ffmpeg only) cuts a fast montage of twelve short shots (faces in frame, one grade, seamless loop) with cross/whip transitions and a few slow-mo shots, in a landscape and a 9:16 phone version from the owner's phone clips: landscape crop, slight warmth, silent, H.264 MP4 + VP9 WebM + poster. The paragraph below describes the earlier, superseded pipeline.

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
- *A. Hosted provider* (Setmore): set `BOOKING_URL`. Lowest effort, no PII stored by us.
- *B. Custom booking + Stripe Checkout* (chosen and built): Next.js Route Handlers → Supabase Postgres; Stripe Checkout links; Stripe webhooks verified by signature and re-read from Stripe's API (see Stripe card payments above).

Draft data model for B:
- `class_types(id, name, duration_min, capacity, price_pence)`
- `class_sessions(id, class_type_id, starts_at, capacity_override, status)`
- `customers(id, auth_user_id, name, email, phone, created_at)` — no health data
- `bookings(id, session_id, customer_id, status[pending|confirmed|cancelled], idempotency_key UNIQUE, created_at)` with `UNIQUE(session_id, customer_id)`
- `payments(id, booking_id, provider, provider_payment_id UNIQUE, status, amount_pence, raw_event_id UNIQUE)`
- Capacity enforced in a transaction (`SELECT … FOR UPDATE` on the session or a counted insert with a check) to handle the last-place race.
- RLS: customers read/write only their own rows; admin role via custom claim; service role only in server code.

**Membership** — built (2026-11-02) on Stripe's saved cards rather than a subscription product: see Renewals by saved card. Never build a checkout for an undefined plan.

**Booking a group class and paying online** (2026-10-27, owner; migration `20261029000000_akb_instant_class_booking.sql`, not yet applied). On wherever online joining is. `lib/class-checkout.ts`: `startClassCheckout` (rpc `akb_create_class_booking`: client by email, a `booked` place with `hold_expires_at` = now + 15 min, a charge at the content price and an `akb_class_bookings` row, idempotent per submission; with a valid credit token hash it's confirmed at once for the credit's owner with no charge; then `createChargeLink` with `redirect_url` `/book/done?booking=<id>`), `classBookingStatus` (done page), `notifyClassBookings` (once per booking, `notified_at`; makes the private manage token, stores only its hash), `bookingByToken`, `cancelByToken` (rpc `akb_cancel_class_booking`: 24 h or more before → a credit row valid 28 days, its token returned once and emailed), `creditStatus`. Capacity counts only live places (`akb_attendance_capacity` ignores holds that ran out; `akb_create_class_booking` also expires them). A trigger on `akb_payment_allocations` confirms the booking and clears the hold when its charge is fully paid, or marks `needs_attention` if the place can't be had. `submitBookingRequest` sends group classes there (not 1:1, not with a plan); the wizard's `pay` prop changes the copy and the button ("Pay £12" / "Book with your credit") and reads `?credit=` on the client so the page stays static. Pages `/book/done` and `/book/manage` (cancel is a POST) render per request (`instant = false`), noindex, Disallowed in robots. The webhook and the reconcile cron call `notifyClassBookings`; the renewal cron calls `akb_release_class_holds`. Tests: the SQL test, `src/lib/class-checkout.test.ts`, `tests/e2e/class-pay.spec.ts`.

**Sign-in code** (owner, 2026-11-03; migration `20261111000000`): the sign-in email carries a 6-digit code beside the link (subject "Your RAENG sign-in code: 123 456"), because iPhone mail apps open links in their own browser. The sign-in page asks for it after sending (`autocomplete=one-time-code`, number keypad). The code shares the link's row (`akb_member_login_links.code_hash`, SHA-256 only): using either uses both; 15 minutes; after 5 wrong codes in 15 minutes none is accepted (`code_attempts`). `akb_member_create_sign_in` / `akb_member_redeem_login_code`, server only; every failure gives the same answer.

**Accounts for everyone who has paid** (2026-10-28, owner: the standard gym flow; migration `20261030000000_akb_customer_accounts.sql`, not yet applied). `akb_can_sign_in` (a member, any membership ever, a confirmed/cancelled/needs-attention class booking, or a received payment) replaces `akb_is_member` in the three sign-in functions; booking with membership credits still needs `akb_is_member`. `akb_member_overview` now returns `client` (name, email, phone), every place with `how` (credit / paid / class_credit / other; held places left out), `class_credits` and `paid_classes_28d` (14 days back to 13 ahead), and works without a membership. New: `akb_member_cancel_booking` (own paid booking by place, same 24-hour credit rule as the link) and `akb_member_book_with_class_credit` (own credit → `akb_create_class_booking` with its stored hash). Site: `/account` for members and pay-as-you-go (`bestPlanFor` in `lib/membership.ts` for the saving line), actions `cancelClass` (paid=yes → class credit) and `bookClassWithCredit` (then `notifyClassBookings`), `GET /api/account/details` (own name/email/phone, `no-store`), `useSignedInDetails` (`lib/signed-in-details.ts`) filling empty fields in `BookingWizard` and `MembershipJoin`. The member cookie path is `/` (was `/account`; sign-out clears both). Menu and footer say "Sign in". Tests: the SQL test, `src/lib/membership.test.ts`, `tests/e2e/account.spec.ts`.

**Joining and paying online** (2026-10-26, owner: "user can pay for membership without Alex having to confirm"; migration `20261028000000_akb_self_serve_memberships.sql`, not yet applied). `lib/membership-checkout.ts`: `onlineJoinEnabled()` (booking requests on, database configured, `stripeConfig()` non-null; so never on previews, which share the live database and therefore refuse Sandbox), `startCheckout` (rpc `akb_create_membership_signup`: client by email, one charge at the content price, a sign-up row; then `createChargeLink` with the buyer's email and `checkout_options.redirect_url` to `/memberships/join/done?signup=<id>`), `signupStatus`, `notifyNewMembers` (once per sign-up, `notified_at`), `sendRenewalLinks` (rpc `akb_unpaid_online_periods`, once per period, `pay_link_sent_at`), `paymentDue` (account page). The join action redirects to the Stripe URL; the done page only reads the database (refreshes every 4 s while waiting). Activation is a trigger on `akb_payment_allocations` (insert or top-up): when the sign-up's charge is fully paid it inserts the membership (`pay_online`) and its first period on that charge, then books the first class with `akb_member_book_class`; any failure marks `needs_attention` without undoing the payment. `akb_class_attendance_period_paid` refuses new credit use on an unpaid period of a `pay_online` membership (`akb:period_unpaid`). The webhook route and the reconcile cron call `notifyNewMembers`; the renewal cron calls `sendRenewalLinks`. Tests: `supabase/tests/20261028000000_akb_self_serve_memberships.test.sql`, `src/lib/membership-checkout.test.ts` (real migrations + Stripe/Resend stand-ins), `tests/e2e/join-pay.spec.ts` (a build with Stripe Sandbox settings against `tests/e2e/mock-stripe.mjs`, whose checkout page sends a signed webhook like Square).

**Member accounts** (2026-10-26, owner's choices in docs/MEMBER_ACCOUNTS_DRAFT.md; migration `20261027000000_akb_member_accounts.sql`, not yet applied live). Own one-time email links, not Supabase Auth: the Supabase project is shared with another app, and Supabase Auth users get the `authenticated` role there. `lib/member-auth.ts` makes 32-byte random tokens (base64url) and stores only their SHA-256 hashes (`akb_member_login_links`, 15 minutes, single use, 5 an hour per member; `akb_member_sessions`, 30 days). The cookie `akb_member_session` (httpOnly, SameSite=Lax, Secure in production, Path=/account) holds the random session value. `lib/member-session.ts` (`currentMember`, `requireMember`) checks it with the database on every request (`akb_member_session_client`, which also ends sessions of people who are no longer members); it calls `connection()` first so Next's prerender pass doesn't start and cancel the lookup. `/account/confirm` signs in only on a button press (POST), so email scanners can't use up a link. The account pages (`instant = false` like the coach portal) read `akb_member_overview`; booking (`akb_member_book_class`) takes the slot and date from the form but the start time and length from the published timetable; cancelling (`akb_member_cancel_place`) only for the member's own credit-paid places, with the 24-hour rule from the existing trigger. Every member function checks ownership in SQL. Sign-in email: `sendEmail` with a `to` override, replies to `BOOKING_NOTIFY_EMAIL`; the visitor sees the same answer whether or not the address is a member's. Links: `memberLinkOrigin()` (SITE_URL / production URL, or the preview's own URL), never the Host header. Tests: `supabase/tests/20261027000000_akb_member_accounts.test.sql` (real Postgres 16), `src/lib/member-auth.test.ts`, `tests/e2e/account.spec.ts`.

**Membership join flow** (2026-10-26, owner's choices: Alex confirms then the member pays; optional first class; member accounts next). `/memberships/join` (`components/booking/MembershipJoin.tsx`, client) reuses the booking flow's parts (Stepper, calendar, fields, ActionBar, #step history). `submitMembershipRequest` (`app/memberships/join/actions.ts`) validates with `parseMembershipRequest` (`lib/membership-request.ts`: real plan, an optional real upcoming class, details, required agreement), refuses full or cancelled classes, and delivers through `deliverRequest` like a booking: `kind: "booking"`, `service: "Membership"`, details `plan`, `membership`, `terms` (agreement time), and `classDate`/`classSlot` when a first class was chosen. No schema change: the coach area's "Start this membership" already works from `details.plan`. Same switch as booking (`bookingMode`): request → sends; demo (previews) → walks through, sends nothing; otherwise the Instagram route.

**Account menu settings** (2026-10-28, owner: build all four items in the members design's account menu; migration `20261031000000_akb_member_settings.sql`, not yet applied). Same model as member accounts: the server passes the session's client id; every function checks ownership in SQL; three new tables have RLS on, no policies and `anon`/`authenticated` revoked. `lib/member-settings.ts` wraps the functions. *Profile* (`/account/profile`, `akb_member_update_profile`): name and phone only; the email is read-only because it is the sign-in and the booking match. *Security* (`/account/security`): `akb_member_sessions_list` (ids and labels, never hashes) and `akb_member_end_other_session` (only this client's, never the current one); `confirmSignIn` labels the new session with `deviceLabel(user-agent)` ("iPhone, Safari", at most 60 characters). *Calendar sync* (`/account/calendar-sync`): a random 32-byte token whose SHA-256 is stored in `akb_member_calendar_feeds` (one per client); `createCalendarLink` returns the URL once through `useActionState`; the public route `/account/calendar/feed/<token>.ics` finds the client by the hash, returns `icsFeed()` (booked and attended, not cancelled; `REFRESH-INTERVAL` one hour; UIDs equal the single-class download's) with `Cache-Control: private, no-store`, and answers 404 for anything unknown. *Notifications* (`/account/notifications`, `akb_member_settings.class_reminders`, default off): the daily `/api/cron/class-reminders` asks `akb_class_reminders_due(today in London)` and emails each place once (`akb_class_reminders` after the send, Resend idempotency key per place); it does nothing without the email settings. No new dependency. Tests: `src/lib/coach/member-settings.test.ts`, `src/lib/member-settings.test.ts`, `src/lib/calendar.test.ts`, `tests/e2e/account.spec.ts`.

**Raeng Coaching** (2026-10-28, owner's zip `raeng-redesign`: the coaching area of `members.html`; migration `20261101000000_akb_coaching_area.sql`, not yet applied). Added to the members area without changing its pages. *Who:* `akb_coaching_subscription(client)` = the client's active `akb_subscriptions` row (the coach area's Online coaching); `akb_can_sign_in` now includes it. *Data:* `akb_coaching_programmes` (one live per subscription), `akb_coaching_items` (week, day, position, name, sets, reps, load, note, an https demo link), `akb_coaching_logs` + `akb_coaching_set_logs` (one log per programme day; sets keep the exercise's name so rewriting a programme keeps history), `akb_coaching_check_ins` (one a UK week, three 1 to 5 scores, wins, struggles, an optional http(s) link, the coach's reply) and `akb_coaching_messages`. RLS on, no policies, anon/authenticated revoked. *Reads:* `akb_coaching_status` (small: Home card, menu, Plan) and `akb_coaching_overview` / `_sub` (everything, for the area and the coach). *Member writes* (server-side checks of ownership in SQL, never ids from the browser): `akb_coaching_log_session` (the form's sets are matched to the programme's own items; extra or foreign sets are dropped), `_submit_check_in`, `_send_message` (30 an hour), `_mark_read`. *Coach writes* (service key, from the coach portal): `_save_programme`, `_reply_check_in`, `_coach_message`. *Code:* `lib/coaching.ts` (types, calls, pure reading helpers), `lib/coaching-form.ts` (parse the session form from the programme, not the browser), `lib/coach/programme-text.ts` (the coach's one-line-per-exercise text, with line errors and repeat-the-week-before), `components/members/CoachingShell.tsx` (dark frame via `.coaching-dark`, which swaps ink and paper so the four-colour palette test still holds), `CoachingCards.tsx` (Home / drawer card, Plan section), `WorkoutForm.tsx` (a plain `<form>` with a script only for the sets-ticked count; works without JavaScript), routes `/account/coaching[/programme|/check-in|/messages|/unlock]` (all in `MEMBERS_APP_PATHS`, noindex, session-checked; non-clients are redirected to unlock and clients away from it). Videos are links only. Tests: `coaching.test.ts`, `programme-text.test.ts`, `tests/e2e/account.spec.ts`.

**Coach portal frame and tabs** (owner's coach design, `design-reference/coach.html`, 2026-10-28). `app/coach/(portal)/layout.tsx` now renders `CoachShell` (`components/coach/`): the members area's drawer and avatar menu (`MembersDrawer`, `AccountMenu`, `AccountMenuContent`'s siblings reused) and `CoachTabs` (client, `usePathname`, so a tab owns its detail pages). `isMembersApp()` also covers `/coach` and everything under it except `/coach/login`, so the public header and footer are left out. The layout reads the session (`portalContext`) only to show who is signed in and `loadShell` (the inbox count, the next class, online clients waiting); it authorises nothing for the pages, each of which still calls `portalContext`. `lib/coach/overview.ts` is the one place the four tabs get their data, from the loaders the portal already had (`listClassSessions`, `listAttendance`, `listPtSessions`, `listCharges`, `listRequests`, `currentPeriods`, `periodsOn`, `listSubscriptions`) plus `akb_coaching_inbox()` for coaching check-ins and messages: `loadInbox`, `loadToday`, `loadSchedule`, `loadMemberRows`, `loadOnlineRows`, `loadShell`, and the pure, unit-tested rules (`memberFlags`: low credits = 2 or fewer; expiring = some left and the period ends within 7 days, credits not rolling over; away = attended in the last 8 weeks but not the last 14 days; `stillToCome`; `messageClassLink`: a `mailto:` with the booked people in Bcc, since nothing can email from the site yet). Pages: `/coach` (Today; the old dashboard is its Business section), `/coach/schedule?week=`, `/coach/members?q=&f=`, `/coach/inbox?f=`. Today's check-in is the server action `markPlace` (`today-actions.ts`), which calls the existing `akb_set_attendance` (same credit rules as the class page); a second press puts the place back to booked. Class, client, request, membership, online and finance pages are unchanged and open from rows and from the drawer's All sections. Tests: `src/lib/coach/overview.test.ts` (real migrations on PGlite), `tests/e2e/portal.spec.ts`.


## Confirmation pages and emails, by event (audit 2026-11-02)

Rule: a page or email says "paid", "booked" or "confirmed" only once the database says so, and the database changes only from Stripe's signed webhook (re-read from Stripe), the reconcile job, or Alex in the coach area. Arriving at a return page proves nothing. Emails go through `sendNotice` (`lib/notices.ts`: customer + Alex, idempotency keys, best effort, logs a label and status code only) or the older per-flow senders. Customers' replies go to `BOOKING_NOTIFY_EMAIL`; Alex's copies reply to the customer.

| Event | What the person sees | Emails |
|---|---|---|
| Group class booked and paid (`/book` → Stripe) | `/book/done`: waiting → "You're booked" / "needs attention" / "no longer held" / cancelled / not found | Booker "You're booked" (with private cancel link) + Alex, once (`notifyClassBookings`, from the webhook or reconcile) |
| Class booked with a membership credit (`/account/book`) | Toast "Booked. One credit used." | Member "You're booked" + Alex (`bookClass`) |
| Class booked with a class credit | Toast "Booked with your class credit" | Same as paid booking (`notifyClassBookings`) |
| Member cancels a place (`/account`) | Toast (credit back / late / class credit / nothing back) | Member "Cancelled: …" + Alex (`cancelClass`) |
| Booker cancels by private link (`/book/manage`) | "Your place is cancelled" (+ credit link if given) | Booker (credit email "Your class credit", or "Cancelled: …" if no credit) + Alex (`cancelByToken`) |
| Coach cancels a whole class | Coach toast with the count emailed | Each booked person "Class cancelled: …" (Alex's wording, with his reason; says to message Alex if they paid) |
| One-to-one / online coaching request sent | "Request sent" | Alex's alert (existing) + the person "We've received your request" (says it is not confirmed yet) (`deliverRequest`) |
| Coach confirms a request | Coach page shows "Told …" | Person gets Alex's own "Let them know" wording ("You're booked in: …"); request marked told |
| Coach declines / cancels a confirmed request | Coach page shows "Told …" | Person gets the decline wording (incl. Alex's note) or a cancellation note; marked told |
| Membership joined and paid (`/memberships/join`) | `/memberships/join/done` states | Welcome email + Alex, once (`notifyNewMembers`) |
| Membership renewal coming (card members) | Plan page shows the card ("Visa ending 4242") | Member "Your RAENG membership renews on …" 5 days before, once per renewal date (`sendRenewalReminders`, `akb_stripe_customers.reminded_for`) |
| Membership renewed (saved card or Direct Debit) | Plan page | Member "Your RAENG membership has renewed" + Alex "Membership renewed: …", once (`notifyRenewalPayments`, `akb_dd_collections.paid_notified_at`) |
| Direct Debit set up | `/memberships/join/done?…&dd=returned` or `/account/direct-debit?returned=1`: confirming screen (asks again every 3 s, gives up after 45 s) → "Direct Debit set up." | Member "Your RAENG Direct Debit is set up" + Alex, once per set-up (`notifyDirectDebitSetUp`, `lib/stripe/dd-notice.ts`) |
| Renewal payment failed / membership paused | Plan page (change card) | Member "Your RAENG membership payment didn't go through" (says when the next try is, and to change the card) or "…is paused"; Alex when paused (`notifyDirectDebitFailures`) |
| Renewal by pay link (members with no saved card) | Account page | "Your RAENG … membership has renewed" with the Stripe link, which also saves the card |
| Member cancels membership (`/account/plan`) | Toast | Member "Your RAENG membership is cancelled" + Alex |
| Coach pauses, resumes or cancels a membership | Coach toast | Member "Your RAENG membership is paused" / "…is back on" / "…is cancelled" (`membershipStatusAction`; says what happens to credits already given, promises no refund) |
| Coach records a payment (cash or bank transfer) | Coach page "Payment recorded" | Client "We've received your payment: £X" (`recordPaymentAction`; once per recorded payment; none if the client has no email) |
| Card link made in the coach portal, paid | `/pay/done?link=…`: waiting → "Payment received" / closed / not found | Customer "We've received your payment" + Alex, once per payment (`notifyChargePayments`, marked by a `receipt_sent` event) |
| Class reminders | n/a | Morning-of reminder (cron) |
| Member sign-in link | Sign-in page states | The link, one-time |

Known gaps (owner decisions, not built): a refund made in the Stripe Dashboard emails nobody (Stripe's own refund email depends on its customer-email settings); Alex cancelling a whole class says "please message Alex" to anyone who paid, because the refund policy isn't recorded; Stripe's own receipts to customers and its payment notifications to Alex are switched on in the Stripe Dashboard (Settings → Customer emails; Settings → Personal details → Email notifications), not by this code.


### Renewals by saved card (owner, 2026-11-02; migration `20261106000000_akb_card_renewals.sql`)

Like Spotify: the membership's first 4 weeks are paid on Stripe's page, which keeps the card (`setup_future_usage=off_session`, with the agreement shown beside the pay button: amount, every 4 weeks, until you cancel, cancel any time). The verified payment (webhook or reconcile) saves the card on the member's Stripe customer (`akb_card_set_method`; label like "Visa ending 4242", brand and last 4 only). It reuses the Direct Debit machinery (`akb_stripe_customers` now has `method` card|bacs; `akb_dd_collections`, `akb_dd_due`, `akb_dd_record_attempt`, `akb_dd_mark`, `lib/stripe/direct-debit.ts`):
- **Timing:** a card is charged on the day its period starts (daily cron, 06:11 UTC); a Direct Debit is still submitted 6 days ahead. A card answers at once, so the collection is synced immediately (the webhook can arrive before the attempt was noted); the webhook and the daily reconcile (`pi_…` links) record it idempotently.
- **Failure:** retried 3 days after the first try and 4 days after the second (day 3, day 7), then the membership pauses (Alex restarts it; a paid-link payment does not resume it automatically). A declined or "needs the bank" card is a failed try; a Stripe outage (5xx) is not.
- **Changing or adding a card:** `/account/plan` → Change card / Save a card opens Stripe's setup page (card mode, same agreement). A new card makes a failed (not paused) charge retry at the next daily run. Members from before this (no saved card) keep getting an emailed pay link, and paying it saves their card.
- **Cancel:** unchanged: no more periods or charges; credits stay until the period ends.
- **Direct Debit** is only offered when `DIRECT_DEBIT_ENABLED=true` (set on Production 2026-11-02, after Stripe approved Bacs). When on it is the **first option** on the join confirmation and the plan page, with the saved card as the fallback until it is set up; setting it up replaces the card as the member's method (the card isn't detached at Stripe). A card saved from a payment never replaces an active Direct Debit. Stripe's payment page carries "unless you set up a Direct Debit instead" in the card agreement when it is on.
- **Cancelling ends the Direct Debit** (owner, 2026-11-03, as gyms do): once a member has no active or paused membership and no collection still going through Bacs, the Bacs payment method is detached at Stripe (`detachPaymentMethod`), which cancels the mandate (Stripe tells the bank and emails the member), and `akb_stripe_customers.dd_status` becomes `ended` (event `direct_debit_ended`). Runs straight after the member cancels from their account or Alex cancels in the coach area (`endUnusedDirectDebit`), and in the daily renewals job for anything missed or still collecting then (`endUnusedDirectDebits`; reported as `directDebitsEnded`). A saved card is kept (it takes nothing without an active membership).
- **One reminder to switch to Direct Debit** (owner, 2026-11-03): the daily job emails a member who joined online by card 2 or more days ago (and less than 2 weeks), is still active and isn't on Direct Debit, once (event `direct_debit_reminder_sent`), linking to their join confirmation, whose button opens Stripe's page. Only while `DIRECT_DEBIT_ENABLED=true`. The welcome email links there too (the plan page has no payment options).
- Tests: `src/lib/stripe/card-renewals.test.ts` (database + Stripe stand-in), `tests/e2e/join-pay.spec.ts`.

## Waitlist, class sizes per slot and coach panel (2026-11-04)
- `akb_class_waitlist` (RLS on, no policies, service-role functions only): join only when full, offers = free places in order, 24-hour offers, max 30 waiting; refreshed by `afterPlacesChange` (cancellations, removals, size changes) and the daily crons, which email offers (`src/lib/waitlist.ts`). `/book/waitlist` is a private route (robots-disallowed).
- Class size order: date's own > slot (`akb_settings` key `class_capacity:<slot>`) > all-classes size; `classForSlot` maps calendar slots to classes.
- `akb_adjust_period_credits` backs the coach credit adjuster; coach notes use the attendance notes field. UI: `components/coach/DetailsPanel.tsx`, `CreditStepper.tsx`.

# DEPLOYMENT — Alex K Bells

How the site gets from GitHub to a preview URL, then to launch.
Nothing here has been deployed to production. Last reviewed: 2026-10-15.

## Current state (inspected read-only via the Vercel API, 2026-10-15)

| Item | State |
|---|---|
| Vercel project | `alexkbells` in the **developer's personal Hobby account** (`fystay1`) — not Alex's |
| Git connection | `fystay/alexkbells`, branch `phase-1-public-website`; every push creates a **preview** deployment |
| Framework preset | Was "Other", so every deployment served **404 for all pages** (only files in `public/` worked). Fixed in the repo by `vercel.json` → `"framework": "nextjs"`; confirm on the next preview |
| Production | No live production deployment (the first one failed). `alexkbells.vercel.app` is reserved for the project |
| Environment variables | None set |
| Deployment Protection | Vercel Authentication on all deployments except custom domains — reviewers must be logged in to the Vercel team, or be sent a share link |
| Node.js | Project setting 24.x; the repo is tested on Node 22 (`engines: >=22`). Either works; setting 22.x matches the tested version |

## Account ownership (decision for Alex)

Alex should own the accounts that keep the business online, and add the
developer as a member:

1. **Vercel**: create the project in an account or team Alex owns and pays
   for. Vercel describes the Hobby plan as for personal, non-commercial use;
   check the current terms at vercel.com/pricing before launch — a business
   site is likely to need Pro.
2. **GitHub**: transfer `fystay/alexkbells` to Alex (or an organisation he
   owns), or keep it with the developer under a written agreement.
3. **Domain**: register in Alex's name, with renewal on his card.

Moving Vercel projects between accounts is easiest by importing the GitHub
repo into Alex's account and deleting the old project after launch.

## Environment variables

All are read on the server only; none reach the browser (an e2e test checks
the JavaScript bundles and the /book HTML). Changing any of them needs a
redeploy: pages, including `/book`, are prerendered at build time.

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `SITE_URL` | `https://<chosen domain>` once decided | — | Canonical URLs, sitemap, social previews. Invalid values are ignored. Until set, falls back to the project's production URL (`alexkbells.vercel.app`) |
| `CONTENT_PREVIEW` | **do not set** | `true` | Shows provisional prices/times with an orange review frame. Ignored on production even if set by mistake |
| `BOOKING_URL` | Alex's external booking page (https), only if he chooses a hosted provider | optional, to test | Set → "Book" buttons open it in a new tab; takes priority over everything else |
| `BOOKING_DEMO` | **do not set** (ignored anyway) | `true` to demo the booking calendar to Alex | Shows labelled sample availability on `/book`; nothing is booked or sent. Ignored when `VERCEL_ENV=production` |
| `RESEND_API_KEY` | Optional since requests are stored in Supabase: API key from Alex's own Resend account, "sending access" only | a separate test key, optional | Mark as Sensitive in Vercel. With the two settings below, also emails each request to Alex |
| `BOOKING_NOTIFY_EMAIL` | Alex's inbox for booking requests | a test inbox | Requests arrive here with Reply-To set to the visitor |
| `BOOKING_FROM_EMAIL` | e.g. `Alex K Bells <bookings@<verified domain>>` | same | Must be on a domain verified in Resend (needs the domain decision; DNS records with Alex's approval) |
| `CRON_SECRET` | random string, 32+ characters (e.g. `openssl rand -hex 32`) — needed with the Resend settings | same, optional | Sensitive. Vercel Cron sends it as `Authorization: Bearer …` to `/api/cron/request-alerts`, which resends failed alerts to Alex. Without it (or under 16 characters) the endpoint refuses every call |
| `SUPABASE_URL` | `https://sqkpixwvugrxllrxlexs.supabase.co` — **set** | same — **set** | Project `Alexkbells` in the developer's Supabase organisation. Turns on booking requests (stored) and the coach login |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_...`) from the Supabase dashboard — **set 2026-10-17** | same — **set** | Sensitive. Bypasses RLS, so server code only. `SUPABASE_URL` also set for both, 2026-10-17 |
| `COACH_EMAIL` | **set 2026-10-18** to the developer's account (Supabase user created the same day); change to Alex's email at handover (comma-separate to allow more than one) | same — **set** | Turns on `/coach/login` with the two Supabase settings. Only these addresses can sign in |

"Book now" opens `/book` whenever booking works: on production that is the
case as soon as `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set (they are, since
2026-10-17), and Vercel **Preview** always opens it. With no booking route at all
it falls back to /contact, `/book` shows the Instagram prompt and production builds
log a warning. **On Preview, `BOOKING_DEMO=true` takes priority** and shows the
labelled sample calendar; delete it from Preview to try the real flow there (requests
from previews then land in the same table as production ones).

### Booking requests: what to know (live on production from 2026-10-18)

- `/book` takes **requests**, not confirmed bookings. Group classes: a real
  date from the confirmed timetable (next four weeks); one-to-one: preferred
  days and times. Capacity is unknown, so Alex confirms each place.
- Each request is **stored in Supabase** (`akb_booking_requests`, EU West) and
  listed in the coach area (`/coach`, after the coach login). If the Resend
  settings are also set, it is emailed to Alex too. Success is shown only when
  at least one of those accepted it; otherwise the visitor sees an error and is
  pointed to Instagram. `/online-coaching` enquiries work the same way.
- Without `COACH_EMAIL` and Alex's Supabase login (see Coach login below),
  requests are stored but **nobody can see them on the site**: set those up
  before relying on it.
- Personal data is stored in Supabase and passes through Vercel (and Resend
  if set), as described on `/privacy`. **Alex must review the privacy notice**
  (who's responsible, retention) and decide how long requests are kept.
- Spam protection: hidden honeypot field plus a minimum fill time (3 s).
  Duplicate submissions share an idempotency key, so a double-click sends
  one email and stores one row. No CAPTCHA (keeps the CSP first-party); add one if spam appears.
- To test email delivery too, set the three Resend variables (a test inbox for
  Preview), redeploy and send a request.



### Coach login: setup

1. In Supabase (project `Alexkbells`) → Authentication → Users → **Add user**: Alex's email and a strong password (tick "Auto confirm"). Let Alex change it, or send him a password reset.
2. Authentication → Sign In / Providers: turn **off** "Allow new users to sign up". (The site already ignores any address not in `COACH_EMAIL`; this stops strangers creating accounts at all.)
3. Set `COACH_EMAIL` in Vercel for Production and Preview, then redeploy.

`VERCEL_ENV` and `VERCEL_PROJECT_PRODUCTION_URL` are set by Vercel
automatically.

### Coach portal: setup (2026-10-19)

The portal uses the same settings as the coach login (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `COACH_EMAIL`); no new environment variables. It needs one database migration:

1. **Back up first** (Supabase → Database → Backups, or `pg_dump`). The project also holds another app's tables; the migration touches only `akb_*` objects. On 2026-10-19 `akb_booking_requests` was the only `akb_` table and held no rows.
2. Apply `supabase/migrations/20261019000000_akb_coach_portal.sql`, either with the CLI (`npx supabase link --project-ref sqkpixwvugrxllrxlexs` then `npx supabase db push`) or by pasting it into the SQL editor. It is safe to run again. It ends with `notify pgrst, 'reload schema'` so the API sees the new tables at once.
3. Check: Supabase → Advisors (security) shows no new warnings for `akb_*`; `/coach` shows the dashboard instead of "tables aren't set up yet".
4. Turn off public sign-ups (Authentication → Sign In / Providers) if not done: only `COACH_EMAIL` accounts get in either way, but this stops strangers creating accounts. **Verified off 2026-10-20** (`/auth/v1/settings` reports `disable_signup: true`; one Auth user, confirmed). Leaked-password protection was still **off** (Advisors). Note the project's Auth is shared with the other app whose tables live here.

**Applied 2026-10-18 (UK), with the owner's approval**, to project `Alexkbells` (`sqkpixwvugrxllrxlexs`, eu-west-1), which production and previews both use. Done through the Supabase MCP `execute_sql` tool in small transactions (its `apply_migration` call, and any statement containing `DROP` or `DELETE`, timed out waiting for a confirmation step), each ending with the migration's access lock-down. Verified afterwards: all 15 `akb_*` tables have RLS on and no policies; `anon`/`authenticated` can't read any table or view or execute any function; `service_role` can; the API answers "permission denied" (not "not found") for the new tables with the publishable key; a service-role smoke test (part payment, overpayment refused, class place) passed and was rolled back. The 2 existing requests were kept, and the one with a class date was backfilled.

**Still to run by hand**: the three functions whose bodies contain `DELETE` (`akb_void_charge`, `akb_record_refund`, `akb_set_payment_status`). Re-checked 2026-10-20: still missing (`pg_proc` has none of them). They are now in their own file, `supabase/migrations/20261020000000_akb_payment_functions.sql`: one transaction that only (re)creates those three functions, revokes them from `public`/`anon`/`authenticated`, grants `service_role`, and reloads the API schema. It reads and writes no rows, so it is safe to run on live data and to run again (a unit test applies it twice to a database in the live state). Paste it into the SQL Editor, or approve the MCP confirmation step. Until then: cancelling a charge, refunds, marking a payment failed/void, and cancelling a class place or session that has an unpaid charge show "tables aren't set up yet"; everything else works. The entry in `supabase_migrations.schema_migrations` for `20261019000000` is also still missing (cosmetic: only matters for `supabase db push`).

### Email alerts to Alex (2026-10-20, not yet live)

Each new booking request (group class or one-to-one) and online coaching enquiry is stored and, when the Resend settings are set, emailed to `BOOKING_NOTIFY_EMAIL`. The two are independent (ARCHITECTURE.md → Key decisions 5). To turn alerts on:

1. Apply `supabase/migrations/20261020000100_akb_request_alerts.sql` (adds nullable `alert_*` columns to `akb_booking_requests` only; safe to run again). The site works before it is applied: requests are still stored, and only the alert outcome isn't recorded (a log line says so).
2. A Resend account owned by Alex, with a verified sending domain (DNS records on his domain). Without a domain, Resend's test sender `onboarding@resend.dev` only delivers to the Resend account's own address.
3. In Vercel → Production: `RESEND_API_KEY` (Sensitive, sending access only), `BOOKING_NOTIFY_EMAIL`, `BOOKING_FROM_EMAIL`, `CRON_SECRET`; redeploy.
4. Check: send a test request; the coach area's request page shows "Email alert: Sent …"; Vercel → Settings → Cron Jobs lists `/api/cron/request-alerts`.

**Acknowledgement to the visitor (2026-11-09).** With the same Resend settings, `/book` also sends the visitor an automatic "we've received your request" email (`clientAcknowledgementEmail`). It states the request is not a confirmed booking, and for group classes adds the "arrive 10 minutes early" note as applying once Alex confirms. It is best-effort and one-shot (same retry as above, no cron retry): a failure is logged without personal data and never changes what the visitor sees. Reply-To is `BOOKING_NOTIFY_EMAIL`, so a reply reaches Alex. Not sent when Resend isn't configured. Sending goes to whatever address the form accepts, so the existing honeypot and minimum-fill-time checks are the only abuse limit; add rate limiting before launch if spam appears.

Retries: a transient failure (no answer, 429, 5xx) is retried once straight away; anything still failed is retried by the daily cron (07:17 UTC; Hobby plans allow daily jobs only) while it is under 23 hours old, the window in which Resend still recognises the idempotency key, so a retry can't deliver a second copy. On a Pro plan an hourly schedule (`17 * * * *` in `vercel.json`) catches every failure inside that window. A failure older than that stays "Not sent yet" on the request page; the request itself is always in the inbox.

Data kept: client details, bookings, payments and notes, all in Supabase (EU West). Alex should add retention to the privacy notice (e.g. delete former clients' records after N years; financial records are usually kept six years in the UK). A former client with no bookings or payments can be deleted from their record; anyone with history is kept (set them to Former).

### Square card payments (2026-10-21, not live; needs the owner)

Built and tested against a Square stand-in only. **Not verified against Square Sandbox yet**: no Sandbox credentials exist in this project. Nothing here is active until the settings below are added.

| Variable | Where | Notes |
|---|---|---|
| `SQUARE_ENVIRONMENT` | `sandbox` only in the local test environment (`.env.local`); `production` on Vercel Production only | Any other value, or a mismatch with the deployment, keeps Square off |
| `SQUARE_ACCESS_TOKEN` | Sensitive. Sandbox token for testing; the live token only in Production | Square Developer Console → the app → Credentials. Server only |
| `SQUARE_LOCATION_ID` | Alex's location (Sandbox has its own test location) | Square Dashboard → Locations, or Developer Console |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Sensitive, per subscription | Developer Console → Webhooks → the subscription |
| `SQUARE_WEBHOOK_URL` | Exactly the subscription's notification URL, e.g. `https://alexkbells.vercel.app/api/square/webhook` | Part of what Square signs; must match character for character |
| `CRON_SECRET` | Already needed for alerts | Also authorises `/api/cron/square-reconcile` |

Owner steps (Square account holder):
1. Square Developer Console: create (or open) the application; confirm **Online Checkout / payment links** are available on Alex's account and the current UK card fee.
2. Sandbox first: note the Sandbox access token and Sandbox location id; add a Sandbox webhook subscription for `payment.created`, `payment.updated`, `refund.created`, `refund.updated` pointing at the local tunnel URL (next section).
3. **Use the local test environment** (next section), never the live project. Sandbox mode refuses to start against the live project, and the live database refuses Sandbox records (see the safeguard below).
4. On the **test** database only: apply all five migrations in order, then mark it: `insert into public.akb_database_role (role) values ('test');`. (Production later gets the same migrations and **no** marker.)
5. Sandbox test plan (no real money): create a card link for a test charge; pay it with Square's documented Sandbox test card; check the charge shows paid and the payment says "Card (Square test)"; send the same webhook again from the Console (no second payment); refund in the Sandbox Dashboard (refund appears once, charge owed again); a declined test card (nothing recorded, link still open); a forged call to the webhook URL (403).
6. Only after that passes: live token, live location, live webhook subscription to the production URL, `SQUARE_ENVIRONMENT=production` in Production, redeploy.

### Square Sandbox test environment: local Supabase + HTTPS tunnel (decided 2026-10-21)

The owner's constraint: use the existing `Alexkbells` project in the FYStay account, no new Supabase account or project, no extra cost, live database untouched. Checked on the live project (read-only):

- **No isolated database is available inside it on the Free plan.** Branching needs Pro ($25/month plus about $0.01344/hour per branch). The project has one Postgres database (`postgres`).
- **A separate schema is not isolation.** It would share the instance, the one secret key (`service_role` bypasses RLS in every schema), Auth users, backups and restores, project-wide event triggers (e.g. `ensure_rls`), API settings and the 500 MB Free disk with the live data. Our migrations also name `public.` throughout. A mistake would reach live records.
- A second database on the same instance isn't reachable through the API (PostgREST/Auth serve `postgres` only), and shares everything else.

**Setup: Supabase running locally (Docker), the site running locally in Sandbox mode, and an HTTPS tunnel that forwards only Square's webhook.** $0, nothing in the hosted project changes. Verified in a cloud container on 2026-10-21 with Supabase CLI 2.121.0: all five migrations apply in order; with no marker, Sandbox records are refused through the real API; the server key can't set the marker; the publishable key can't read portal tables or run the payment functions; after marking `test`, Sandbox records are accepted and live ones refused; the site's webhook rejects a forged signature (403), records a signed event, calls Square's Sandbox API (401 with a placeholder token, so 500 for redelivery) and logs no secrets; the gateway passes only the webhook through. **A real Sandbox payment has not been made**: that needs the owner's Sandbox credentials.

Steps (on the developer's machine; nothing here touches production):
1. Install Docker and Node 24. Bind published ports to localhost so the local database (password `postgres`) isn't reachable from the network: Docker → daemon settings `{"ip": "127.0.0.1"}` (Docker Desktop: Settings → Docker Engine), restart Docker.
2. In a copy of the repo: `npx supabase@2.121.0 init` (creates `supabase/config.toml`, not committed), then `npx supabase@2.121.0 start -x studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta`. It applies `supabase/migrations/` and prints the local API URL and keys (fixed development keys, not secrets).
3. Mark it as a test database: `docker exec -i supabase_db_<folder> psql -U postgres -c "insert into public.akb_database_role (role) values ('test');"`.
4. Create a coach login: Supabase local Auth (`http://localhost:54321`, e.g. the CLI's Studio or the Auth admin API) with an email you then put in `COACH_EMAIL`.
5. Start a tunnel to the gateway port and note its HTTPS URL, e.g. Cloudflare quick tunnel `cloudflared tunnel --url http://127.0.0.1:3401` (free, no account; the `trycloudflare.com` URL changes each run) or an ngrok free static domain (free account). Your webhook URL is `<tunnel URL>/api/square/webhook`.
6. `.env.local` (ignored by Git; never commit): `SUPABASE_URL=http://localhost:54321`, `SUPABASE_SECRET_KEY=<local secret key>`, `COACH_EMAIL=<step 4>`, `CRON_SECRET=<32+ random chars>`, `SQUARE_ENVIRONMENT=sandbox`, `SQUARE_ACCESS_TOKEN=<Sandbox token>`, `SQUARE_LOCATION_ID=<Sandbox location>`, `SQUARE_WEBHOOK_SIGNATURE_KEY=<from the subscription>`, `SQUARE_WEBHOOK_URL=<step 5 URL, exactly>`. Do not set `VERCEL_ENV` or `SQUARE_API_URL`.
7. `npm run build && npx next start -p 3400`, and in another terminal `node scripts/square-webhook-gateway.mjs` (127.0.0.1:3401 → 3400; only `POST /api/square/webhook`, raw body and signature unchanged, 64 KB limit; everything else 404, so the coach area and cron endpoints aren't exposed).
8. Square Developer Console → Sandbox → Webhooks: subscription to the step 5 URL for `payment.created`, `payment.updated`, `refund.created`, `refund.updated`; copy its signature key into step 6. If the tunnel URL changes, update both the subscription and `SQUARE_WEBHOOK_URL`, then restart the site.
9. Run the Sandbox test plan (above) at `http://localhost:3400/coach`. Stop afterwards: `npx supabase stop --no-backup`, stop the tunnel, delete `.env.local`.

**Safeguards against test money in the live ledger** (`20261021000000_akb_square.sql`, `lib/square/config.ts`):
- Database: `akb_database_role` marker. No row = production. Triggers on `akb_square_payment_links`, `akb_square_events` and `akb_payments` refuse Sandbox records unless the database is marked `test`, and refuse live Square records in a `test` database, whichever route writes them (app, RPC or SQL Editor). The app's server role can read the marker but not set it; anon/authenticated can't see it.
- App: `SQUARE_ENVIRONMENT=sandbox` is ignored on Vercel production and whenever `SUPABASE_URL` is the live project (`PRODUCTION_SUPABASE_REF`), so the webhook returns 404 and no link can be created. Sandbox variables are never added to Vercel.
- Never run the marker statement on the live project. If the live database ever moves (handover), update `PRODUCTION_SUPABASE_REF`; the database guard still holds regardless.

## Safety built into the code

- Provisional content needs `CONTENT_PREVIEW=true` **and** a non-production
  deployment (`src/lib/publish.ts`); unit-tested.
- Non-production deployments send `robots.txt` Disallow and a `noindex` meta
  tag (`src/lib/env.ts` `isIndexable`).
- Security headers incl. a first-party CSP (`src/lib/security-headers.ts`);
  previews additionally allow the Vercel Toolbar.

## Get a preview URL now

1. Push this branch (done as part of this change). Vercel builds it as a
   preview automatically.
2. In Vercel → project → Deployments, open the newest deployment and check it
   shows the homepage (not a 404).
3. Optional, for Alex's review of provisional content: Settings → Environment
   Variables → add `CONTENT_PREVIEW` = `true` for **Preview** only, then
   redeploy.
4. To let Alex view it without a Vercel login, use the deployment's **Share**
   button (shareable link), or relax Deployment Protection for previews.

## Launch checklist

1. Alex decides account ownership (above) and the domain.
2. Alex confirms or withholds: timetable, prices, booking provider (see
   CONTENT.md → Questions for Alex). Confirmed items get `status: "confirmed"`.
3. Alex confirms permission for people shown in the hero video.
4. In the owning Vercel project: set the production branch (e.g. `main`),
   add `SITE_URL` for Production, leave `CONTENT_PREVIEW` unset for Production,
   and add the booking form settings (`RESEND_API_KEY`, `BOOKING_NOTIFY_EMAIL`,
   `BOOKING_FROM_EMAIL`) or `BOOKING_URL`. Send a test request and check it arrives.
5. Merge to the production branch → production deployment. Check `/`,
   `/classes`, `/coaching`, `/contact`, `/book`, `/privacy`, `/robots.txt` (should allow), and that
   no prices or times appear unless confirmed.
6. Add the custom domain in Vercel and update DNS at the registrar
   (**only with Alex's approval**). Vercel issues HTTPS automatically.
7. After DNS resolves: share a page on WhatsApp/Facebook to check the preview
   image, and submit the sitemap in Google Search Console (Alex's account).

# DEPLOYMENT — RAENG

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
| `CRON_SECRET` | random string, 32+ characters (e.g. `openssl rand -hex 32`) — needed with the Resend settings and for membership renewals | same, optional | Sensitive. Vercel Cron sends it as `Authorization: Bearer …` to `/api/cron/request-alerts` (resends failed alerts to Alex), `/api/cron/membership-renewals` and `/api/cron/stripe-reconcile`. Without it (or under 16 characters) the endpoint refuses every call |
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

1. **Back up first** (Supabase → Database → Backups, or `pg_dump`). (The other app's tables that used to share this project were removed on 2026-11-02.) The migration touches only `akb_*` objects. On 2026-10-19 `akb_booking_requests` was the only `akb_` table and held no rows.
2. Apply `supabase/migrations/20261019000000_akb_coach_portal.sql`, either with the CLI (`npx supabase link --project-ref sqkpixwvugrxllrxlexs` then `npx supabase db push`) or by pasting it into the SQL editor. It is safe to run again. It ends with `notify pgrst, 'reload schema'` so the API sees the new tables at once.
3. Check: Supabase → Advisors (security) shows no new warnings for `akb_*`; `/coach` shows the dashboard instead of "tables aren't set up yet".
4. Turn off public sign-ups (Authentication → Sign In / Providers) if not done: only `COACH_EMAIL` accounts get in either way, but this stops strangers creating accounts. **Verified off 2026-10-20** (`/auth/v1/settings` reports `disable_signup: true`; one Auth user, confirmed). Leaked-password protection was still **off** (Advisors). Note the project's Auth is shared with the other app whose tables live here.

**Applied 2026-10-18 (UK), with the owner's approval**, to project `Alexkbells` (`sqkpixwvugrxllrxlexs`, eu-west-1), which production and previews both use. Done through the Supabase MCP `execute_sql` tool in small transactions (its `apply_migration` call, and any statement containing `DROP` or `DELETE`, timed out waiting for a confirmation step), each ending with the migration's access lock-down. Verified afterwards: all 15 `akb_*` tables have RLS on and no policies; `anon`/`authenticated` can't read any table or view or execute any function; `service_role` can; the API answers "permission denied" (not "not found") for the new tables with the publishable key; a service-role smoke test (part payment, overpayment refused, class place) passed and was rolled back. The 2 existing requests were kept, and the one with a class date was backfilled.

~~**Still to run by hand**~~ Applied 2026-10-28 (see below): the three functions whose bodies contain `DELETE` (`akb_void_charge`, `akb_record_refund`, `akb_set_payment_status`). They are now in their own file, `supabase/migrations/20261020000000_akb_payment_functions.sql`: one transaction that only (re)creates those three functions, revokes them from `public`/`anon`/`authenticated`, grants `service_role`, and reloads the API schema. It reads and writes no rows, so it is safe to run on live data and to run again (a unit test applies it twice to a database in the live state). Paste it into the SQL Editor, or approve the MCP confirmation step. Until then: cancelling a charge, refunds, marking a payment failed/void, and cancelling a class place or session that has an unpaid charge show "tables aren't set up yet"; everything else works. The entry in `supabase_migrations.schema_migrations` for `20261019000000` is also still missing (cosmetic: only matters for `supabase db push`).

**All migrations applied 2026-10-28** (owner pasted the combined script into the SQL Editor). Verified afterwards: every `akb_*` table has RLS on; `anon`/`authenticated` can read no `akb_*` table or view and run no `akb_*` function; no `akb_database_role` marker (live mode); existing rows unchanged (5 requests, 1 client, 1 charge, 1 membership); Advisors shows no warnings for `akb_*`. `supabase_migrations.schema_migrations` now records 20261019000000 → 20261030000000 under the repo's versions.

### Email alerts to Alex (2026-10-20, not yet live: needs Resend)

Each new booking request (group class or one-to-one) and online coaching enquiry is stored and, when the Resend settings are set, emailed to `BOOKING_NOTIFY_EMAIL`. The two are independent (ARCHITECTURE.md → Key decisions 5). To turn alerts on:

1. ~~Apply `supabase/migrations/20261020000100_akb_request_alerts.sql`~~ Applied to the live database 2026-10-23.
2. A Resend account owned by Alex, with a verified sending domain (DNS records on his domain). Without a domain, Resend's test sender `onboarding@resend.dev` only delivers to the Resend account's own address.
3. In Vercel → Production: `RESEND_API_KEY` (Sensitive, sending access only), `BOOKING_NOTIFY_EMAIL`, `BOOKING_FROM_EMAIL`, `CRON_SECRET`; redeploy.
4. Check: send a test request; the coach area's request page shows "Email alert: Sent …"; Vercel → Settings → Cron Jobs lists `/api/cron/request-alerts`.

Retries: a transient failure (no answer, 429, 5xx) is retried once straight away; anything still failed is retried by the daily cron (07:17 UTC; Hobby plans allow daily jobs only) while it is under 23 hours old, the window in which Resend still recognises the idempotency key, so a retry can't deliver a second copy. On a Pro plan an hourly schedule (`17 * * * *` in `vercel.json`) catches every failure inside that window. A failure older than that stays "Not sent yet" on the request page; the request itself is always in the inbox.

### Memberships (2026-10-23, live database)

`supabase/migrations/20261023000000_akb_memberships.sql` is applied (tables `akb_memberships`, `akb_membership_periods`, two columns on `akb_class_attendance`, functions service-role only; checked: `anon`/`authenticated` have no access). Plans, prices and credits come from `src/content/memberships.ts` only.

- `/api/cron/membership-renewals` runs daily (06:11 UTC, `CRON_SECRET` bearer) and creates each active membership's next period, credits and charge once (re-running creates nothing). Without `CRON_SECRET` no renewals happen; Alex can still start memberships, and the next run catches up.
- Billing is manual: each period's charge appears in Finances as owed; record the payment, or send a Stripe card link. (Since 2026-11-02 a member who pays online is charged automatically by their saved card: see the Stripe section.)
- Renewals also catch up whenever Alex opens the dashboard or Memberships (the database creates each period once), so a missing `CRON_SECRET` or a missed run only delays them.
- Cancelling a whole class (class page → Cancel this class): needs `supabase/migrations/20261024000000_akb_cancel_class.sql` (two columns, a trigger, one function, two view columns; no deletes; applied 2026-10-28). Places with an unpaid pay-as-you-go charge also need the payment functions above (`akb_void_charge`), or the cancellation stops with "not set up" and changes nothing.
- Capacity: set a class date's capacity in the portal; once full, the public calendar shows it unavailable (`/api/classes/full`, cached 30 s) and the server refuses requests for it.

Data kept: client details, bookings, payments and notes, all in Supabase (EU West). Alex should add retention to the privacy notice (e.g. delete former clients' records after N years; financial records are usually kept six years in the UK). A former client with no bookings or payments can be deleted from their record; anyone with history is kept (set them to Former).

### Member accounts (2026-10-26, built; database change applied 2026-10-28; needs Resend)

Members sign in at `/account/sign-in` with a one-time emailed link (owner's choices, docs/MEMBER_ACCOUNTS_DRAFT.md). Until the steps below are done, `/account/sign-in` says signing in isn't available and nothing else changes.

1. **Applied 2026-10-28: the cancel-class migration first** (`20261024000000_akb_cancel_class.sql`, above): the member functions read its `cancelled_at` column.
2. **Applied 2026-10-28: `supabase/migrations/20261027000000_akb_member_accounts.sql`** (with the owner's go-ahead): two tables (RLS on, no policies, `anon`/`authenticated` revoked) and functions for `service_role` only. It changes no existing table or row and is safe to run again; the undo SQL is in docs/MEMBER_ACCOUNTS_DRAFT.md. Check afterwards: Advisors shows no new warnings; `select has_table_privilege('authenticated','public.akb_member_sessions','select')` is false.
3. **Email must be on in production** (Email alerts above: `RESEND_API_KEY`, `BOOKING_FROM_EMAIL` on a verified domain, `BOOKING_NOTIFY_EMAIL`): sign-in links go out through the same Resend account, to the member's address, with replies going to `BOOKING_NOTIFY_EMAIL`.
4. Links point at `SITE_URL` (else the Vercel production URL) on production and at the preview's own address on previews; never at the request's Host header. Set `SITE_URL` once the domain is chosen.
5. Clean-up runs with the daily membership renewals (`akb_member_cleanup`: links after a day, ended sessions after 30 days).
6. To test end to end: in the coach area, start a membership for a client whose email you can read, request a link at `/account/sign-in`, press Sign in, book and cancel a class (the coach area shows the place and credit).

Alex can sign a member out of every device with `select akb_member_end_sessions('<client id>')` (no button in the coach area yet).

### Joining and paying online (2026-10-26, built; not live)

Owner's decision (2026-10-26): members join and pay for their membership with nothing for Alex to confirm. Until every step below is done, joining stays a request that Alex confirms (`onlineJoinEnabled()` in `lib/membership-checkout.ts` is false), so nothing changes on the live site.

1. ~~Apply, in order~~ **All applied 2026-10-28** (all additive): `20261020000000_akb_payment_functions.sql`, `20261021000000_akb_square.sql` (payment tables; their names predate Stripe), `20261024000000_akb_cancel_class.sql`, `20261027000000_akb_member_accounts.sql`, then **`20261028000000_akb_self_serve_memberships.sql`** (one table, two columns with defaults that keep current behaviour, two triggers, four functions; safe to run again). Check afterwards: Advisors shows no new warnings; `select has_table_privilege('authenticated','public.akb_membership_signups','select')` is false. Tests: `supabase/tests/20261028000000_akb_self_serve_memberships.test.sql` (29 checks; real Postgres 16).
2. **Stripe live** (section below; done 2026-11-02): the live key, the webhook endpoint and `SITE_URL` on Production. The webhook is what starts a membership, so it must be subscribed to `checkout.session.completed`, `payment_intent.succeeded` and `payment_intent.payment_failed` and point at the production URL.
3. **Email on** (Resend settings above): Alex is emailed when someone joins and pays ("nothing to confirm"), the member gets a welcome, and each renewal emails the member a Stripe pay link.
4. **`CRON_SECRET`** (already needed): the daily renewal sends the pay links; the daily Stripe reconcile catches missed webhooks and sends any welcome emails they would have triggered.
5. `SITE_URL` set to the real domain: Stripe sends payers back to `<SITE_URL>/memberships/join/done`.
6. Then `20261029000000_akb_instant_class_booking.sql` for booking single classes online, and `20261030000000_akb_customer_accounts.sql` for accounts for everyone who has paid (next sections).

How it behaves: the join page's last step says "Pay £<price>" and opens Stripe's page; the price comes from `content/memberships.ts` on the server. The membership starts the moment the payment is recorded (Stripe's verified webhook, the reconcile, or Alex recording a payment in the portal against that charge), on that same charge, and the first class (if chosen) is booked with a credit then. A member who leaves Stripe's page without paying has nothing started; joining again replaces the unpaid sign-up. If the membership can't start (e.g. Alex already started one for them), the payment stays recorded and the sign-up is marked `needs_attention`, and Alex is emailed. Renewals: every four weeks a new period and charge, a pay link emailed once, and that period's credits can't be used until it's paid (memberships Alex starts by hand are unchanged). Refunds and cancelling a membership stay with Alex.

### Booking a group class and paying online (2026-10-27, built; not live)

Owner's decisions (2026-10-27): group classes are booked and paid instantly (1:1 stays a request Alex confirms); the place is held for 15 minutes while paying; cancelling 24 hours or more before gives a credit for another class within 4 weeks, later or a no-show gets nothing back. It switches on with online joining (same `onlineJoinEnabled()`), so the steps above apply, plus:

1. Applied 2026-10-28: **`20261029000000_akb_instant_class_booking.sql`** after `20261028…` (one column with no default on `akb_class_attendance`, two tables, capacity now ignores holds that ran out, `akb_class_overview` recreated with the same columns, one trigger, five functions; safe to run again). Check: `select has_table_privilege('authenticated','public.akb_class_bookings','select')` is false. Tests: `supabase/tests/20261029000000_akb_instant_class_booking.test.sql` (real Postgres 16).
2. Stripe's webhook confirms the place, so it must be live as above. Payers come back to `<SITE_URL>/book/done`; the emailed private link is `<SITE_URL>/book/manage?token=…`, the credit link `<SITE_URL>/book/group-class?credit=…`.

How it behaves: the last step says "Pay £12" (price from `content/services.ts` on the server) and opens Stripe's page; the place counts towards the class's capacity for 15 minutes. Paid in time → confirmed, Alex is emailed ("nothing to confirm") and the booker gets the private link. A payment that arrives after the hold ran out confirms the place if there's still room; otherwise the payment is recorded, the booking is marked `needs_attention` and Alex is emailed to sort it out (refunds stay with Alex). A charge still unpaid a day after its hold is cancelled by the daily renewal job (`akb_release_class_holds`). Booking with a membership plan chosen on the plan list stays a request.

### Refunds when a paid class is cancelled in time (2026-11-05, live)

Alex's rule (2026-11-05): 24 hours' notice is the rule for every cancellation, and a paid class cancelled in time is refunded in full (it used to give a class credit).

1. Applied 2026-11-05 (owner's approval, Supabase MCP `apply_migration`; verified: 5 columns, functions server-only, no rows changed), then deployed: **`20261124000000_akb_cancel_refund.sql`** after `20261123…` (five columns with defaults on `akb_class_bookings`, one partial index, three new functions, three replaced; no rows changed; safe to run again), **then** deploy. Check: `select has_function_privilege('anon','public.akb_class_refund_info(uuid)','execute')` is false.
2. No new settings: it uses the live Stripe key already on Production. Stripe needs no change; the refund events it already sends to the webhook are mirrored as before.

How it behaves: cancelling in time refunds the payment through Stripe straight away, and the customer is told the refund is on its way; Alex's cancellation email says it was refunded automatically. If Stripe refuses, the daily job tries again and Alex is emailed once. If the payment was recorded by hand, Alex is emailed "Refund to make" and refunds it himself, then records it in the coach area. Stripe keeps its processing fee on a refunded payment.

### Accounts for everyone who has paid (2026-10-28, built; not live)

Owner's decision (2026-10-28, "the standard gym flow"): the first paid booking makes the account; no passwords and no separate sign-up. Anyone who has paid (a class booked online, a membership, or a payment Alex recorded) signs in at `/account/sign-in` with the same emailed link members use, and sees their classes, class credits and, for members, the plan and credits. Former members can still sign in.

1. Applied 2026-10-28: **`20261030000000_akb_customer_accounts.sql`** after `20261029…` (replaces five functions, adds three; no table or row changes; safe to run again). Check: `select has_function_privilege('anon','public.akb_can_sign_in(uuid)','execute')` is false. Tests: `supabase/tests/20261030000000_akb_customer_accounts.test.sql` (real Postgres 16; the member accounts test now expects a former member to get a link).
2. Needs email (Resend) on Production, like member sign-in.

How it behaves: the booking confirmation email says the bookings are in their account; the account page lists their classes (paid ones cancel for a class credit 24 hours or more before, as the emailed link does), their class credits (book with one, nothing to pay), Book now, and what a membership would have saved them (from content prices and their own bookings). Signed in, the booking and join forms fill in name, email and phone (`/api/account/details`, own details only). The sign-in cookie is now site-wide (was `/account`); people signed in before keep their old cookie until it expires or they sign out.

### Account menu settings (2026-10-28, built; not live)

Profile and details, Notifications, Calendar sync and Sign-in and security, each a page opened from the avatar's menu.

1. **Apply `supabase/migrations/20261031000000_akb_member_settings.sql`** after `20261030…` (with the owner's go-ahead): three tables (RLS on, no policies, `anon`/`authenticated` revoked), one column with a default (`akb_member_sessions.device`), eleven new functions and a replaced `akb_member_cleanup` (adds deleting reminder records after 60 days); no existing row changes; safe to run again. Check: `select has_table_privilege('authenticated','public.akb_member_calendar_feeds','select')` is false. Tests: `src/lib/coach/member-settings.test.ts` (real migrations on PGlite).
2. **Class reminders need email on Production** (Resend, as for sign-in links) and `CRON_SECRET`. `/api/cron/class-reminders` runs daily at 07:41 UTC (vercel.json): each member who switched reminders on gets one email on the morning of a class they're booked on. A place is reminded once (`akb_class_reminders`); cancelled, held and cancelled-class places get nothing. Without the email settings it sends nothing and records nothing, so reminders start when email goes live; the Notifications page says so while it isn't.
3. The calendar link is `<SITE_URL>/account/calendar/feed/<token>.ics` (from `SITE_URL`, else the production URL). The token is shown once; the database keeps only its SHA-256 hash. A new link replaces the old one; Turn off removes it. Calendar apps refresh it about hourly (Google Calendar can take longer).
4. Devices: the sign-in records the kind of device and browser from the user agent (e.g. "iPhone, Safari"), never the IP address or the user agent itself.
5. The email address isn't editable by members (it is their sign-in and how bookings find them); Alex changes it in the coach area.

### Raeng Coaching (2026-10-28, built; not live)

The member side of online coaching, opened from the members area, plus the coach tools that feed it.

1. **Apply `supabase/migrations/20261101000000_akb_coaching_area.sql`** after `20261031…` (with the owner's go-ahead): six tables (RLS on, no policies, `anon`/`authenticated` revoked), sixteen functions (one, `akb_coaching_inbox`, feeds the coach Inbox tab), and `akb_can_sign_in` replaced so a client with an active online coaching subscription can sign in even if they have never booked a class. Adds no column to an existing table and changes no row; safe to run again. Check: `select has_table_privilege('authenticated','public.akb_coaching_messages','select')` is false. Tests: `src/lib/coach/coaching.test.ts` (real migrations on PGlite).
2. **Who has it:** a client with an **active** subscription in the coach area (Online coaching). Paused, cancelled or completed plans have no access (they see the unlock page). Nothing is bought in the members area: Alex starts the subscription after an enquiry.
3. **Alex writes the programme** on the plan's page (`/coach/online/<id>` → Programme): name, goal, weeks (1 to 12), days a week, start date, and the exercises as text (`Week 1`, `Day A`, then `name | sets | reps | load | note | demo link`; a week left out repeats the one before). Demo links are `https://` links to a video hosted elsewhere (YouTube unlisted, Vimeo, Drive); **videos are never uploaded**. Saving again keeps what the client has logged.
4. **Messages and check-ins:** clients write in their Messages and Check-in tabs; Alex sees them and replies on the same plan page, and the Online coaching list shows a badge for unread messages. **Nothing emails Alex yet** (needs Resend; TASKS.md), so he has to open the list.
5. Prices come from `content/services.ts` (the Online coaching monthly price); a client's own plan name and price are read from their subscription.

### Coach portal tabs (2026-10-28, built; not live)

The coach portal now has the owner's coach design: a frame with Today, Schedule, Members and Inbox tabs (no new settings, no new tables). Every existing page is kept. The **Inbox** also shows coaching check-ins and client messages, which need `20261101000000_akb_coaching_area.sql` (Raeng Coaching, above): until it is applied the portal works as before and simply shows no coaching items (the read fails quietly and is logged). **Message class** opens your own email app with the booked people in Bcc; nothing is sent from the site.

### Stripe payments, saved-card renewals and Direct Debit (live on production from 2026-11-02)

**Replaces Square completely** (the `lib/square` code, `/api/square/webhook` and `square-reconcile` are gone). **Live on production since 2026-11-02**: the live key and the signed webhook are set on Vercel Production, and a real £1 card payment and its refund were each recorded once (the test client was archived, not deleted, to keep the record). Card payments work. Bacs Direct Debit is approved and switched on (`DIRECT_DEBIT_ENABLED=true`, 2026-11-03; below); the first real collection has not yet cleared. Without the variables below, online payment stays off and bookings and joins stay requests that Alex confirms.

### Testing against Stripe's real test account (2026-11-03)

The everyday tests use a Stripe stand-in, which can only prove what we expect Stripe to do. `npm run test:sandbox` (`src/lib/stripe/sandbox.test.ts`) runs the same flows against Stripe's real test account ("RAENG Fitness sandbox") with a throwaway local database: that Stripe accepts the pay page the site asks for (35-minute expiry, return and back-arrow addresses, the saved-card agreement), that a saved card is charged with nobody present, what happens on a declined card and on one that needs the bank's confirmation (a failed try, retried on day 3 and 7, then paused), and refunds as Stripe really announces them. No real money or live data is involved.

- It needs `STRIPE_TEST_SECRET_KEY` (a `sk_test_` key from the sandbox, Developers, API keys) in the environment, never in the repo or chat. The suite refuses a live key and checks the account is not live.
- It is off in ordinary runs (`npm test` skips it); `npm run test:sandbox` switches it on.
- A test-mode key can't be used against the live Supabase project (the site refuses it), which is why the database here is local rather than a second Supabase project.


How it works: a class (or a membership's first 4 weeks) is paid by card on **Stripe Checkout**. A member then sets up a **Bacs Direct Debit** on Stripe's page (their bank details never touch this site), and each later 4 weeks is collected from it: the next period is created about 6 days early, its collection is submitted to Stripe (Bacs takes about 3 working days), and credits work as soon as Stripe's signed webhook says it cleared. A failed collection is retried 3 days later, up to 3 tries, then the membership is paused and the member and Alex are emailed. A member can cancel any time from their account (`/account/plan`): no more periods or collections, and the credits already given stay until the period ends. Nothing is recorded from a redirect: only the signed webhook, re-read from Stripe's API.

| Variable | Where | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Sensitive. `sk_live_…` (or a restricted `rk_live_…`) only on Vercel **Production**; `sk_test_…` everywhere else | A live key is ignored off production and a test key is ignored on production and against the live Supabase project, on purpose |
| `STRIPE_WEBHOOK_SECRET` | Sensitive. `whsec_…` of the webhook endpoint | One endpoint per environment |
| `CRON_SECRET`, `SITE_URL` | Already needed | `SITE_URL` is where Stripe sends people back to |

Owner steps (Stripe account holder):
1. Create the Stripe account (UK, GBP) and finish activation. In **Settings → Payment methods**, turn on **Cards** and **Bacs Direct Debit** (Bacs needs Stripe's approval; ask for it early).
2. Developers → API keys: copy the **test** secret key. Add `STRIPE_SECRET_KEY` (test) to Vercel **Preview** only, and a **test** Supabase project marked as a test database (`insert into akb_database_role (role) values ('test')`) as in the Sandbox notes below.
3. Developers → Webhooks → add an endpoint `https://<site>/api/stripe/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`. Copy its signing secret to `STRIPE_WEBHOOK_SECRET`.
4. Apply `20261104000000_akb_stripe.sql` then `20261105000000_akb_direct_debit.sql` (both additive and safe to re-run).
5. Test plan in test mode (no real money): pay a class with card `4242 4242 4242 4242`; join a membership; set up a Direct Debit with Stripe's test sort code `10-88-00` and account `00012345`; confirm the next period's collection appears in the Stripe Dashboard and the payment is recorded when it succeeds (Stripe's test clock can fast-forward the 3 days); try the failing test account `10-88-00` / `90012345`; cancel from `/account/plan`.
6. Only after that passes: the live key and a live webhook endpoint on Production. Refunds are made in the Stripe Dashboard and mirrored automatically.

Not built yet: a coach-portal button to retry or end a Direct Debit by hand (Alex asks the member or pauses/cancels the membership in the portal), automatic detach of a cancelled mandate in Stripe (the membership just stops being collected), and an email reminding the member before each collection (Stripe's mandate emails and the Direct Debit Guarantee cover advance notice; check Stripe's Bacs settings).

**Renewals by saved card (owner, 2026-11-02):** members' memberships now renew by the card they paid the first 4 weeks with (the agreement is on Stripe's page), charged on the day each period starts, with a reminder email 5 days before and a receipt after; failures retry on day 3 and day 7, then pause. Apply `20261106000000_akb_card_renewals.sql` (additive; safe before or after the code deploy). Set `DIRECT_DEBIT_ENABLED=true` on Vercel Production only once Stripe has approved Bacs Direct Debit: until then no Direct Debit button is shown. Details: ARCHITECTURE.md → "Renewals by saved card".

**Safeguards against test money in the live ledger** (`20261021000000_akb_square.sql`, replaced by `20261104000000_akb_stripe.sql`; `lib/stripe/config.ts`):
- Database: `akb_database_role` marker. No row = production. Triggers on `akb_square_payment_links`, `akb_square_events` and `akb_payments` refuse Stripe test records unless the database is marked `test`, and refuse live Stripe records in a `test` database, whichever route writes them (app, RPC or SQL Editor). The app's server role can read the marker but not set it; anon/authenticated can't see it. (The table names keep "square" from before Stripe; they hold Stripe's ids.)
- App: a test Stripe key (`sk_test_`) is ignored on Vercel production and whenever `SUPABASE_URL` is the live project, and a live key (`sk_live_`) is ignored off production, so the webhook returns 404 and no link can be created. Test keys are never added to Vercel Production.
- Never run the marker statement on the live project. If the live database ever moves (handover), update `PRODUCTION_SUPABASE_REF`; the database guard still holds regardless.
- Why not an isolated test database inside the live Supabase project: the Free plan has no branching, and a separate schema shares the instance, the server key, Auth users and backups. Use a separate test project, or the local Supabase stack (`npx supabase start`), for any test that needs a database.

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

### Class size (owner, 2026-10-29)

1. **Apply `supabase/migrations/20261102000000_akb_default_class_capacity.sql`** after `20261101…` (with the owner's go-ahead): one table (`akb_settings`, RLS on, no policies, `anon`/`authenticated` revoked), two functions, the capacity trigger function and `akb_class_overview` replaced (the view's `capacity` is now the size that applies; new last column `capacity_set` is only what Alex typed for the date). Every class holds **12** until Alex changes it under Coach portal → Classes → Class size; a date's own size still wins. No existing row changes; safe to run again. Until it is applied the portal's Class size save fails with a database error and classes have no limit, as before. Check: `select public.akb_default_class_capacity()` returns 12. Tests: `src/lib/coach/bookings.test.ts` (real migrations on PGlite).

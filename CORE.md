# CORE — RAENG

Source of truth for the business, goals, constraints and open decisions.
Values that appear on the website live in code (`src/content/`) — this file
records *status*, not duplicate values.

Last reviewed: 2026-10-19

## Kettlebell Club redesign (2026-10-21, later)

New logo supplied (`assets/brand/raeng-logo-source.jpg`: R monogram with kettlebell, RAENG, Thai แรง, KETTLEBELL CLUB, STRENGTH · COMMUNITY · DISCIPLINE); transparent black and cream versions in `public/brand/`. Descriptor is now **Fitness**: the brand is **RAENG Fitness** (owner confirmed 2026-10-23, matching the logo); earlier "Kettlebell Club". Owner's memberships brief (supersedes the earlier dark-first direction and the £10 class price):

| Item | Status | Notes |
|---|---|---|
| Pay as you go | C | **£12 per class** (was £10; changed by the owner 2026-10-21). Shown wherever the class price appears, including the booking flow and the coach portal's default |
| Starter £40 / 4 weeks, 4 credits · Regular £65, 8 credits · Dedicated £85, 12 credits | C | Per-class cost (£10 / £8.13 / £7.08) and savings (£8 / £31 / £59) are **calculated** from price × credits against £12 (`lib/membership.ts`, tested against the owner's figures) |
| Membership terms and cancellation policy | C | Published as written in `content/policy.ts`. Pausing (owner, 2026-11-04): once, one four-week period, from the end of the current period, once every six months |
| Membership sign-up, auto-renewal billing, credit accounts | C | **Built 2026-10-23, run by Alex in the coach portal** (applied to the live database). Joining has its own journey since 2026-10-26 (`/memberships/join`: plan → optional first class → details → the terms and cancellation policy, agreed with a required tick → send); the request carries the plan (and the first class, if chosen) and the time of agreement, and Alex starts the membership from it. **Changed 2026-10-26 (owner): members join and pay online with nothing for Alex to confirm** — built (`/memberships/join` → Stripe's page → membership starts when Stripe's verified payment is recorded; first class booked then; renewal pay link emailed each period, credits wait for payment), **live since 2026-11-02** (Stripe live, email on) (DEPLOYMENT.md → Joining and paying online). Until then joining stays a request Alex confirms. Member accounts built 2026-10-26 (sign in by emailed link; credits, renewal date, book and cancel with credits); live once the migration is applied and email is on (DEPLOYMENT.md). Each four-week period gets its credits and one charge automatically (daily renewal job); Alex records the payment (or sends a Stripe link). Credits pay for class places; cancelling 24 h or more before returns the credit, later or a no-show uses it, and Alex can give one back. Billing is **manual by the owner's decision (2026-10-24)**: each period's charge is owed in the portal and Alex records the payment or sends a Stripe link; since 2026-11-02 a member who pays online is charged automatically by their saved card (Stripe subscriptions not built) |
| Hero film | C | Supplied 2026-10-21 (12 vertical phone clips, 464×832 or 576×1024). Used: one, cut to 8.8 s, silent (`public/media/hero.mp4/.webm`, poster `hero-poster.jpg`, `content/media.ts`). It shows a class swinging together; no signage in frame; people shown must be happy to appear. The other 11 are unused: most show another gym's APEX | FREQUENCY signage and are low-resolution |

## Master redesign brief (2026-10-22)

- Class schedule changed by the owner: **Monday 6:30 pm, Wednesday 6:30 pm, Saturday 9:00 am** (Saturday was 10:15). Single source: `content/classes.ts`.
- The brief is titled "Alex K Bells" and names the old Lovable site; the brand is **RAENG Fitness** (owner, 2026-11-03: "Raeng Fitness is the brand name"). The logo reads RAENG FITNESS and the home page title says "RAENG Fitness".
- Regular's cost per class is £8.125; the site shows £8.13 (nearest penny), Dedicated £7.08.
- Payments are on Stripe (live 2026-11-02): card payments with verified webhooks, memberships renewing by saved card, and Bacs Direct Debit once Stripe approves it. Nothing is faked: the site never shows a payment as received until Stripe's signed webhook has been verified and re-read from Stripe. Also built and tested: bookings as requests that Alex confirms (capacity enforced in the database when set per class), manual subscriptions and check-ins in the coach portal.

## RAENG rebrand (2026-10-21)

The business is now **RAENG** (brand themes STRENGTH · COMMUNITY · DISCIPLINE; descriptor "Strength & Kettlebell Coaching"). Name and descriptor live in `src/content/site.ts`. Everything confirmed below (venue, timetable, prices, coach name, Instagram/Facebook) is carried over unchanged, **on the assumption that the rebrand did not change them**: confirm with the owner. The social handles are still `@alex.kbells`; no RAENG handle, email, phone, domain or logo artwork has been supplied. The wordmark is typeset (no image logo). The photographs in `public/images/raeng/` were supplied 2026-10-21 and show real people (consent to appear to be confirmed); four supplied frames showing another gym's signage were not used.

## Business

| | |
|---|---|
| Brand | Alex K Bells (logo wordmark: ALEX.KBELLS) |
| Descriptor | Kettlebell Coach |
| Services | Group classes, one-to-one coaching, online coaching |
| Address | 1A Dunns Wood Road, Cumbernauld, Glasgow, G67 3EN, Scotland (no venue name anywhere on the site: owner, 2026-10-29) |
| Instagram | https://www.instagram.com/alex.kbells/ |
| Previous site | https://alexkbells-coaching.lovable.app (reference only) |
| Project terms | Free build for the client; client pays hosting and running costs. Portfolio case study. |

## Objectives

1. Let visitors (often arriving from Instagram on mobile) find class times, location and how to get in touch within seconds.
2. Present a premium, monochrome, athletic brand — not a gym template.
3. Grow into booking, payments, membership and admin only when each is defined.

## Audience

- Local adults (Cumbernauld / North Lanarkshire / Glasgow) interested in group kettlebell classes.
- People wanting one-to-one coaching.
- People outside the area wanting online coaching.

## Fact register

Legend: **C** confirmed · **P** provisional (needs client approval) · **U** unknown

| Item | Status | Notes |
|---|---|---|
| Brand name, descriptor, venue address | C | From brief |
| Instagram URL | C | Tracking parameter removed. On 2026-10-18 the profile could not be read without logging in (login wall), so posts, captions and comments were not audited |
| Facebook page | C | "Alex.kbells", Glasgow; supplied by the project owner 2026-10-18 as Alex's official profile. Share link resolves to page id 61589486540520, which links back to @alex.kbells. Public preview: 1,456 followers, 300 talking about this (2026-10-18). Posts, reviews and recommendations are behind a login wall and were not audited. Linked in the footer, About Alex, /contact and JSON-LD `sameAs` |
| Class times Mon 18:30, Wed 18:30, Sat 10:15, each 60 minutes | C | Mon/Wed confirmed 2026-10-15; Saturday moved to 10:15–11:15 and the 60-minute length confirmed by the project owner 2026-10-17 (from Alex's own class listing). Shown across the site and as real dates in the booking calendar |
| Group class: "Kettlebell Training", £10 per person, description from Alex's listing | C | Confirmed by the project owner 2026-10-17; shown on the homepage and /classes |
| Class duration, capacity, equipment, booking requirement | U | Do not publish |
| Cancellation / refund rules | C | Published (content/policy.ts; refunds option B, 2026-11-02) |
| One-to-one from £35/session; 4 sessions £130/month | C | Confirmed by the project owner 2026-10-15 (figures from the original brief); shown on the site |
| Online coaching £79/month | C | Confirmed by the project owner 2026-10-15; shown on the site |
| Alex's journey (story, before/after photos) | C | Published 2026-10-15 at the owner's request: before/after photos replaced 2026-10-17 with photos supplied by the project owner as Alex's own (`assets/journey/`, cut by `scripts/supplied_photos.py`; no dates, timeframe or figures given, so none are shown), short text written from his reel motto ("1% everyday") and bio. Swap in Alex's own story when supplied |
| Coach's name | C | Alex Robertson (Instagram profile, 2026-10-15) |
| Instagram followers | C | 9,651 on 2026-10-15, shown as "9.6k" (rounded down). Update occasionally |
| Testimonials / client numbers | U | None supplied; never invent |
| FAQ: beginners, first session, what to bring, class length (60 min), kettlebells provided | P→C | Industry-standard answers published at the owner's request 2026-10-15; class length confirmed 2026-10-17. **Alex to check the rest** |
| Session duration, availability, contract terms | U | |
| Membership | C | Starter, Regular, Dedicated, live with online joining (2026-11-03) |
| Email, phone, RAENG Instagram | C | Supplied by the owner 2026-10-30: hello@raengfitness.co.uk, 07452 825256, @raeng.fitness (`site.contact`, `site.social.raeng`). Shown on FAQs & Contact and in the footer. The phone number is never in the page source: it is sent scrambled and shown on a tap ("Show number") to stop scrapers (`RevealPhone`, `lib/phone.ts`) |
| Logo artwork | C | Supplied 2026-10-15 (`assets/brand/alexkbells-logo-source.jpg`). Monogram "AR" with kettlebell (confirmed intentional); wordmark ALEX.KBELLS; descriptor KETTLEBELL COACH. This JPG is the only version — no vector exists |
| Photography of Alex / coaching | U | No stills supplied |
| Training stills | C | Three frames from the same reel (`public/images/training/`), plus two header stills cut from the hero loop on 2026-10-16 (`double-swing.jpg`, `bell-hold.jpg`, `scripts/video_stills.py`); same permission caveat as the hero footage (the bell-hold frame shows another person in the background) |
| Hero footage | C | Alex's own Instagram reel (supplied 2026-10-15), used for the homepage hero loop. Filmed at several gyms, some visibly not Media House (e.g. "APEX" signage), and shows other people training. Confirm Alex is happy for it to represent his coaching and that people shown are fine appearing on the website |
| RAENG quote (why it exists) | C | "Be part of something bigger than just a workout.", Alex's own words from his launch post (Instagram @alex.kbells, 26 Oct 2026), on /about. "The studio" in the post is where he trains now (his own studio is "a few years" off, WhatsApp 22 Oct); venue unchanged |
| Bio, qualifications, history, testimonials | U | Do not invent |
| Bookings | C | Live on production from 2026-10-18 at the owner's request: "Book now" opens /book. Group classes: real dates from the timetable; one-to-one: preferred days. Each is a **request** stored in Supabase (`akb_booking_requests`) and listed in the coach area; Alex confirms. Payment: bank transfer or cash (Alex's listing, 2026-10-17); no online payment. **Changed 2026-10-27 (owner): group classes are booked and paid online with nothing for Alex to confirm** (place held 15 minutes while paying; cancel 24 h or more before → a credit for another class within 4 weeks; later or a no-show → nothing back); 1:1 stays a request. Built, **not live** until online joining is (DEPLOYMENT.md → Booking a group class and paying online). Alex to confirm the credit wording |
| Live availability: capacity, one-to-one slots | U | Class dates come from the confirmed timetable. When Alex sets a capacity on a class date in the portal and it fills, the booking calendar shows that date as unavailable and the server refuses it (`lib/class-capacity.ts`). Every class holds 12 unless Alex changes the class size in the portal (owner, 2026-10-29), so a class with 12 booked shows "Fully booked" and visitors are sent to the next class. Nothing invented |
| Booking-request inbox / Resend account | U | Needed to switch on `/book`; must be Alex's own |
| Privacy notice | C | `/privacy` reviewed (owner, 2026-11-03) |
| Stripe (replaces Square, owner 2026-10-30) | C | **Live since 2026-11-02**: card checkout, signed webhook, refunds mirrored, a real £1 payment and refund verified once each; memberships renew by saved card (2026-11-02). Bacs Direct Debit approved and on (`DIRECT_DEBIT_ENABLED=true`, 2026-11-03); a mandate was set up for real, the first collection has not yet cleared. Fees (Stripe's UK pricing page): standard UK cards 1.5% + 20p, premium UK cards 2.8% + 20p, international 3.15% + 20p, Bacs 1% (min 20p, max £4); the account's own rate is in the Stripe Dashboard. |
| Coach portal | P | Built 2026-10-19 (requests, clients, classes, one-to-one, online coaching, payments, revenue). Needs its Supabase migration applied with the owner's approval (DEPLOYMENT.md). Manual payments only (cash, bank transfer); no card processing |
| Data retention for client and payment records | U | Alex to decide; add to `/privacy` |
| Domain | U | Not chosen |
| Hosting account | P | Vercel project `alexkbells` exists in the developer's personal Hobby account; Alex's own account (likely Pro for commercial use) recommended before launch — see DEPLOYMENT.md |

## Constraints

- Never fabricate testimonials, qualifications, prices, durations, capacity, policies or social proof.
- No production payment system and no card-data collection in Phase 1.
- UK English, GBP.
- Provisional content is never shown on production (see CONTENT.md → Approval workflow).

## Phases

1. **Public website** — this release.
2. **Booking & payments** — after provider, prices, capacity, cancellation policy are confirmed.
3. **Membership & accounts** — after the membership product is defined.
4. **Admin & hardening** — coach portal built 2026-10-19 (see ARCHITECTURE.md → Coach portal).

## Open decisions

1. Booking: keep the on-site request form (built), or move to Setmore / custom booking with payments? (Payments are on Stripe.)
2. (Answered 2026-11-02) Stripe is the payment provider; Square is no longer used.
3. Membership structure and price.
4. Domain name and who owns the Vercel / domain accounts.
5. Contact channels beyond Instagram (email address? phone? contact form?).

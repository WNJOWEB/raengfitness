# CORE — Alex K Bells

Source of truth for the business, goals, constraints and open decisions.
Values that appear on the website live in code (`src/content/`) — this file
records *status*, not duplicate values.

Last reviewed: 2026-11-05

## Business

| | |
|---|---|
| Brand | Alex K Bells (logo wordmark: ALEX.KBELLS) |
| Descriptor | Kettlebell Coach |
| Services | Group classes, one-to-one coaching, online coaching |
| Venue | Media House, 1A Dunns Wood Road, Cumbernauld, Glasgow, G67 3EN, Scotland |
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
| Class timetable: Mon 18:30 **KB HIIT**, Wed 18:30 **Double KB**, Sat 09:00 **KB Mix** | C | Names, descriptions and the new Saturday time (was 10:15) supplied by Alex in "RAENG Website Changes", 2026-11-05. The 60-minute length was confirmed for the earlier timetable (2026-10-17): **Alex to confirm it still applies**. Slot ids unchanged, so class dates already in the coach portal keep their bookings, but dates already created for Saturdays keep the old 10:15 start time |
| Group class capacity 15 per class | P | From the example in Alex's changes ("10/15 spaces available", "15/15 Full"). Default for every class date; the coach can set a different capacity for one date. **Alex to confirm 15** |
| Spaces remaining on the booking page | C | Shown as "10/15 spaces available" / "15/15 Full" (Alex's wording). Counts only confirmed places (a request isn't a place until Alex confirms it). Hidden when counts can't be read |
| Group class: "Kettlebell Training", £10 per person, description from Alex's listing | C | Confirmed by the project owner 2026-10-17; shown on the homepage and /classes |
| Class duration, capacity, equipment, booking requirement | U | Do not publish |
| Cancellation / refund rules | U | Do not publish |
| 1:1 coaching: Single 1:1 session £35; Monthly package £130 (4 sessions) | C | Figures confirmed 2026-10-15; restated by Alex 2026-11-05 as two options a customer chooses between when requesting 1:1 coaching (the single session is no longer shown as "from £35") |
| Small group coaching | P | Copy supplied by Alex 2026-11-05 (screenshots). **No price, group size, times or duration supplied, so none is shown**: the section says pricing and availability are shared on enquiry. Enquiries only (`/book/small-group`), never a booking |
| Online coaching £79/month | C | Confirmed by the project owner 2026-10-15; shown on the site |
| Alex's journey (story, before/after photos) | C | Published 2026-10-15 at the owner's request: before/after photos replaced 2026-10-17 with photos supplied by the project owner as Alex's own (`assets/journey/`, cut by `scripts/supplied_photos.py`; no dates, timeframe or figures given, so none are shown), short text written from his reel motto ("1% everyday") and bio. Swap in Alex's own story when supplied |
| Coach's name | C | Alex Robertson (Instagram profile, 2026-10-15) |
| Instagram followers | C | 9,651 on 2026-10-15, shown as "9.6k" (rounded down). Update occasionally |
| Testimonials / client numbers | U | None supplied; never invent |
| FAQ: beginners, first session, what to bring, class length (60 min), kettlebells provided | P→C | Industry-standard answers published at the owner's request 2026-10-15; class length confirmed 2026-10-17. **Alex to check the rest** |
| Session duration, availability, contract terms | U | |
| Membership | U | Under consideration; not on the site |
| Email, phone | U | `site.contact` is null; not rendered |
| Logo artwork | C | Supplied 2026-10-15 (`assets/brand/alexkbells-logo-source.jpg`). Monogram "AR" with kettlebell (confirmed intentional); wordmark ALEX.KBELLS; descriptor KETTLEBELL COACH. This JPG is the only version — no vector exists |
| Photography of Alex / coaching | U | No stills supplied. Alex's portrait was removed from the About section 2026-11-05 at his request |
| About section | C | Now "About RAENG" (brand, values), no coach biography or portrait (Alex, 2026-11-05). Wording drafted from how the site already describes the coaching: **Alex to review**. The brand is still "Alex K Bells" everywhere else (header, footer, metadata): confirm whether the whole site is moving to RAENG |
| Training stills | C | Three frames from the same reel (`public/images/training/`), plus two header stills cut from the hero loop on 2026-10-16 (`double-swing.jpg`, `bell-hold.jpg`, `scripts/video_stills.py`); same permission caveat as the hero footage (the bell-hold frame shows another person in the background) |
| Hero footage | C | Alex's own Instagram reel (supplied 2026-10-15), used for the homepage hero loop. Filmed at several gyms, some visibly not Media House (e.g. "APEX" signage), and shows other people training. Confirm Alex is happy for it to represent his coaching and that people shown are fine appearing on the website |
| Bio, qualifications, history, testimonials | U | Do not invent |
| Bookings | C | Live on production from 2026-10-18 at the owner's request: "Book now" opens /book. Group classes: real dates from the timetable; one-to-one: preferred days. Each is a **request** stored in Supabase (`akb_booking_requests`) and listed in the coach area; Alex confirms. Payment: bank transfer or cash (Alex's listing, 2026-10-17); no online payment |
| Live availability: capacity, one-to-one slots | U | Class dates come from the confirmed timetable; capacity is unknown, so no date shows as full. Nothing invented |
| Booking-request inbox / Resend account | U | Needed to switch on `/book`; must be Alex's own |
| Privacy notice | P | `/privacy` drafted 2026-10-15 for booking requests and online enquiries; Alex to review |
| Square | P | Account created; owner says Square is the payment provider (2026-10-21). Rate quoted as 1.4% + 25p per online card payment — unverified. Enabled products unknown. Payment links per charge built in the portal (not live, not yet tested in Square Sandbox) |
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

1. Booking: keep the on-site request form (built), or move to Setmore / Square Appointments / custom booking with payments?
2. Which Square products are enabled (Online Checkout, Appointments, Subscriptions)?
3. Membership structure and price.
4. Domain name and who owns the Vercel / domain accounts.
5. Contact channels beyond Instagram (email address? phone? contact form?).

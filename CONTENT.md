# CONTENT — Alex K Bells

## Where content lives (single source of truth)

| Content | File |
|---|---|
| Brand, address, contact, social, logo, photos, nav | `src/content/site.ts` |
| Class timetable | `src/content/classes.ts` |
| Services, descriptions, prices | `src/content/services.ts` |
| FAQ | `src/content/faq.ts` (timetable answer is generated from `classes.ts`) |
| Page-specific copy | the page file in `src/app/**/page.tsx` |

## Approval workflow

Every customer-critical item has `status: "confirmed" | "provisional"`.

- **Production** (`CONTENT_PREVIEW` unset): provisional items are hidden. Fallbacks are neutral, e.g. "Get in touch for current pricing", "The class timetable is being finalised".
- **Preview** (`CONTENT_PREVIEW=true`, Vercel preview only): provisional items render inside a dashed amber "Preview · awaiting confirmation" frame for Alex to review.
- To publish: change the item's status to `"confirmed"`, update `src/content/content.test.ts` (it deliberately fails if something is confirmed by accident), and record the approval date below.

## Sitemap

| Route | Purpose |
|---|---|
| `/` | Answers Alex's four questions in order, each linked from the top menu: hero (**Book now** + whole video) → **Why kettlebells** `#why-kettlebells` (four numbered benefits in a 2 × 2 grid, one short line each, no button: the sections either side carry it; moved above the offers 2026-10-18 at the owner's request) → **What I offer** `#ways-to-train` (group / one-to-one / online as photo cards with prices, an "Enquire" button and a Details link each; a swipe carousel on phones and tablets, three columns on desktop) → **About Alex** `#about` (+ training stills, 9.6k followers) and his journey → **Where and how to book** `#how-to-book` (3 steps, "Book now" button, address + directions, when) → FAQ → closing CTA ("Book now" + "Message on Instagram") |
| `/classes` | "Book now" + "How to join", timetable (`#timetable`), 3-step how to join (`#book`), location |
| `/coaching` | One-to-one (`#one-to-one`) and online (`#online`) |
| `/contact` | Instagram (primary), email/phone when supplied, address, directions |
| `/book` | **Public** since 2026-10-18 (linked by "Book now", in the sitemap, indexed). "Book your session": guided steps — service (group class or one-to-one) → when → your details. Group classes pick a real date from the confirmed timetable and see the class set out like Alex's listing (date, 1 hr, £10 per person, description); one-to-one picks preferred days/times. `/book/group-class` and `/book/one-to-one` start at step 2. Previews with `BOOKING_DEMO=true` show the labelled sample calendar instead |
| `/book/group-class`, `/book/one-to-one` | Same flow, starting at "when" for that service |
| `/online-coaching` | "Ask about online coaching" (2026-10-19; was "Get started…"): an **enquiry**, stated on the page as "not a sign-up: nothing is booked and there's nothing to pay". Goal → training → contact → review & send; stored for the coach portal (Requests) and/or emailed; Alex replies personally. If sending isn't configured the page says enquiries happen on Instagram for now and links there |
| `/privacy` | Privacy notice: what booking requests and online enquiries collect, where they go (Vercel, Resend, Alex's inbox), rights, ICO. **Alex to review** |

**Trade-offs taken**

- `/one-to-one` and `/online-coaching` were merged into `/coaching` with anchors: with the verified information available each would be a few sentences. Split them once there is enough real content (session format, programme examples, photos).
- `/about` is a homepage section only. Without a verified bio, qualifications or photos a standalone page would be thin. Add `/about` once Alex supplies these.
- Membership is omitted entirely until defined.
- Booking is a **request**, not instant booking: capacity is unknown, so Alex confirms each place. Copy says "request" and "Alex confirms every place personally"; the outcome says "Your place is booked once he confirms".
- The calendar's demonstration availability is invented sample data (deliberately on different days from the real timetable) and is always labelled "Demo". It must never be shown on production.
- No general contact form; `/contact` stays Instagram-first.

Coach portal (`/coach/*`, signed in, never indexed): Dashboard, Requests, Clients, Classes, PT sessions, Online coaching, Finances. Default prices in its forms come from `src/content/services.ts` (class £10, one-to-one £35, four sessions £130, online £79); payment methods from `src/content/payments.ts` (bank transfer, cash). The message to a client after a decision uses the class name, venue and payment line from `src/content/`.

## Copy rules

- `/contact` puts "Message Alex on Instagram" in its header so the page's one action is in the first screen at every width.
- One primary call to action everywhere: **"Book now"** (owner's wording since 2026-10-20; previously "Start your training") (`getPrimaryCta()` in `src/lib/booking.ts`). Since 2026-10-18 it opens `/book` wherever booking works (production included); `/classes` and `/coaching` send it straight to that service's step (`getPrimaryCtaFor`). Without any booking route it says **"Get in touch"** and falls back to `/contact`, so nothing says "book" where nothing can be booked. Online coaching is never "Book now": every online button reads **"Enquire about online coaching"** (`getOnlineCoachingAction()`) and opens `/online-coaching` when it can send, else `/contact` (Instagram). Booking journey (2026-10-19): with the booking form open, every in-person route leads to a **booking request** (never "booked": Alex confirms each place): the offer cards' "Request a class" / "Request a session" (→ `/book/group-class`, `/book/one-to-one`), `/classes` "How to join" (Choose a session → Send a booking request → Alex confirms your place), How to book, the one-to-one intro on `/coaching` and a line on `/contact`. Instagram appears beside them as the labelled alternative ("Questions first, or prefer to message?", `InstagramAlternative`). The Instagram-only wording returns only if the booking form is switched off. An e2e guard fails on Instagram-only booking instructions on both test servers.
- Request copy says "request" and "Alex will reply to confirm" — never "booked" or "confirmed". The demo outcome says "No booking has been made". Optional notes ask visitors not to include medical details; no form asks about health.
- One question, "Your kettlebell experience": Beginner (selected by default), Intermediate or Advanced, with no subtitles (owner's wording since 2026-10-20; previously ROOKIE / WARRIOR / BEAST MODE). The submit button reads "LET'S GET TO WORK". No accounts or stored profiles; browsers autofill name, email and phone.
- Hero copy does not name Media House: much of the hero footage was filmed at other gyms.
- "Choose how you train" (2026-10-17, minimal): intro "In person in Cumbernauld, or online wherever you are." Each option has one short line, open to everybody ("Train together. Every level welcome." / "Every rep coached, built around you." / "Your plan, with Alex in your corner."), one line of facts, and its lead price. No promised frequency, fitness level or results.
- Benefits (pared to four 2026-10-18; the old six repeated each other): Build strength · Get fitter · Move well · Train anywhere, one short line each. No "expert" claims (qualifications unconfirmed), no weight-loss or transformation promises.

- Use only verified wording for offers: "tailored to the individual", "personalised programming, support and progression".
- Benefits copy is hedged ("can build") and makes no medical or results claims.
- Don't use pronouns for Alex in site copy unless confirmed preferences are recorded here.

## Asset inventory

| Asset | Status | Needed at |
|---|---|---|
| Logo source (1254×1254 JPG, white on black) | **Supplied 2026-10-15** | `assets/brand/alexkbells-logo-source.jpg` (not public) |
| Logo mark (monogram crop, transparent) | Generated | `public/brand/logo-mark.png` — header |
| Logo lockup (full crop, transparent) | Generated | `public/brand/logo-lockup.png` — footer |
| Favicon / apple icon | Generated (monogram on ink) | `src/app/icon.png`, `src/app/apple-icon.png` |
| Open Graph / social preview image | Generated (lockup on ink, 1200×630) | `public/og-image.png`, declared for every page in `src/lib/metadata.ts` |
| Vector (SVG) logo | Not available — the JPG is the only version | Don't request again; derived PNGs are the master web assets |
| Hero video (9 clips, 8.3 s, B&W, silent, 4:5; opens on the group class) | Generated 2026-10-15 from Alex's reel | `public/media/hero.webm`, `hero.mp4`, `hero-poster.jpg`; configured as `site.heroVideo`. Regenerate with `scripts/hero_video.py` (source reel not committed — 30 MB) |
| Hero photo of Alex coaching | Not needed while the video is set | `public/images/`, set `site.photos.hero` |
| About photo | Removed 2026-11-05 at Alex's request | The About section is about the brand and shows the training stills only |

Regenerate all derived logo files with `python3 scripts/brand_assets.py` (needs Pillow) if the source changes.

## Questions for Alex (client approval required)

Classes
1. Mon 18:30, Wed 18:30, Sat 10:15 (60 min) confirmed 2026-10-17 — any weeks off (holidays)?
2. Class duration? Maximum capacity?
3. Price per class (drop-in / packs)?
4. Is advance booking required? Can people turn up?
5. Is equipment provided? Anything to bring?
6. Suitable for complete beginners? Any minimum age?
7. Cancellation and refund rules?

Coaching
8. ~~Reconfirm prices~~ — confirmed 2026-10-15 (one-to-one from £35/session; 4 sessions £130/month; online £79/month).
9. Alex's journey: his story (three short chapters), before/after photos, and any real figures (Instagram followers, clients coached) — see `src/content/journey.ts`.
9. Session length; where one-to-one sessions take place (always Media House?).
10. How online coaching works day to day (app? check-ins? video review?).

Hero video
- Confirm everyone identifiable in the clips is happy to appear on the website (it was already public on Instagram, but a website is a different use).
- Several clips were filmed at other gyms. Fine as "Alex coaching", but don't caption them as Media House.

About & trust
11. Short bio in Alex's words; qualifications/certifications (with names of issuing bodies).
12. Permission to use specific Instagram photos/videos on the site.
13. Any testimonials Alex has written permission to publish (name/initial consent).

Contact
14. Public email address and/or phone number? Preferred contact method?

## Approval log

| Date | Item | Approved by |
|---|---|---|
| — | — | — |

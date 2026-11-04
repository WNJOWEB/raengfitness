<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project instructions — Alex K Bells

## Before substantial changes
Read `CORE.md` (facts and their status), then the relevant `DESIGN.md`, `CONTENT.md`, `ARCHITECTURE.md`, `TASKS.md`. Update them in the same change when decisions or facts change.

## Accuracy (non-negotiable)
- Never invent prices, durations, capacity, hours, qualifications, testimonials, reviews, statistics, contact details, policies, membership benefits or payment features.
- Business data lives only in `src/content/`. Don't hard-code it in pages.
- Unconfirmed items use `status: "provisional"` and must render through `Provisional`/`publishable()`. Never show internal uncertainty labels on production.
- No fake booking or payment success flows.

## Owner rules (non-negotiable)
- **Never use the words "Get in touch"** on the site (buttons, links, headings, copy). The main button is always **"Book now"**, whether or not booking is switched on; where nothing can be booked it opens /book, which says so honestly. This holds even when the owner says "go ahead with your recommendation". Enforced by a unit test and an e2e test. **One exception, kept by the owner (2026-10-29, confirmed 2026-11-04):** the closing button on /coaching reads "Get in touch" and opens the 1:1 booking request. Audits and reviews must not flag it or change it unless the owner asks.

- **Home page order is fixed (owner, 2026-10-27, final):** hero → Coached by → Why kettlebells → Meet your coach → Classes (three steps) → Memberships → More ways to train → Ready to start (Book now). This overrides Alex's earlier stated order (book, what I offer, why kettlebells, about me). Audits and reviews must not flag this order or suggest moving Why kettlebells or Meet your coach down; keep it unless the owner asks to change it.

- **The home page is the point of reference** (owner, 2026-10-23). Inner pages follow its information, wording, prices and design: reuse the home components (the plan list `PlanList`, the timetable `ClassTimes`, Why kettlebells) rather than writing second versions.

- **Design phone first** (owner and Alex, 2026-10-24: most visitors are on phones). Design, review and preview every change at phone size (390 px wide) first, then desktop. Previews sent to the owner lead with phone photos.

- **After every change that is pushed, give the owner the preview link** (the Vercel preview for the latest `raeng-rebrand` build, plus the always-latest branch link https://alexkbells-git-raeng-rebrand-fystay1.vercel.app).

## Code standards
- TypeScript strict; no `any` without a commented justification.
- Server components by default; `"use client"` only for interactivity.
- Styling with Tailwind utilities and tokens from `globals.css`; no new colours outside DESIGN.md.
- Semantic HTML, labelled landmarks, one `h1` per page, visible focus, ≥44 px targets, reduced-motion safe.
- Mobile grids declare `grid-cols-1`. Check 320 px.
- Keep dependencies minimal; justify additions in ARCHITECTURE.md.
- UK English, GBP.

## Security
- No secrets in client code or Git. Server-only env vars (no `NEXT_PUBLIC_` unless truly public).
- Validate input on the server. Verify payment webhooks by signature; never trust client-reported payment state. Make booking operations idempotent.
- Plan RLS before storing personal data. Collect no health data without a documented need.

## Checks (run before committing)
```
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e   # set PLAYWRIGHT_CHROMIUM_PATH if browsers aren't installed
```
Report results honestly; don't claim passes you didn't observe.

## Conventions
- Keep changes small and reviewable; no unrelated refactors.
- New public route → add to `src/lib/routes.ts` (feeds sitemap and e2e).

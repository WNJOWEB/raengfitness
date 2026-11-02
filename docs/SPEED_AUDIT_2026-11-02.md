# Button and page speed audit: members and coach dashboards (2026-11-02)

Asked by the owner: buttons and taps feel slow in the coach dashboard and the members dashboard (used on phones). This is what is slow, why, how much, and what to do, in order of payoff.

## How it was measured

- **Code read** of every page load and button action in both dashboards.
- **Call counting** against the real database functions (the test database, with each database call delayed by 80 ms to stand in for the real distance, see finding 1). It counts calls and how many must wait for another.
- **Not available:** Vercel's own per-page timings (the observability query was rejected) and any real-phone profile. The 80 ms figure is a typical Washington DC to Ireland round trip, not a measurement from this site. Verify after the first fix (below).

## Findings, biggest first

### 1. The server and the database are on different continents
- The database is in Ireland (`eu-west-1`). The site's server functions run in Washington DC (`iad1`, Vercel's default; nothing sets a region).
- Every database call pays about 80 ms to cross the Atlantic and 80 ms back, and each page makes several.
- Measured call counts:
  - **Members page** (Home, Book, Plan): 1 session check, then 5 loads in parallel and 1 class-capacity read. About **2 sequential round trips**: roughly 0.2 to 0.3 s of pure waiting.
  - **Coach layout** (the frame around every coach page): 7 calls, plus an authentication call to Supabase Auth before it.
  - **Coach Today page**: **23 calls in 5 sequential waves**, plus an authentication call, plus a database write first (finding 5). About **6 to 7 sequential round trips**: roughly 0.5 to 0.8 s of pure waiting.
- **Fix:** run the functions in Dublin (`dub1`), next to the database: `"regions": ["dub1"]` in `vercel.json`. One line, no cost, and every page and button benefits. In the same region a round trip is a few milliseconds, so the waiting above falls to roughly a tenth.
- **Effort:** minutes. **Risk:** low; it is a deploy-time setting.

### 2. Tapping a tab shows nothing until the server has answered
- There are **no loading screens at all** (no `loading.tsx` anywhere), and the members and coach layouts switch instant navigation off (`export const instant = false`).
- Both dashboards are signed-in, per-person pages, so each tab tap (Home, Book, Plan; Today, Schedule, Members, Inbox) waits for a full server render before anything on screen changes. On a phone that feels like the tap was missed, so people tap again.
- **Fix:** a loading screen for each dashboard (a calm skeleton of the page), so the tap responds on the next frame and the real page streams in. With the tab bar links prefetching, the skeleton is already on the phone.
- **Effort:** about an hour. **Risk:** low.

### 3. Buttons wait for emails before they answer
- Server actions send their emails **before** replying, and each email is a call to Resend: book a class, cancel a class, cancel a membership, and on the coach side confirm or decline a request, pause or cancel a membership, record a payment, cancel a class.
- Each notice is up to two emails sent one after the other (the customer, then Alex), so one tap can wait for 2 to 4 outside calls. Cancelling a whole class emails **every attendee in turn**: with 12 booked, that is dozens of calls before the coach's screen updates.
- **Fix:** send the emails after the response (Next's `after()`), so the button answers as soon as the change is saved. The emails still go; they just stop holding up the screen.
- **Effort:** about an hour. **Risk:** low (the emails already tolerate failure and de-duplicate by key).

### 4. Member buttons give no sign they were pressed
- The coach portal's forms show a pending state ("Pausing…", disabled button). The members' **Book** buttons and similar plain form buttons show nothing between the tap and the new page.
- **Fix:** one shared pending button (disabled, label changes to "Booking…", tick on success). This turns a 1-second wait into a visible, trustworthy action.
- **Effort:** about an hour. **Risk:** low.

### 5. Coach pages do the same checks twice, and one page writes to the database on every view
- The coach layout and the page each check who is signed in (a call to Supabase Auth each time): **two authentication round trips per page** where one would do.
- The Today page runs `catchUpRenewals` (a database **write**) before it loads anything, on every view. The daily job already does this renewal.
- The Today and dashboard loaders make several calls one after another that could be asked together.
- **Fix:** check the coach once per request (React's `cache`), move the catch-up out of the page load (the daily job already does it; or run it after the response), and ask for independent data together.
- **Effort:** a couple of hours. **Risk:** medium-low, needs care and tests around sign-in.

### 6. Smaller things (later)
- Every action ends by re-fetching the whole page. Once 1 to 4 are done this is fine; later, update only the part that changed.
- The members page checks whether a payment is owed on every view; when one is, that includes a call to Stripe. Cache the link for a minute.
- JavaScript is about 517 KB uncompressed on every page, all framework. Not the cause.

## Order to do it

| # | Change | Where it helps | Effort |
|---|---|---|---|
| 1 | Run functions in Dublin | Every page and button, both dashboards | Minutes |
| 2 | Loading screens and prefetch | Every tab tap feels instant | About 1 hour |
| 3 | Send emails after the reply | Book, cancel, pause, record payment, cancel class | About 1 hour |
| 4 | Pending button for members | Book, cancel, plan buttons | About 1 hour |
| 5 | Coach: one auth check, no write on page load, parallel loads | Coach Today and every coach page | A couple of hours |

## How to know it worked

- Before and after, on a phone: tap Home → Book → Plan → Home, and book then cancel a class. Count how long until the screen changes. Target: the screen reacts in under 0.1 s (loading screen), the real page in under 0.5 s, a button's result in under 1 s.
- Optional: turn on Vercel Speed Insights, which reports **Interaction to Next Paint**, the standard measure of how quickly a tap responds. It adds one small package, so it is the owner's call.

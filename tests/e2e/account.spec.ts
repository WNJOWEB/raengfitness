import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Member accounts (2026-10-26; the owner's members design 2026-10-28) on the
 * production configuration: one-time email links, Home / Book / Plan, booking
 * and cancelling in the confirm sheet, the menus, signing out. The member is seeded straight into the stand-in database.
 */
const PROD = `http://localhost:${process.env.E2E_PRODUCTION_PORT ?? 3201}`;
const MOCK = `http://localhost:${process.env.MOCK_EMAIL_PORT ?? 3299}`;
const SUPABASE = `http://localhost:${process.env.MOCK_SUPABASE_PORT ?? 3298}`;

interface RecordedEmail {
  payload: { to: string[]; reply_to: string; subject: string; text: string };
}

async function sql(request: APIRequestContext, query: string, params: unknown[] = []) {
  const response = await request.post(`${SUPABASE}/test/sql`, { data: { sql: query, params } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function emailsTo(request: APIRequestContext, to: string): Promise<RecordedEmail[]> {
  const all = (await (await request.get(`${MOCK}/requests`)).json()) as RecordedEmail[];
  return all.filter((e) => e.payload.to.includes(to));
}

/** A client with a Regular membership starting today. */
async function seedMember(request: APIRequestContext, email: string) {
  const [client] = await sql(request, "insert into akb_clients (full_name, email, status) values ($1, $2, 'active') returning id", ["Member Tester", email]);
  await sql(request, "select akb_start_membership($1, 'regular', 'Regular', 6500, 8, akb_london_today())", [client.id]);
}

async function askForLink(page: Page, email: string) {
  await page.goto(`${PROD}/account/sign-in`);
  await page.getByRole("textbox", { name: "Your email" }).fill(email);
  await page.waitForTimeout(3100);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
}

function linkPath(email: RecordedEmail): string {
  const url = /https?:\/\/\S+\/account\/confirm\?token=[A-Za-z0-9_-]{43}/.exec(email.payload.text)?.[0];
  expect(url).toBeDefined();
  return new URL(url!).pathname + new URL(url!).search;
}

test.describe("member accounts", () => {
  test("a member signs in with an emailed link, books and cancels with credits, and signs out", async ({ page, request, browser }) => {
    // The whole members journey in one test: sign in, Home, Book, the menus, cancel, Plan, no JavaScript, sign out.
    test.slow();
    const email = `member-${Date.now()}@example.com`;
    await seedMember(request, email);

    // Signed out, the account page sends you to sign in.
    await page.goto(`${PROD}/account`);
    await expect(page).toHaveURL(/\/account\/sign-in$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    await askForLink(page, email);
    const sent = await emailsTo(request, email);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.subject).toBe("Your RAENG sign-in link");
    expect(sent[0].payload.text).toContain("It works once, for the next 15 minutes.");
    const path = linkPath(sent[0]);

    // Opening the link doesn't sign in on its own (email scanners open links): the button does.
    await page.goto(PROD + path);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in." })).toBeVisible();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    // Home (owner's members design, 2026-10-28): the members frame replaces the site's header and footer.
    await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Afternoon|Evening), Member\.$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /RAENG\s*MEMBERS/ })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "8 of 8 credits left" })).toBeVisible();
    await expect(page.getByText(/^Regular · renews /)).toBeVisible();
    await expect(page.getByText("Nothing booked yet.")).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Members" });
    await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    // The session cookie: httpOnly, site-wide since 2026-10-28 (the booking form fills in details).
    const cookie = (await page.context().cookies(PROD + "/")).find((c) => c.name === "akb_member_session");
    expect(cookie).toMatchObject({ httpOnly: true, path: "/", sameSite: "Lax" });

    // Book: the last week's last bookable class, confirmed in the sheet.
    await tabs.getByRole("link", { name: "Book" }).click();
    await expect(page).toHaveURL(/\/account\/book$/);
    await expect(page.getByRole("heading", { level: 1, name: "8 credits to use." })).toBeVisible();
    const weekTabs = page.getByRole("tab");
    let week = weekTabs.last();
    // The last week may be after the period ("Next period"); use the latest week with a bookable class.
    for (let i = (await weekTabs.count()) - 1; i >= 0; i--) {
      await weekTabs.nth(i).click();
      if ((await page.getByRole("tabpanel").getByRole("link", { name: /: Book$/ }).count()) > 0) {
        week = weekTabs.nth(i);
        break;
      }
    }
    const weekLabel = (await week.innerText()).trim();
    await page.getByRole("tabpanel").getByRole("link", { name: /: Book$/ }).last().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Uses 1 of your 8 credits.");
    const label = (await sheet.getByRole("heading").innerText()).trim();
    await sheet.getByRole("button", { name: "Book it" }).click();
    await expect(page.getByRole("status")).toHaveText("Booked. One credit used.");
    // The address goes back to /account/book, and Book stays on that class's week, now booked.
    await expect(page).toHaveURL(/\/account\/book$/);
    await expect(page.getByRole("tab", { selected: true })).toHaveText(weekLabel);
    await expect(page.getByRole("tabpanel").getByRole("link", { name: `${label}: Booked` })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "7 credits to use." })).toBeVisible();
    // The booking is emailed to the member and to Alex.
    await expect.poll(async () => (await emailsTo(request, email)).some((e) => e.payload.subject.startsWith("You're booked:"))).toBe(true);
    await expect.poll(async () => (await emailsTo(request, "alex-e2e@example.com")).some((e) => e.payload.subject.startsWith("Class booked: Member Tester"))).toBe(true);

    // Home: it's the next class, with the calendar and directions.
    await tabs.getByRole("link", { name: "Home" }).click();
    await expect(page.getByRole("img", { name: "7 of 8 credits left" })).toBeVisible();
    const next = page.getByRole("region", { name: "Your next class" });
    await expect(next).toContainText(label.replace(", ", ""));
    await expect(next.getByRole("link", { name: /^Directions/ })).toHaveAttribute("href", /google\.com\/maps/);
    const ics = await page.request.get(PROD + (await next.getByRole("link", { name: "Add to calendar" }).getAttribute("href"))!);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    expect(await ics.text()).toMatch(/BEGIN:VEVENT[\s\S]*DTSTART:\d{8}T\d{6}Z[\s\S]*LOCATION:1A Dunns Wood Road/);
    expect((await request.get(`${PROD}/account/calendar?place=00000000-0000-0000-0000-000000000000`, { maxRedirects: 0 })).status()).toBe(307);

    // The members menu and the account menu.
    await page.getByRole("button", { name: "Members menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Members menu" });
    await expect(drawer).toContainText("Regular · 7 credits left");
    await expect(drawer.getByRole("link", { name: "Book a class" })).toHaveAttribute("href", "/account/book");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("link", { name: /Plan and billing/ })).toHaveAttribute("href", "/account/plan");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Account menu" })).toBeFocused();

    // The page passes an accessibility scan.
    await page.waitForTimeout(800);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Cancel it in time from Home: the sheet says the credit comes back, then it does.
    await page.locator("#booked").getByRole("link", { name: /^Cancel/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Your credit comes back");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByRole("status")).toHaveText("Cancelled. Your credit is back.");
    // The cancellation is emailed to the member and to Alex.
    await expect.poll(async () => (await emailsTo(request, email)).some((e) => e.payload.subject.startsWith("Cancelled:") && e.payload.text.includes("Your credit is back."))).toBe(true);
    await expect.poll(async () => (await emailsTo(request, "alex-e2e@example.com")).some((e) => e.payload.subject.startsWith("Class cancelled: Member Tester"))).toBe(true);
    await expect(page.getByRole("img", { name: "8 of 8 credits left" })).toBeVisible();

    // Plan: the plan card and what's used.
    await tabs.getByRole("link", { name: "Plan" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Regular" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Credit period" })).toBeVisible();
    await expect(page.getByText("0 of 8")).toBeVisible();

    // Without JavaScript: a card opens its sheet as a page, and booking works.
    // (Reduced motion: Playwright's clicks wait for animations, which don't advance with JavaScript off.)
    const noJs = await browser.newContext({ javaScriptEnabled: false, reducedMotion: "reduce" });
    await noJs.addCookies(await page.context().cookies());
    const plain = await noJs.newPage();
    await plain.goto(`${PROD}/account/book`);
    const card = plain.getByRole("link", { name: /: Book$/ }).first();
    // The card's name is its screen-reader line, e.g. "Saturday 31 October, 9:00 am: Book".
    const cardDate = (await card.locator(".sr-only").innerText()).replace(/: Book$/, "").trim();
    await card.click();
    await expect(plain).toHaveURL(/confirm=book\./);
    await plain.getByRole("button", { name: "Book it" }).click();
    // (The message is in <noscript>, which Playwright's JavaScript-off mode doesn't render; the card shows the result.)
    await expect(plain).toHaveURL(/done=booked/);
    await expect(plain.getByRole("link", { name: `${cardDate}: Booked` })).toBeVisible();
    await noJs.close();

    // The link works once only. Sign out from the account menu.
    await page.goto(PROD + path);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.goto(`${PROD}/account`);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/sign-in\?signed=out$/);
    await expect(page.getByRole("status")).toHaveText("You're signed out.");
    await page.goto(`${PROD}/account`);
    await expect(page).toHaveURL(/\/account\/sign-in$/);
    await page.goto(PROD + path);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/link=invalid/);
    await expect(page.getByRole("status")).toContainText("expired or has already been used");
  });

  test("the account menu's pages (2026-10-28): profile, notifications and reminders, calendar sync, devices", async ({ page, request }) => {
    test.slow();
    // Colour checks read the finished colours: with motion on, a button fading after a click or a page fading in is measured half-way.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const email = `menu-${Date.now()}@example.com`;
    await seedMember(request, email);
    await askForLink(page, email);
    await page.goto(PROD + linkPath((await emailsTo(request, email))[0]));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    // The menu: every item is a real page, with its real state.
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.locator("#account-menu");
    await expect(menu.getByRole("link", { name: /^Profile and details/ })).toHaveAttribute("href", "/account/profile");
    await expect(menu.getByRole("link", { name: /^Notifications\s*Off$/ })).toHaveAttribute("href", "/account/notifications");
    await expect(menu.getByRole("link", { name: /^Calendar sync\s*Not connected$/ })).toHaveAttribute("href", "/account/calendar-sync");
    await expect(menu.getByRole("link", { name: /^Sign-in and security/ })).toHaveAttribute("href", "/account/security");

    // Profile: change the name; the greeting follows. The email can't be changed here.
    await menu.getByRole("link", { name: /^Profile and details/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your details." })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
    await page.getByLabel("Name").fill("  Sam   Tester ");
    await page.getByLabel(/^Phone/).fill("07700 900456");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved. Your details are updated.");
    await expect(page.getByLabel("Name")).toHaveValue("Sam Tester");
    await page.getByLabel("Name").fill("   ");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Please enter your name (up to 100 characters).")).toBeVisible();
    expect((await sql(request, "select full_name, phone from akb_clients where lower(email) = $1", [email]))[0]).toEqual({ full_name: "Sam Tester", phone: "07700 900456" });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // A class today, a few hours from now (for the reminder and the calendar).
    const [client] = await sql(request, "select id from akb_clients where lower(email) = $1", [email]);
    await sql(request, "select akb_member_book_class($1, 'e2e-reminder', akb_london_today(), now() + interval '3 hours', 60)", [client.id]);

    // Notifications: off until chosen; on, then the daily job sends one email, once.
    await page.goto(`${PROD}/account/notifications`);
    await expect(page.getByRole("heading", { level: 2, name: "Off" })).toBeVisible();
    await page.getByRole("button", { name: "Turn reminders on" }).click();
    await expect(page.getByRole("status")).toContainText("Class reminders are on.");
    await expect(page.getByRole("heading", { level: 2, name: "On" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const cron = { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } };
    expect((await request.get(`${PROD}/api/cron/class-reminders`)).status()).toBe(401);
    const first = await (await request.get(`${PROD}/api/cron/class-reminders`, cron)).json();
    expect(first.ok).toBe(true);
    const reminders = (await emailsTo(request, email)).filter((e) => e.payload.subject.startsWith("Reminder:"));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].payload.text).toContain("Hi Sam,");
    expect(reminders[0].payload.text).toContain("/account/notifications");
    await request.get(`${PROD}/api/cron/class-reminders`, cron);
    expect((await emailsTo(request, email)).filter((e) => e.payload.subject.startsWith("Reminder:"))).toHaveLength(1);
    await page.getByRole("button", { name: "Turn reminders off" }).click();
    await expect(page.getByRole("status")).toHaveText("Class reminders are off.");

    // Calendar sync: make the link (shown once), the feed has the class, a wrong link is a 404, turning off ends it.
    await page.goto(`${PROD}/account/calendar-sync`);
    await expect(page.getByText("Not connected.")).toBeVisible();
    await page.getByRole("button", { name: "Make my calendar link" }).click();
    const url = await page.getByLabel("Calendar link").inputValue();
    expect(url).toMatch(/\/account\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    await expect(page.getByRole("link", { name: "Add to my calendar" })).toHaveAttribute("href", /^webcal:\/\//);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const feedPath = new URL(url).pathname;
    const feed = await request.get(PROD + feedPath);
    expect(feed.headers()["content-type"]).toContain("text/calendar");
    expect(feed.headers()["cache-control"]).toContain("no-store");
    const body = await feed.text();
    expect(body).toContain("X-WR-CALNAME:");
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect((await request.get(`${PROD}/account/calendar/feed/${"A".repeat(43)}.ics`)).status()).toBe(404);
    expect((await request.get(`${PROD}/account/calendar/feed/nope.ics`)).status()).toBe(404);
    await page.goto(`${PROD}/account/calendar-sync`);
    await expect(page.getByText("A calendar link is set up.")).toBeVisible();
    await page.getByRole("button", { name: "Turn off calendar sync" }).click();
    await expect(page.getByRole("status")).toContainText("Calendar link turned off.");
    expect((await request.get(PROD + feedPath)).status()).toBe(404);

    // Phone width: no sideways scroll on any of them, and the open menu stays on screen.
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/account/profile", "/account/notifications", "/account/calendar-sync", "/account/security"]) {
      await page.goto(PROD + path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
      await page.getByRole("button", { name: "Account menu" }).click();
      const box = await page.locator("#account-menu").boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 320, `${path} menu`).toBe(true);
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    // Sign-in and security: this device, another one signed out from here, then every device.
    await sql(request, "insert into akb_member_sessions (client_id, session_hash, expires_at, device) values ($1, $2, now() + interval '30 days', 'iPhone, Safari')", [client.id, "a".repeat(64)]);
    await page.goto(`${PROD}/account/security`);
    await expect(page.getByText(/\(this device\)/)).toBeVisible();
    await expect(page.getByText("iPhone, Safari", { exact: true }).first()).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: /^Sign out iPhone, Safari/ }).click();
    await expect(page.getByRole("status")).toHaveText("That device is signed out.");
    await expect(page.getByText("iPhone, Safari", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out of every device" }).click();
    await expect(page).toHaveURL(/\/account\/sign-in\?signed=out$/);
    await page.goto(`${PROD}/account/profile`);
    await expect(page).toHaveURL(/\/account\/sign-in$/);
  });

  test("Raeng Coaching (2026-10-28): a coaching client logs a session, checks in and messages; others see the unlock page", async ({ page, request }) => {
    test.slow();
    // Colour checks read the finished colours: with motion on, a button fading after a click or a page fading in is measured half-way.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const email = `coaching-${Date.now()}@example.com`;
    // A coaching client who has never booked a class: an active subscription and a programme from Alex.
    const [client] = await sql(request, "insert into akb_clients (full_name, email, status) values ('Cora Client', $1, 'active') returning id", [email]);
    const [sub] = await sql(request, "insert into akb_subscriptions (client_id, plan, price_pence, start_on, status) values ($1, 'Online coaching', 7900, current_date, 'active') returning id", [client.id]);
    const items = [
      { week: 1, day: "Day A", position: 1, name: "Two-hand swing", sets: 2, reps: "10", load: "24 kg", note: "", video_url: "https://youtu.be/swing.demo" },
      { week: 1, day: "Day A", position: 2, name: "Strict press", sets: 2, reps: "5 each", load: "16 kg", note: "Pause at the top.", video_url: null },
      { week: 1, day: "Day B", position: 1, name: "Snatch", sets: 3, reps: "5 each", load: "16 kg", note: "", video_url: null },
    ];
    await sql(request, "select akb_coaching_save_programme($1::uuid, 'Snatch prep'::text, 'First 24 kg snatch'::text, 6, 2, akb_london_today(), $2::jsonb)", [sub.id, JSON.stringify(items)]);

    await askForLink(page, email);
    await page.goto(PROD + linkPath((await emailsTo(request, email))[0]));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    // Home: the coaching card under the next class; the menu's Coaching; the members frame is otherwise unchanged.
    const card = page.getByRole("link", { name: /Raeng Coaching\s*Week 1 of 6/ }).first();
    await expect(card).toHaveAttribute("href", "/account/coaching");
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.locator("#account-menu").getByRole("link", { name: /^Coaching\s*Week 1$/ })).toHaveAttribute("href", "/account/coaching");
    await page.keyboard.press("Escape");
    // Plan: the coaching subscription from the database.
    await page.goto(`${PROD}/account/plan`);
    await expect(page.getByText("£79 a month")).toBeVisible();
    await expect(page.getByText("Snatch prep · week 1 of 6")).toBeVisible();

    // Today: the workout, in the dark coaching frame with its own tabs.
    await page.goto(`${PROD}/account/coaching`);
    await expect(page.getByRole("heading", { level: 1, name: "Week 1, Day A." })).toBeVisible();
    await expect(page.getByRole("link", { name: /RAENG\s*COACHING/ })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Coaching" });
    await expect(tabs.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: /^Watch demo of Two-hand swing/ })).toHaveAttribute("href", "https://youtu.be/swing.demo");
    await expect(page.getByText("Pause at the top.")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByLabel("Two-hand swing set 1 weight").fill("26");
    await page.getByLabel("Two-hand swing set 1 done").check();
    await page.getByLabel("Strict press set 1 done").check();
    await expect(page.getByRole("status").filter({ hasText: "sets" })).toHaveText("2 of 4 sets");
    await page.getByLabel(/^Note for Alex/).fill("Press felt strong");
    await page.getByRole("button", { name: "Finish session" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Session logged" })).toHaveText("Session logged. Alex can see it.");
    await expect(page.getByText("Two-hand swing 1 × 10 · 26 kg")).toBeVisible();
    await expect(page.getByText("“Press felt strong”")).toBeVisible();
    // Day B is next, and last week's numbers don't exist yet.
    await page.getByRole("link", { name: /^Day B/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Week 1, Day B." })).toBeVisible();
    // Logging Day A again starts from what was logged.
    await page.goto(`${PROD}/account/coaching?day=Day%20A&relog=1`);
    await expect(page.getByLabel("Two-hand swing set 1 weight")).toHaveValue("26");
    await expect(page.getByLabel("Two-hand swing set 1 done")).toBeChecked();

    // Programme: this week's days, Day A logged.
    await tabs.getByRole("link", { name: "Programme" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Snatch prep." })).toBeVisible();
    await expect(page.getByText("First 24 kg snatch")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Day A\s*Logged/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Day B\s*To do/ })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Check-in: scores are needed; then it's sent once a week.
    await tabs.getByRole("link", { name: "Check-in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "How was your week?" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByLabel("Energy 4 of 5").check();
    await page.getByLabel("Sleep 3 of 5").check();
    await page.getByLabel("Training 5 of 5").check();
    await page.getByLabel("Wins this week").fill("All sessions in");
    await page.getByLabel(/^Form video link/).fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Send to Alex" }).click();
    // A link that isn't http(s) is refused by the server, and the form starts again.
    await expect(page.getByText("That video link doesn't look right.")).toBeVisible();
    await page.getByLabel("Energy 4 of 5").check();
    await page.getByLabel("Sleep 3 of 5").check();
    await page.getByLabel("Training 5 of 5").check();
    await page.getByLabel("Wins this week").fill("All sessions in");
    await page.getByLabel(/^Form video link/).fill("https://youtu.be/form.check");
    await page.getByRole("button", { name: "Send to Alex" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Check-in sent" })).toHaveText("Check-in sent to Alex.");
    await expect(page.getByRole("heading", { level: 1, name: "Sent. Nice work." })).toBeVisible();
    // Alex replies from the coach area; the member sees it with the check-in next week's list.
    await sql(request, "select akb_coaching_reply_check_in((select id from akb_coaching_check_ins where subscription_id = $1), 'Good week. Keep the pause.')", [sub.id]);

    // Messages: write to Alex; his reply shows a dot on the tab until it is opened.
    await tabs.getByRole("link", { name: "Messages" }).click();
    await page.getByLabel("Message Alex").fill("Is Day B fine on Saturday?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("log").getByText("Is Day B fine on Saturday?")).toBeVisible();
    await sql(request, "select akb_coaching_coach_message($1, 'Yes, any order works.')", [sub.id]);
    await page.goto(`${PROD}/account/coaching`);
    await expect(tabs.getByRole("link", { name: /Messages\s*,\s*1 new/ })).toBeVisible();
    await tabs.getByRole("link", { name: /Messages/ }).click();
    await expect(page.getByRole("log").getByText("Yes, any order works.")).toBeVisible();
    await page.goto(`${PROD}/account/coaching`);
    await expect(tabs.getByRole("link", { name: /Messages\s*,\s*1 new/ })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Phone width: no sideways scroll on any coaching page.
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/account/coaching", "/account/coaching/programme", "/account/coaching/check-in", "/account/coaching/messages", "/account/plan", "/account"]) {
      await page.goto(PROD + path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    // A coaching client has no use for the unlock page.
    await page.goto(`${PROD}/account/coaching/unlock`);
    await expect(page).toHaveURL(/\/account\/coaching$/);
    // Signed out, none of it is reachable.
    await page.context().clearCookies();
    await page.goto(`${PROD}/account/coaching/messages`);
    await expect(page).toHaveURL(/\/account\/sign-in$/);
  });

  test("a member without coaching sees no coaching card or unlock page while online coaching is off (Alex, 2026-10-29)", async ({ page, request }) => {
    test.slow();
    const email = `nocoach-${Date.now()}@example.com`;
    await seedMember(request, email);
    await askForLink(page, email);
    await page.goto(PROD + linkPath((await emailsTo(request, email))[0]));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    // Nothing is sold: no card on Home, no Coaching in the menu, no "Add coaching" on Plan.
    await expect(page.getByRole("link", { name: /Raeng Coaching/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.locator("#account-menu").getByRole("link", { name: /^Coaching/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto(`${PROD}/account/plan`);
    await expect(page.getByRole("heading", { name: "Add coaching" })).toHaveCount(0);

    // The coaching pages lead back to the members area.
    for (const path of ["/account/coaching", "/account/coaching/unlock", "/account/coaching/programme", "/account/coaching/check-in", "/account/coaching/messages"]) {
      await page.goto(PROD + path);
      await expect(page, path).toHaveURL(/\/account$/);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("a member cancels their own membership: nothing more is taken and the credits stay (owner, 2026-10-30)", async ({ page, request }) => {
    const email = `cancel-${Date.now()}@example.com`;
    await seedMember(request, email);
    await askForLink(page, email);
    await page.goto(PROD + linkPath((await emailsTo(request, email))[0]));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.goto(`${PROD}/account/plan`);
    await expect(page.getByRole("heading", { level: 2, name: "Regular" })).toBeVisible();
    // Direct Debit isn't set up here (no Stripe on this build), so the page doesn't offer it; cancelling is always there.
    await expect(page.getByRole("button", { name: "Set up Direct Debit" })).toHaveCount(0);
    await page.locator("summary", { hasText: "Cancel my membership" }).click();
    await expect(page.getByText("You keep the credits you've already paid for until the end of this period")).toBeVisible();
    await page.getByRole("button", { name: "Yes, cancel my membership" }).click();
    await expect(page.getByText(/Cancelled from/)).toBeVisible();
    const [m] = await sql(request, "select m.status, m.cancelled_on is not null as has_date from akb_memberships m join akb_clients c on c.id = m.client_id where c.email = $1", [email]);
    expect(m).toEqual({ status: "cancelled", has_date: true });
    await expect.poll(async () => (await emailsTo(request, email)).some((e) => e.payload.subject === "Your RAENG membership is cancelled")).toBe(true);
    await expect.poll(async () => (await emailsTo(request, "alex-e2e@example.com")).some((e) => e.payload.subject === "Membership cancelled: Member Tester")).toBe(true);
    // Nothing is left to cancel or set up.
    await expect(page.getByRole("button", { name: "Yes, cancel my membership" })).toHaveCount(0);
  });

  test("an address with no account gets the same answer and no email", async ({ page, request }) => {
    const email = `not-a-member-${Date.now()}@example.com`;
    await askForLink(page, email);
    await expect(page.getByRole("status")).toContainText(`If ${email} has an account`);
    expect(await emailsTo(request, email)).toHaveLength(0);
  });

  test("pay as you go (2026-10-28): the paid booking is the account; cancel for a class credit, book with it, and the form fills in", async ({ page, request }) => {
    const email = `payg-${Date.now()}@example.com`;
    // A class booked and paid online 5 days from now (as Stripe's webhook would record it).
    const [booking] = await sql(
      request,
      `select akb_create_class_booking('Pay Go', $1, '07700 900123', 'mon-evening', akb_london_today() + 5,
         ((akb_london_today() + 5)::timestamp + time '18:30') at time zone 'Europe/London', 60, 1200, 'Group class', null, $2) as r`,
      [email, `e2e-${Date.now()}`],
    );
    // Not paid yet: no account, so no email.
    await askForLink(page, email);
    expect(await emailsTo(request, email)).toHaveLength(0);
    const chargeId = booking.r.charge_id as string;
    await sql(
      request,
      `select akb_record_payment((select client_id from akb_charges where id = $1), 'group', 1200, akb_london_today(), 'card', '', '', $2,
         jsonb_build_array(jsonb_build_object('charge_id', $1::uuid, 'amount_pence', 1200)))`,
      [chargeId, `e2e-pay-${Date.now()}`],
    );

    // Paid: the same email gets a link and signs in to "Your account".
    await askForLink(page, email);
    const sent = await emailsTo(request, email);
    expect(sent).toHaveLength(1);
    await page.goto(PROD + linkPath(sent[0]));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Afternoon|Evening), Pay\.$/ })).toBeVisible();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pay as you go" })).toBeVisible();
    const place = page.locator("#booked li").filter({ hasText: "Paid" });
    await expect(place).toHaveCount(1);

    // Cancel in time: the sheet says a class credit comes back; then book another class with it, nothing to pay.
    await place.getByRole("link", { name: /^Cancel/ }).click();
    await expect(page.getByRole("dialog")).toContainText("You get a class credit for another class within 4 weeks.");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByRole("status")).toHaveText("Cancelled. You have a class credit for another class within 4 weeks.");
    await expect(page.getByRole("heading", { name: /^Class credits: 1 class/ })).toBeVisible();
    await page.getByRole("navigation", { name: "Members" }).getByRole("link", { name: "Book" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "1 class credit to use." })).toBeVisible();
    await page.getByRole("tabpanel").getByRole("link", { name: /: Use credit$/ }).first().click();
    await expect(page.getByRole("dialog")).toContainText("Uses your class credit, so there's nothing to pay.");
    await page.getByRole("dialog").getByRole("button", { name: "Book it" }).click();
    await expect(page.getByRole("status")).toHaveText("Booked with your class credit. Nothing to pay.");
    await page.getByRole("navigation", { name: "Members" }).getByRole("link", { name: "Home" }).click();
    await expect(page.locator("#booked li").filter({ hasText: "Class credit" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /^Class credits:/ })).toHaveCount(0);

    // The page passes an accessibility scan.
    await page.waitForTimeout(800);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Signed in, the booking form fills in their details.
    await page.goto(`${PROD}/book/group-class`);
    await page.evaluate(() => sessionStorage.clear());
    const response = await page.request.get(`${PROD}/api/account/details`);
    expect(await response.json()).toEqual({ name: "Pay Go", email, phone: "07700 900123" });
    // Signed out, the details API says nothing.
    const anon = await request.get(`${PROD}/api/account/details`);
    expect(await anon.json()).toEqual({});
  });

  test("a made-up or broken link signs nobody in", async ({ page }) => {
    await page.goto(`${PROD}/account/confirm?token=nope`);
    await expect(page.getByRole("heading", { level: 1, name: "Link not valid." })).toBeVisible();
    await page.goto(`${PROD}/account/confirm?token=${"A".repeat(43)}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/link=invalid/);
  });

  test("speed (2026-11-02): a tab tap answers at once with the page's shape while a slow server answers, and a pressed button says so", async ({ page, request }) => {
    test.slow();
    const email = `speed-${Date.now()}@example.com`;
    await seedMember(request, email);
    await askForLink(page, email);
    await page.goto(PROD + linkPath((await emailsTo(request, email))[0]));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    // The server now answers every page and action 1.5 s late (the shapes sent ahead by prefetching come at once).
    await page.route("**/account/**", async (route) => {
      const request = route.request();
      const prefetch = request.headers()["next-router-prefetch"];
      if (!prefetch) await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    // Give the phone a moment to receive the loading shapes it prefetches for the tab bar.
    await page.waitForTimeout(1500);

    await page.getByRole("navigation", { name: "Members" }).getByRole("link", { name: "Plan" }).click();
    // At once (well before the 1.5 s): the loading screen, the same header and tab bar, nothing missing.
    await expect(page.locator('[aria-busy="true"]').first()).toBeAttached({ timeout: 700 });
    await expect(page.getByText("Loading your page…")).toBeAttached();
    await expect(page.getByRole("heading", { level: 1, name: "Your membership." })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

    // A button that talks to the server says it was pressed, and can't be pressed twice.
    await page.goto(`${PROD}/account/profile`);
    const save = page.getByRole("button", { name: "Save details" });
    await save.click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled({ timeout: 700 });
    await expect(page.getByRole("button", { name: "Save details" })).toBeVisible({ timeout: 10_000 });
    await page.unroute("**/account/**");
  });

  test("the menu and footer link to member sign-in, and robots keep /account out", async ({ page, request }) => {
    await page.goto(PROD);
    await expect(page.locator("footer").getByRole("link", { name: "Member Login", exact: true })).toHaveAttribute("href", "/account/sign-in");
    const robots = await (await request.get(`${PROD}/robots.txt`)).text();
    expect(robots).toContain("Disallow: /account");
    const sitemap = await (await request.get(`${PROD}/sitemap.xml`)).text();
    expect(sitemap).not.toContain("/account");
  });
});

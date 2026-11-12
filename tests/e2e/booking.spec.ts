import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { demoAvailability } from "../../src/lib/availability/demo";
import { formatLongDate, toDateKey } from "../../src/lib/availability/dates";
import { classAvailability } from "../../src/lib/availability/timetable";
import { timetable } from "../../src/content/classes";
import { dayStatus } from "../../src/lib/availability/types";

/**
 * Booking and online coaching journeys.
 * - Main server (baseURL): booking demo mode on, email wired to the mock.
 * - Production server: VERCEL_ENV=production with BOOKING_DEMO and
 *   CONTENT_PREVIEW set by mistake; both must be ignored.
 */
const PROD = `http://localhost:${process.env.E2E_PRODUCTION_PORT ?? 3201}`;
const MOCK = `http://localhost:${process.env.MOCK_EMAIL_PORT ?? 3299}`;
const SUPABASE = `http://localhost:${process.env.MOCK_SUPABASE_PORT ?? 3298}`;

interface StoredRow {
  idempotency_key: string;
  kind: string;
  service: string;
  summary: string;
  name: string;
  email: string;
  details: Record<string, string>;
}

async function stored(request: APIRequestContext): Promise<StoredRow[]> {
  return (await (await request.get(`${SUPABASE}/stored`)).json()) as StoredRow[];
}

interface RecordedEmail {
  headers: { authorization?: string; idempotencyKey?: string };
  payload: { from: string; to: string[]; reply_to: string; subject: string; text: string };
}

async function emails(request: APIRequestContext): Promise<RecordedEmail[]> {
  return (await (await request.get(`${MOCK}/requests`)).json()) as RecordedEmail[];
}

const continueButton = (page: Page) => page.getByRole("button", { name: "Continue" });

/** Ticks a styled radio/checkbox tile by its visible text. */
async function choose(page: Page, label: string) {
  await page.locator("label").filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
}

/** Clicks a calendar date the way a visitor does: on its cell. */
async function pickDate(page: Page, label: string) {
  const input = page.getByLabel(label);
  await page.locator("label").filter({ has: input }).click();
  await expect(input).toBeChecked();
}

/** The first demo date with a free slot, and the available dates shown in its month (the calendar opens there). */
function firstAvailable(service: "group-class" | "one-to-one") {
  const window = demoAvailability(service, toDateKey(new Date()));
  const day = window.days.find((d) => dayStatus(d) === "available")!;
  const shown = window.days.filter((d) => dayStatus(d) === "available" && d.date.slice(0, 7) === day.date.slice(0, 7));
  return { window, day, shown, slot: day.slots.find((s) => s.available)! };
}

test.describe("booking prototype (demo availability)", () => {
  test("/book → group class → sample date → clearly labelled prototype outcome", async ({ page, request }) => {
    // The flow is no longer linked from public pages (bookings go via /contact); open it directly.
    await page.goto("/book");
    await expect(page.getByRole("note", { name: "Demonstration" })).toContainText("Prototype booking page");

    // Step 1: nothing chosen → can't continue.
    await expect(continueButton(page)).toBeDisabled();
    await expect(page.getByText("Choose a service to continue.")).toBeVisible();
    await choose(page, "Group class");
    await continueButton(page).click();

    // Step 2: labelled sample availability; full and empty dates can't be chosen.
    await expect(page.getByRole("heading", { name: "Choose a class" })).toBeFocused();
    await expect(page.getByText("Sample availability, not Alex's real timetable")).toBeVisible();
    const { day, shown, slot } = firstAvailable("group-class");
    await expect(page.locator('[data-status="available"]')).toHaveCount(shown.length);
    // Fully booked and session-free dates can't be chosen.
    for (const input of await page.locator('[data-status="full"] input, [data-status="none"] input').all()) {
      await expect(input).toBeDisabled();
    }
    await expect(continueButton(page)).toBeDisabled();
    await pickDate(page, `${formatLongDate(day.date)}, available`);
    await expect(continueButton(page)).toBeDisabled();
    await page.locator("#times label").filter({ hasNotText: "Full" }).first().click();
    await expect(page.getByRole("complementary", { name: "Your selection (demonstration)" })).toContainText("Group class");
    await continueButton(page).click();

    // Step 3: validation, then the demo outcome.
    await expect(page.getByRole("heading", { name: "Your details" })).toBeFocused();
    await page.getByRole("button", { name: "Finish demo" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter your email address so Alex can reply.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
    await expect(page.getByRole("radio", { name: "Beginner" })).toBeChecked();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("Demo Visitor");
    await page.getByRole("textbox", { name: "Email" }).fill("not-an-email");
    await page.getByRole("button", { name: "Finish demo" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await page.getByRole("textbox", { name: "Email" }).fill("demo@example.com");
    await page.getByRole("button", { name: "Finish demo" }).click();

    const outcome = page.getByRole("status");
    await expect(outcome).toContainText("Demonstration complete");
    await expect(outcome).toContainText("No booking has been made");
    await expect(outcome).toContainText(formatLongDate(day.date));
    await expect(page.getByText(/booking (is )?confirmed/i)).toHaveCount(0);
    expect(slot.available).toBe(true);
    // Nothing is sent for demonstration selections.
    expect((await emails(request)).some((e) => e.payload.text.includes("Demo Visitor"))).toBe(false);
  });

  test("one-to-one starts at its own availability, different from classes", async ({ page }) => {
    await page.goto("/book/one-to-one");
    await expect(page.getByRole("heading", { name: "Choose a date and time" })).toBeVisible();
    const { window, shown } = firstAvailable("one-to-one");
    await expect(page.locator('[data-status="available"]')).toHaveCount(shown.length);
    const group = firstAvailable("group-class").window.days.map((d) => d.date);
    expect(window.days.map((d) => d.date)).not.toEqual(group);

    // Taken one-to-one times show as full and can't be chosen.
    const withTaken = shown.find((d) => d.slots.some((s) => !s.available));
    if (withTaken) {
      await pickDate(page, `${formatLongDate(withTaken.date)}, available`);
      await expect(page.locator("#times label").filter({ hasText: "Full" }).locator("input")).toBeDisabled();
    }
  });

  test("back, stepper and summary edits keep or reset choices sensibly", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/book/group-class");
    const { day } = firstAvailable("group-class");
    await pickDate(page, `${formatLongDate(day.date)}, available`);
    await page.locator("#times label").filter({ hasNotText: "Full" }).first().click();
    await continueButton(page).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Kept Name");

    // Back keeps the chosen date and time.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel(`${formatLongDate(day.date)}, available`)).toBeChecked();
    await continueButton(page).click();
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Kept Name");

    // Changing the service from the summary clears the old date.
    const summary = page.getByRole("complementary", { name: "Your selection (demonstration)" });
    await summary.getByRole("button", { name: "Change service" }).click();
    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeFocused();
    await choose(page, "1:1 personal coaching");
    await continueButton(page).click();
    await expect(summary).toContainText("1:1 personal coaching");
    await expect(summary.getByText("Not chosen yet")).toBeVisible();

    // Completed steps in the stepper can be revisited.
    await page.getByRole("navigation", { name: "Booking steps" }).getByRole("button", { name: /Service/ }).click();
    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
  });

  test("works from the keyboard with visible focus", async ({ page }) => {
    await page.goto("/book");
    await page.locator("#service").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /1:1 personal coaching/ })).toBeChecked();
    const tile = page.locator("label").filter({ has: page.getByRole("radio", { name: /1:1 personal coaching/ }) });
    expect(await tile.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await continueButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Choose a date and time" })).toBeFocused();

    // Arrow keys move between dates that can be chosen.
    const dates = page.locator('input[name="date"]:not([disabled])');
    await dates.first().focus();
    await page.keyboard.press("Space");
    await expect(dates.first()).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(dates.nth(1)).toBeChecked();
  });

  test("step changes are not animated for reduced-motion users", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/book");
    await choose(page, "Group class");
    await continueButton(page).click();
    const duration = await page.locator(".animate-step-in").first().evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
  });

  for (const width of [320, 360, 390, 768, 1024, 1366, 1440]) {
    test(`calendar and summary fit without overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/book/group-class");
      await expect(page.getByTestId("calendar-grid")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const offscreen = await page.$$eval("main a, main button, main label", (els) =>
        els.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length,
      );
      expect(offscreen).toBe(0);
      // Calendar dates are tall enough to tap.
      const cell = await page.locator('[data-status="available"]').first().boundingBox();
      expect(cell!.height).toBeGreaterThanOrEqual(44);
      // The next step stays in reach on phones.
      if (width < 1024) await expect(continueButton(page)).toBeInViewport();
    });
  }

  test("the calendar step has no accessibility violations", async ({ page }) => {
    await page.goto("/book/group-class");
    await expect(page.getByTestId("calendar-grid")).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("online coaching onboarding", () => {
  test("site navigation → tailored questions → review → sent to Alex", async ({ page, request }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Online coaching" }).click();
    await expect(page).toHaveURL(/\/online-coaching$/);
    await expect(page.getByRole("radio", { name: /Get stronger/ })).toBeVisible();
    // Worded as an enquiry, never as signing up.
    await expect(page.getByRole("heading", { level: 1, name: "Ask about online coaching" })).toBeVisible();
    await expect(page.getByText("This is an enquiry, not a sign-up: nothing is booked and there's nothing to pay.")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/get started|sign up|join now/i);
    // Not a calendar booking.
    await expect(page.getByTestId("calendar-grid")).toHaveCount(0);

    // Progressive disclosure: "Something else" asks for detail.
    await expect(continueButton(page)).toBeDisabled();
    await choose(page, "Something else");
    await expect(continueButton(page)).toBeDisabled();
    await page.getByLabel("Tell Alex what you'd like to achieve").fill("Prepare for a kettlebell sport event");
    await continueButton(page).click();

    await expect(page.getByRole("heading", { name: "Your training" })).toBeFocused();
    await choose(page, "Some experience");
    await continueButton(page).click();

    // Phone is only asked for when chosen, and then required.
    await expect(page.getByRole("textbox", { name: "Phone" })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Name" }).fill("Online Tester");
    await page.getByRole("textbox", { name: "Email" }).fill("online@example.com");
    await choose(page, "Phone");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText("Enter your phone number.")).toBeVisible();
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByRole("button", { name: "Review" }).click();

    await expect(page.getByRole("heading", { name: "Review and send" })).toBeFocused();
    await expect(page.getByText("Prepare for a kettlebell sport event")).toBeVisible();
    // Edit an answer and come back.
    await page.getByRole("button", { name: "Edit training" }).click();
    await choose(page, "I train with kettlebells regularly");
    await continueButton(page).click();
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText("I train with kettlebells regularly")).toBeVisible();

    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send to Alex" }).click();
    await expect(page.getByRole("status")).toContainText("Alex will reply personally");

    const sent = (await emails(request)).find((e) => e.payload.subject === "Online coaching enquiry: Online Tester");
    expect(sent).toBeDefined();
    expect(sent!.payload.reply_to).toBe("online@example.com");
    expect(sent!.payload.text).toContain("Main goal: Something else: Prepare for a kettlebell sport event");
    expect(sent!.payload.text).toContain("Prefers contact by: Phone (07700 900123)");
  });

  test("an email-service failure is reported, never shown as sent", async ({ page }) => {
    await page.goto("/online-coaching");
    await choose(page, "Get stronger");
    await continueButton(page).click();
    await choose(page, "New to kettlebells");
    await continueButton(page).click();
    await page.getByRole("textbox", { name: "Name" }).fill("FAIL-TEST Online");
    await page.getByRole("textbox", { name: "Email" }).fill("fail@example.com");
    await page.getByRole("button", { name: "Review" }).click();
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send to Alex" }).click();
    await expect(page.locator("main [role=alert]")).toContainText("couldn't be sent");
    await expect(page.getByText("Enquiry sent")).toHaveCount(0);
  });
});

test.describe("production configuration", () => {
  for (const path of ["/", "/book", "/book/group-class", "/book/one-to-one", "/book/small-group", "/coaching", "/online-coaching", "/classes"]) {
    test(`${path} shows no demonstration availability or provisional content`, async ({ page }) => {
      await page.goto(PROD + path);
      await page.waitForLoadState("networkidle");
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(/\bdemo\b|demonstration|sample availability|prototype/i);
      expect(text).not.toMatch(/awaiting confirmation/i);
    });
  }

  test("the primary button opens the booking page", async ({ page }) => {
    await page.goto(PROD);
    await expect(page.getByRole("link", { name: "Book now" }).first()).toHaveAttribute("href", "/book");
    const sitemap = await (await page.request.get(`${PROD}/sitemap.xml`)).text();
    expect(sitemap).toContain("/book/group-class");
    await page.goto(`${PROD}/book`);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });

  test("a group class request uses a real class date, is stored for the coach area and emailed", async ({ page, request }) => {
    await page.goto(`${PROD}/book/group-class`);
    await expect(page.getByRole("heading", { name: "Choose a class" })).toBeVisible();
    await expect(page.getByText("Pick a date. Alex confirms every place personally.")).toBeVisible();
    await expect(continueButton(page)).toBeDisabled();

    // Only real class dates from the confirmed timetable can be chosen.
    const window = classAvailability(timetable.sessions, toDateKey(new Date()));
    const day = window.days[0];
    const shown = window.days.filter((d) => d.date.slice(0, 7) === day.date.slice(0, 7));
    await expect(page.locator('[data-status="available"]')).toHaveCount(shown.length);
    await pickDate(page, `${formatLongDate(day.date)}, available`);
    await page.locator("#times label").first().click();

    // The class is described like Alex's own listing.
    await expect(page.getByText(`${day.slots[0].name} · `)).toBeVisible();
    await expect(page.getByText(/1 hr · £10 per person · with Alex/)).toBeVisible();
    await expect(page.getByText("Pay by bank transfer or cash.")).toHaveCount(0);
    await continueButton(page).click();

    await expect(page.getByRole("radio", { name: "Beginner" })).toBeChecked();
    await page.getByRole("button", { name: "LET'S GET TO WORK" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await choose(page, "Advanced");
    await page.getByRole("textbox", { name: "Name" }).fill("Prod Booker");
    await page.getByRole("textbox", { name: "Email" }).fill("prod@example.com");
    await page.getByRole("button", { name: /add a note/i }).click();
    await page.getByLabel(/^Note/).fill("First class");
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "LET'S GET TO WORK" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("Request sent");
    await expect(status).toContainText("prod@example.com");
    await expect(status).toContainText("booked once he confirms");

    const year = new Date(`${day.date}T12:00:00`).getFullYear();
    const summary = `${formatLongDate(day.date)} ${year}`;
    const row = (await stored(request)).find((r) => r.name === "Prod Booker");
    expect(row).toMatchObject({ kind: "booking", service: "Group classes", email: "prod@example.com", details: { experience: "Advanced" } });
    expect(row!.summary).toContain(summary);

    const sent = (await emails(request)).find((e) => e.payload.subject === "Group classes booking request: Prod Booker");
    expect(sent).toBeDefined();
    expect(sent!.payload.to).toEqual(["alex-e2e@example.com"]);
    expect(sent!.payload.text).toContain(`Class: ${summary}`);
    expect(sent!.payload.text).toContain("not a confirmed booking");
    expect(sent!.headers.idempotencyKey).toBe(row!.idempotency_key);

    // Alex sees it in the coach area.
    await page.goto(`${PROD}/coach/login`);
    await page.getByLabel("Email").fill("coach-e2e@example.com");
    await page.getByLabel("Password").fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/coach$/);
    await expect(page.getByRole("link", { name: /New request: Prod Booker/ }).first()).toBeVisible();
    await page.goto(`${PROD}/coach/requests`);
    const listed = page.getByRole("link", { name: /Prod Booker/ }).first();
    await expect(listed).toContainText(summary);
    await listed.click();
    await expect(page.getByRole("heading", { level: 1, name: "Prod Booker" })).toBeVisible();
    await expect(page.getByRole("link", { name: "prod@example.com" })).toHaveAttribute("href", "mailto:prod@example.com");
    await expect(page.getByText("A request is not a booking until you confirm it here.")).toBeVisible();
    // The email alert to Alex is recorded as sent.
    await expect(page.locator("dt", { hasText: "Email alert" }).locator("xpath=following-sibling::dd")).toContainText(/^Sent /);
  });

  test("/book offers group classes, 1:1 personal coaching and a small group enquiry", async ({ page }) => {
    await page.goto(`${PROD}/book`);
    const options = page.getByRole("radio");
    await expect(options).toHaveCount(3);
    await expect(page.getByRole("radio", { name: /^Group classes/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^1:1 personal coaching/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Small group coaching enquiry/ })).toBeVisible();
  });

  test("a 1:1 request must pick the single session or the monthly package, shown with the published prices", async ({ page }) => {
    await page.goto(`${PROD}/book/one-to-one`);
    await choose(page, "Fri");
    await expect(continueButton(page)).toBeDisabled();
    await expect(page.getByText("Choose an option to continue.")).toBeVisible();
    await expect(page.getByText("Select the days and times that work best for you.", { exact: false })).toContainText("does not guarantee a booking");
    const single = page.locator("label").filter({ has: page.getByRole("radio", { name: /^Single 1:1 session/ }) });
    const monthly = page.locator("label").filter({ has: page.getByRole("radio", { name: /^Monthly package/ }) });
    await expect(single).toContainText("£35 per session");
    await expect(monthly).toContainText("£130 per month · 4 sessions");
    await monthly.click();
    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();
    await expect(page.getByRole("complementary", { name: "Your booking request" })).toContainText("Monthly package (4 sessions)");
  });

  test("a small group enquiry is stored and emailed as its own service, never as a booking", async ({ page, request }) => {
    await page.goto(`${PROD}/book/small-group`);
    await expect(page.getByRole("heading", { level: 1, name: "Small group coaching enquiry" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "When suits you?" })).toBeVisible();
    await expect(page.getByText("Please note that submitting a request does not guarantee a booking.")).toBeVisible();
    await choose(page, "Sat");
    await choose(page, "Morning");
    await continueButton(page).click();
    await choose(page, "Beginner");
    await page.getByRole("textbox", { name: "Name" }).fill("Group Enquirer");
    await page.getByRole("textbox", { name: "Email" }).fill("group-enquirer@example.com");
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send enquiry" }).click();
    const status = page.getByRole("status");
    await expect(status).toContainText("Enquiry sent");
    await expect(status).toContainText("does not guarantee a place");
    await expect(status).not.toContainText("booked once he confirms");

    const row = (await stored(request)).find((r) => r.name === "Group Enquirer");
    expect(row).toMatchObject({ kind: "booking", service: "Small group coaching enquiry" });
    const mail = (await emails(request)).find((e) => e.payload.subject.includes("Group Enquirer"));
    expect(mail?.payload.subject).toBe("Small group coaching enquiry from Group Enquirer");
    expect(mail?.payload.text).toContain("Preferred: Sat · Morning");
  });

  test("class dates show the places left, and a booked place is counted", async ({ page, request }) => {
    // One confirmed place on the last class date in the window; every other date is untouched.
    const window = classAvailability(timetable.sessions, toDateKey(new Date()));
    const last = window.days.at(-1)!;
    const slot = timetable.sessions.find((s) => s.name === last.slots[0].name)!;
    const headers = { apikey: "sb_secret_e2e", "Content-Type": "application/json", Prefer: "return=representation" };
    const startsAt = new Date(`${last.date}T${slot.start}:00Z`).toISOString();
    const cls = (await (await request.post(`${SUPABASE}/rest/v1/akb_class_sessions`, { headers, data: { slot: slot.id, class_date: last.date, starts_at: startsAt, duration_minutes: 60 } })).json()) as { id: string }[];
    const client = (await (await request.post(`${SUPABASE}/rest/v1/akb_clients`, { headers, data: { full_name: "Spaces Seed", email: "spaces-seed@example.com" } })).json()) as { id: string }[];
    await request.post(`${SUPABASE}/rest/v1/akb_class_attendance`, { headers, data: { class_session_id: cls[0].id, client_id: client[0].id } });

    await page.goto(`${PROD}/book/group-class`);
    // An untouched date: all 15 places.
    const first = window.days[0];
    await pickDate(page, `${formatLongDate(first.date)}, available`);
    await expect(page.locator("#times")).toContainText("15 Spaces Remaining");
    await expect(page.locator("#times")).toContainText(first.slots[0].name!);
    // The date with one place taken.
    if (last.date.slice(0, 7) !== first.date.slice(0, 7)) await page.getByRole("button", { name: "Next month" }).click();
    await pickDate(page, `${formatLongDate(last.date)}, available`);
    await expect(page.locator("#times")).toContainText("14 Spaces Remaining");
  });

  test("when the email provider is down, the request is still stored, flagged and retried without duplicates", async ({ page, request }) => {
    await page.goto(`${PROD}/book/one-to-one`);
    await choose(page, "Wed");
    await expect(continueButton(page)).toBeDisabled(); // the 1:1 option is needed too
    await choose(page, "Monthly package");
    await continueButton(page).click();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("EMAIL-DOWN Booker");
    await page.getByRole("textbox", { name: "Email" }).fill("email-down@example.com");
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "LET'S GET TO WORK" }).click();
    // Stored, so the visitor is told it was sent; nothing claims a confirmed booking.
    await expect(page.getByRole("status")).toContainText("Request sent");
    await expect(page.getByRole("status")).toContainText("booked once he confirms");

    const row = (await stored(request)).find((r) => r.name === "EMAIL-DOWN Booker") as (StoredRow & Record<string, unknown>) | undefined;
    expect(row).toMatchObject({ kind: "booking", service: "1:1 personal coaching", alert_status: "failed", alert_attempts: 1, alert_error: "http-503" });
    expect(row!.details).toMatchObject({ option: "Monthly package (4 sessions)" });
    expect(String(row!.alert_subject)).toBe("1:1 personal coaching booking request: EMAIL-DOWN Booker");
    // One quick retry, with the same idempotency key, and no email delivered.
    const refused = (await (await request.get(`${MOCK}/refused`)).json()) as { idempotencyKey: string; subject: string }[];
    const attempts = refused.filter((r) => r.subject.includes("EMAIL-DOWN Booker"));
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((a) => a.idempotencyKey))).toEqual(new Set([row!.idempotency_key]));
    expect((await emails(request)).some((e) => e.payload.subject.includes("EMAIL-DOWN"))).toBe(false);

    // Alex sees it in the coach area, flagged.
    await page.goto(`${PROD}/coach/login`);
    await page.getByLabel("Email").fill("coach-e2e@example.com");
    await page.getByLabel("Password").fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/coach$/);
    await page.goto(`${PROD}/coach/requests`);
    await page.getByRole("link", { name: /EMAIL-DOWN Booker/ }).first().click();
    await expect(page.locator("dt", { hasText: "Email alert" }).locator("xpath=following-sibling::dd")).toContainText("Not sent yet (1 try)");
  });

  test("Square endpoints are off until Square is configured, and never accept unsigned calls", async ({ request }) => {
    const hook = await request.post(`${PROD}/api/square/webhook`, {
      data: { type: "payment.updated", event_id: "evt-e2e", data: { type: "payment", id: "PAY-E2E" } },
      headers: { "x-square-hmacsha256-signature": "forged" },
    });
    expect(hook.status()).toBe(404);
    expect(await hook.json()).toEqual({ error: "not-configured" });
    expect((await request.get(`${PROD}/api/square/webhook`)).status()).toBe(405);
    expect((await request.get(`${PROD}/api/cron/square-reconcile`)).status()).toBe(401);
    const cron = await request.get(`${PROD}/api/cron/square-reconcile`, { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
    expect(await cron.json()).toEqual({ skipped: "not-configured" });
  });

  test("the alert retry endpoint needs the cron secret and returns counts only", async ({ request }) => {
    for (const authorization of [undefined, "Bearer wrong-secret-0123456789", "e2e-cron-secret-0123456789"]) {
      const res = await request.get(`${PROD}/api/cron/request-alerts`, { headers: authorization ? { authorization } : {} });
      expect(res.status(), String(authorization)).toBe(401);
    }
    const ok = await request.get(`${PROD}/api/cron/request-alerts`, { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
    expect(ok.status()).toBe(200);
    expect(ok.headers()["cache-control"]).toContain("no-store");
    const body = (await ok.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["failed", "found", "ok", "sent"]);
    expect(body.ok).toBe(true);
  });

  test("when neither storage nor email accepts a request, it shows an error, not success", async ({ page }) => {
    await page.goto(`${PROD}/book/one-to-one`);
    await choose(page, "Sun");
    await choose(page, "Single 1:1 session");
    await continueButton(page).click();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("FAIL-TEST Booker");
    await page.getByRole("textbox", { name: "Email" }).fill("fail@example.com");
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "LET'S GET TO WORK" }).click();
    await expect(page.locator("main [role=alert]")).toContainText("couldn't be sent");
    await expect(page.getByText("Request sent")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("FAIL-TEST Booker");
  });

  test("a bot-speed submission is rejected without claiming success", async ({ page, request }) => {
    await page.goto(`${PROD}/book/one-to-one`);
    await choose(page, "Tue");
    await choose(page, "Single 1:1 session");
    await continueButton(page).click();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("Speedy Bot");
    await page.getByRole("textbox", { name: "Email" }).fill("bot@example.com");
    await page.locator('input[name="startedAt"]').evaluate((el: HTMLInputElement) => (el.value = String(Date.now())));
    await page.getByRole("button", { name: "LET'S GET TO WORK" }).click();
    await expect(page.locator("main [role=alert]")).toContainText("Please wait a few seconds");
    await expect(page.getByText("Request sent")).toHaveCount(0);
    expect((await emails(request)).some((e) => e.payload.subject.includes("Speedy Bot"))).toBe(false);
  });

  test("the server refuses demonstration selections even if posted directly", async ({ page }) => {
    // Posting a demo slot id through the real form must never become a request.
    await page.goto(`${PROD}/book/one-to-one`);
    await choose(page, "Thu");
    await choose(page, "Single 1:1 session");
    await continueButton(page).click();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("Slot Poster");
    await page.getByRole("textbox", { name: "Email" }).fill("slot@example.com");
    await page.locator("form").evaluate((form) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "slot";
      input.value = "demo-one-to-one-2026-10-20-07:00";
      form.appendChild(input);
    });
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "LET'S GET TO WORK" }).click();
    await expect(page.locator("main [role=alert]")).toContainText("Demonstration times can't be booked");
  });

  test("the demonstration data is downloaded only in demo mode", async ({ browser }) => {
    // The demo pattern's class time (19:00) appears nowhere else in the site's code.
    const loadsDemo = async (url: string) => {
      const page = await browser.newPage();
      const bodies: Promise<string>[] = [];
      page.on("response", (res) => {
        if (res.url().endsWith(".js")) bodies.push(res.text().catch(() => ""));
      });
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const found = (await Promise.all(bodies)).some((b) => b.includes('"19:00"'));
      await page.close();
      return found;
    };
    expect(await loadsDemo("http://localhost:" + (process.env.E2E_PORT ?? 3200) + "/book/group-class")).toBe(true);
    expect(await loadsDemo(`${PROD}/book/group-class`)).toBe(false);
  });
});

test.describe("going back in the booking wizard", () => {
  test("the first step's Back returns to the page you came from", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // straight to /book, no intro
    await page.goto("/classes");
    await page.goto("/book");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/classes$/);
  });

  test("the phone's back gesture (browser Back) goes to the previous step, not off the page", async ({ page }) => {
    await page.goto("/book");
    await choose(page, "Group class");
    await continueButton(page).click();
    await expect(page.getByRole("heading", { name: "Choose a class" })).toBeVisible();
    await expect(page).toHaveURL(/\/book#when$/);

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
    await expect(page).toHaveURL(/\/book$/);
    // The choice is kept.
    await expect(page.getByRole("radio", { name: /Group class/ })).toBeChecked();

    await page.goForward();
    await expect(page.getByRole("heading", { name: "Choose a class" })).toBeVisible();

    // The on-page Back button walks the same history.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
    await expect(page).toHaveURL(/\/book$/);
  });
});

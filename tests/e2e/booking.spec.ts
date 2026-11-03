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
    // The phone number is required (owner, 2026-10-30), and so are the participation and risk terms.
    await page.getByRole("button", { name: "Finish demo" }).click();
    await expect(page.getByText("Enter your phone number.")).toBeVisible();
    await expect(page.getByText("Please tick to confirm you have read and agree to the health and risk terms.")).toBeVisible();
    await expect(page.getByText("Health and risk terms", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
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
    await choose(page, "One-to-one");
    await continueButton(page).click();
    await expect(summary).toContainText("One-to-one");
    await expect(summary.getByText("Not chosen yet")).toBeVisible();

    // Completed steps in the stepper can be revisited.
    await page.getByRole("navigation", { name: "Booking steps" }).getByRole("button", { name: /Service/ }).click();
    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
  });

  test("works from the keyboard with visible focus", async ({ page }) => {
    await page.goto("/book");
    await page.locator("#service").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /One-to-one/ })).toBeChecked();
    const tile = page.locator("label").filter({ has: page.getByRole("radio", { name: /One-to-one/ }) });
    expect(await tile.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await continueButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Choose a date and time" })).toBeFocused();

    // Arrow keys move between dates that can be chosen. Late in a month the
    // calendar can open with only one left, so use the next month then.
    const dates = page.locator('input[name="date"]:not([disabled])');
    const nextMonth = page.getByRole("button", { name: "Next month" });
    // Let the calendar finish drawing before counting what can be chosen (counting early read none and jumped a month, at random).
    await page.getByRole("group", { name: /Date/ }).getByRole("radio").first().waitFor();
    await dates.first().waitFor({ timeout: 3000 }).catch(() => undefined); // late in a month there may be none left
    if ((await dates.count()) < 2 && (await nextMonth.isEnabled())) await nextMonth.click();
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

// The online coaching enquiry journey (site → questions → review → sent to Alex) is off the site for now
// (Alex, 2026-10-29: "something I'll come into at a later time"); site.spec.ts checks the redirect.
// The code stays (components/booking/OnlineOnboarding, lib/online-enquiry); restore these tests from git history when it returns.

test.describe("production configuration", () => {
  for (const path of ["/", "/book", "/book/group-class", "/book/one-to-one", "/online-coaching", "/online-coaching/enquire", "/classes", "/about"]) {
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
    // The hero button reads "Book a class" (Alex, 2026-10-29); the header has no Book now.
    await expect(page.getByRole("link", { name: "Book a class" }).first()).toHaveAttribute("href", "/book/group-class");
    const sitemap = await (await page.request.get(`${PROD}/sitemap.xml`)).text();
    expect(sitemap).toContain("/book/group-class");
    await page.goto(`${PROD}/book`);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });

  test("a class chosen on the home page's tiles arrives with its next date and time chosen", async ({ page }) => {
    await page.goto(`${PROD}/book/group-class?class=wed-evening`);
    await expect(page.getByRole("heading", { name: "Choose a class" })).toBeVisible();
    await expect(page.getByText(/· Wednesday class/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    // It can still be changed: choosing another date in that month clears the time.
    const days = classAvailability(timetable.sessions, toDateKey(new Date())).days;
    const wed = days.find((d) => new Date(`${d.date}T12:00:00`).getDay() === 3)!;
    const other = days.find((d) => d.date !== wed.date && d.date.slice(0, 7) === wed.date.slice(0, 7));
    if (other) {
      await pickDate(page, `${formatLongDate(other.date)}, available`);
      await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    }
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
    // (Another test may fill one class up meanwhile: available or fully booked, every class date is shown.)
    await expect(page.locator('[data-status="available"], [data-status="full"]')).toHaveCount(shown.length);
    await pickDate(page, `${formatLongDate(day.date)}, available`);
    // How full the class is shows beside each time (owner, 2026-10-30).
    await expect(page.locator("#times").getByText(/\d+ places? left/).first()).toBeVisible();
    await page.locator("#times label").first().click();

    // The class is described like Alex's own listing.
    await expect(page.getByText("Kettlebell Training ·")).toBeVisible();
    await expect(page.getByText(/1 hr · All levels · with Alex/)).toBeVisible();
    await expect(page.getByText("Pay by bank transfer or cash.")).toHaveCount(0);
    await continueButton(page).click();

    await expect(page.getByRole("radio", { name: "Beginner" })).toBeChecked();
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await choose(page, "Advanced");
    await page.getByRole("textbox", { name: "Name" }).fill("Prod Booker");
    await page.getByRole("textbox", { name: "Email" }).fill("prod@example.com");
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.getByRole("button", { name: /add a note/i }).click();
    await page.getByLabel(/^Note/).fill("First class");
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send request" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("Request sent");
    await expect(status).toContainText("prod@example.com");
    await expect(status).toContainText("booked once he confirms");
    // It carries a reference, and the same reference is in the email they get.
    const reference = (await status.innerText()).match(/RAENG-[0-9A-F]{8}/)?.[0];
    expect(reference).toBeDefined();
    // The person is told it was received (and that it isn't confirmed yet), as well as Alex.
    await expect
      .poll(async () => (await emails(request)).some((e) => e.payload.to.includes("prod@example.com") && e.payload.subject.startsWith("We've received your request") && e.payload.text.includes("not a confirmed booking") && e.payload.text.includes(`Your reference: ${reference}`)))
      .toBe(true);

    const year = new Date(`${day.date}T12:00:00`).getFullYear();
    const summary = `${formatLongDate(day.date)} ${year}`;
    const row = (await stored(request)).find((r) => r.name === "Prod Booker");
    expect(row).toMatchObject({ kind: "booking", service: "Group class", email: "prod@example.com", details: { experience: "Advanced" } });
    expect(row!.summary).toContain(summary);

    const sent = (await emails(request)).find((e) => e.payload.subject === "Group class booking request: Prod Booker");
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

  test("when the email provider is down, the request is still stored, flagged and retried without duplicates", async ({ page, request }) => {
    await page.goto(`${PROD}/book/one-to-one`);
    await choose(page, "Wed");
    await continueButton(page).click();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("EMAIL-DOWN Booker");
    await page.getByRole("textbox", { name: "Email" }).fill("email-down@example.com");
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send request" }).click();
    // Stored, so the visitor is told it was sent; nothing claims a confirmed booking.
    await expect(page.getByRole("status")).toContainText("Request sent");
    await expect(page.getByRole("status")).toContainText("booked once he confirms");

    const row = (await stored(request)).find((r) => r.name === "EMAIL-DOWN Booker") as (StoredRow & Record<string, unknown>) | undefined;
    expect(row).toMatchObject({ kind: "booking", service: "One-to-one", alert_status: "failed", alert_attempts: 1, alert_error: "http-503" });
    expect(String(row!.alert_subject)).toBe("One-to-one booking request: EMAIL-DOWN Booker");
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

  test("a plan chosen on the plan cards travels with the request to Alex", async ({ page, request }) => {
    await page.goto(`${PROD}/book/group-class?plan=regular`);
    await expect(page.getByText("Regular · £65 / 4 weeks · 8 class credits")).toBeVisible();
    const day = classAvailability(timetable.sessions, toDateKey(new Date())).days[0];
    await pickDate(page, `${formatLongDate(day.date)}, available`);
    await page.locator("#times label").first().click();
    await continueButton(page).click();
    await choose(page, "Advanced");
    await page.getByRole("textbox", { name: "Name" }).fill("Plan Chooser");
    await page.getByRole("textbox", { name: "Email" }).fill("plan-chooser@example.com");
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("status")).toContainText("Request sent");
    const row = (await stored(request)).find((r) => r.name === "Plan Chooser");
    expect(row).toMatchObject({ details: { plan: "regular", membership: "Regular membership (£65 every 4 weeks, 8 class credits)" } });
    expect(row!.summary).toContain("Regular membership");
    const sent = (await emails(request)).find((e) => e.payload.subject === "Group class booking request: Plan Chooser");
    expect(sent!.payload.text).toContain("Membership: Regular membership (£65 every 4 weeks, 8 class credits)");
  });

  test("joining a membership with a first class: stored with the plan, emailed, and ready to start in the coach area", async ({ page, request }) => {
    await page.goto(`${PROD}/memberships/join?plan=dedicated`);
    await expect(page.getByRole("heading", { level: 1, name: "Join a membership." })).toBeVisible();
    // The plan tapped on the plan list arrives chosen, so the journey opens on the first class (owner, 2026-10-27)…
    await expect(page.getByRole("heading", { name: "Your first class" })).toBeVisible();
    // …and the plan can still be changed from the step bar.
    await page.getByRole("navigation", { name: "Membership steps" }).getByRole("button", { name: /Plan/ }).click();
    await expect(page.getByRole("radio", { name: /^Dedicated · £85 \/ 4 weeks/ })).toBeChecked();
    await choose(page, "Regular · £65 / 4 weeks");
    await continueButton(page).click();

    await expect(page.getByRole("heading", { name: "Your first class" })).toBeFocused();
    await expect(continueButton(page)).toBeDisabled();
    const day = classAvailability(timetable.sessions, toDateKey(new Date())).days[0];
    await pickDate(page, `${formatLongDate(day.date)}, available`);
    await page.locator("#times label").first().click();
    await continueButton(page).click();

    await expect(page.getByRole("heading", { name: "Your details" })).toBeFocused();
    await continueButton(page).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill("Join Tester");
    await page.getByRole("textbox", { name: "Email" }).fill("join@example.com");
    await continueButton(page).click();

    await expect(page.getByRole("heading", { name: "Check and send" })).toBeFocused();
    await expect(page.getByText("Unused credits expire at the end of each membership period and do not roll over.")).toBeVisible();
    await expect(page.getByText("Less than 24 hours before class:")).toBeVisible();
    await expect(page.getByText(/tells you how to pay for your first 4 weeks \(£65\)/)).toBeVisible();
    await page.waitForTimeout(3100);
    // Agreeing to the terms is required.
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Please confirm you've read and agree").first()).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByRole("button", { name: "Send request" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("Thanks. Alex will reply to confirm.");
    await expect(status).toContainText(/RAENG-[0-9A-F]{8}/);
    await expect(status).toContainText("join@example.com");
    await expect(status).toContainText("Regular membership");

    const year = new Date(`${day.date}T12:00:00`).getFullYear();
    const row = (await stored(request)).find((r) => r.name === "Join Tester");
    expect(row).toMatchObject({ kind: "booking", service: "Membership", email: "join@example.com", details: { plan: "regular", membership: "Regular membership (£65 every 4 weeks, 8 class credits)", classDate: day.date, experience: "Beginner" } });
    expect(row!.details.terms).toMatch(/^Agreed to the membership terms and class cancellation policy \(/);
    expect(row!.summary).toBe(`Regular membership · first class ${formatLongDate(day.date)} ${year}, ${row!.summary.split(", ").pop()}`);
    const sent = (await emails(request)).find((e) => e.payload.subject === "Regular membership request: Join Tester");
    expect(sent!.payload.text).toContain("Nothing has been paid.");
    expect(sent!.headers.idempotencyKey).toBe(row!.idempotency_key);

    // Alex can start the membership straight from the request.
    await page.goto(`${PROD}/coach/login`);
    await page.getByLabel("Email").fill("coach-e2e@example.com");
    await page.getByLabel("Password").fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/coach$/);
    await page.goto(`${PROD}/coach/requests`);
    await page.getByRole("link", { name: /Join Tester/ }).first().click();
    await expect(page.getByRole("link", { name: "Start this membership" })).toHaveAttribute("href", /plan=regular/);
  });

  test("joining without a first class: book later", async ({ page, request }) => {
    await page.goto(`${PROD}/memberships/join?plan=starter`);
    await page.getByRole("button", { name: "Skip: I'll book my first class later" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Later Joiner");
    await page.getByRole("textbox", { name: "Email" }).fill("later@example.com");
    await continueButton(page).click();
    await expect(page.locator("main dl").getByText("Book later").first()).toBeVisible();
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("status")).toContainText("You'll book it later");
    const row = (await stored(request)).find((r) => r.name === "Later Joiner");
    expect(row).toMatchObject({ service: "Membership", summary: "Starter membership · first class to book later", details: { plan: "starter" } });
    expect(row!.details.classDate).toBeUndefined();
  });

  test("a made-up plan in the link is ignored", async ({ page }) => {
    await page.goto(`${PROD}/book/group-class?plan=platinum`);
    await expect(page.getByRole("heading", { name: "Choose a class" })).toBeVisible();
    await expect(page.getByText("Your plan").filter({ visible: true })).toHaveCount(0);
  });

  test("a class that has reached its capacity shows as fully booked and can't be requested", async ({ page, request }) => {
    // The last class date in the booking window, filled to a capacity of 1 in the coach database.
    const window = classAvailability(timetable.sessions, toDateKey(new Date()));
    const last = window.days[window.days.length - 1];
    const session = timetable.sessions.find((s) => s.start === last.slots[0].time && new Date(`${last.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" }) === s.day)!;
    const run = async (query: string, params: unknown[] = []) => {
      const r = await request.post(`${SUPABASE}/test/sql`, { data: { sql: query, params } });
      expect(r.ok(), await r.text()).toBe(true);
      return (await r.json()) as Record<string, unknown>[];
    };
    const [client] = await run("insert into akb_clients (full_name, email, status) values ('Full Class', $1, 'active') returning id", [`full-${Date.now()}@example.com`]);
    await run("select akb_add_attendee($1, $2, $3::date, $4::timestamptz, 60, 0, 'Group class')", [client.id, session.id, last.date, `${last.date}T18:30:00Z`]);
    await run("update akb_class_sessions set capacity = 1 where slot = $1 and class_date = $2::date", [session.id, last.date]);
    try {
      const api = await request.get(`${PROD}/api/classes/full`);
      expect(await api.json()).toMatchObject({ known: true, full: expect.arrayContaining([`${session.id}|${last.date}`]) });
      expect(JSON.stringify(await (await request.get(`${PROD}/api/classes/full`)).json())).not.toContain("Full Class");

      await page.goto(`${PROD}/book/group-class`);
      await expect(page.getByRole("heading", { name: "Choose a class" })).toBeVisible();
      const cell = page.getByLabel(`${formatLongDate(last.date)}, fully booked`);
      // The capacity answer arrives just after the calendar: give it a moment before moving to another month
      // (with a single month in the window, Next is disabled).
      const next = page.getByRole("button", { name: "Next" }).first();
      for (let i = 0; i < 2; i++) {
        await cell.waitFor({ state: "attached", timeout: 5_000 }).catch(() => undefined);
        if ((await cell.count()) || !(await next.isEnabled())) break;
        await next.click();
      }
      await expect(cell).toBeDisabled();
    } finally {
      await run("update akb_class_sessions set capacity = null where slot = $1 and class_date = $2::date", [session.id, last.date]);
    }
  });

  test("Stripe endpoints are off until Stripe is configured, and never accept unsigned calls", async ({ request }) => {
    const hook = await request.post(`${PROD}/api/stripe/webhook`, {
      data: { type: "payment.updated", event_id: "evt-e2e", data: { type: "payment", id: "PAY-E2E" } },
      headers: { "stripe-signature": "forged" },
    });
    expect(hook.status()).toBe(404);
    expect(await hook.json()).toEqual({ error: "not-configured" });
    expect((await request.get(`${PROD}/api/stripe/webhook`)).status()).toBe(405);
    expect((await request.get(`${PROD}/api/cron/stripe-reconcile`)).status()).toBe(401);
    const cron = await request.get(`${PROD}/api/cron/stripe-reconcile`, { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
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
    await choose(page, "Mon");
    await continueButton(page).click();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("FAIL-TEST Booker");
    await page.getByRole("textbox", { name: "Email" }).fill("fail@example.com");
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.locator("main [role=alert]")).toContainText("couldn't be sent");
    await expect(page.getByText("Request sent")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("FAIL-TEST Booker");
  });

  test("a bot-speed submission is rejected without claiming success", async ({ page, request }) => {
    await page.goto(`${PROD}/book/one-to-one`);
    await choose(page, "Tue");
    await continueButton(page).click();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("Speedy Bot");
    await page.getByRole("textbox", { name: "Email" }).fill("bot@example.com");
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.locator('input[name="startedAt"]').evaluate((el: HTMLInputElement) => (el.value = String(Date.now())));
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.locator("main [role=alert]")).toContainText("Please wait a few seconds");
    await expect(page.getByText("Request sent")).toHaveCount(0);
    expect((await emails(request)).some((e) => e.payload.subject.includes("Speedy Bot"))).toBe(false);
  });

  test("the server refuses demonstration selections even if posted directly", async ({ page }) => {
    // Posting a demo slot id through the real form must never become a request.
    await page.goto(`${PROD}/book/one-to-one`);
    await choose(page, "Thu");
    await continueButton(page).click();
    await choose(page, "Intermediate");
    await page.getByRole("textbox", { name: "Name" }).fill("Slot Poster");
    await page.getByRole("textbox", { name: "Email" }).fill("slot@example.com");
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.locator("form").evaluate((form) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "slot";
      input.value = "demo-one-to-one-2026-10-20-07:00";
      form.appendChild(input);
    });
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Send request" }).click();
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

test.describe("membership join (preview demonstration)", () => {
  test("walks every step, sends nothing and says so", async ({ page, request }) => {
    await page.goto("/memberships/join?plan=regular");
    await expect(page.getByRole("heading", { name: "Your first class" })).toBeVisible();
    await page.getByRole("button", { name: "Skip: I'll book my first class later" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Join Demo");
    await page.getByRole("textbox", { name: "Email" }).fill("join-demo@example.com");
    await continueButton(page).click();
    await expect(page.getByRole("note", { name: "Demonstration" })).toBeVisible();
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByRole("button", { name: "Finish demo" }).click();
    await expect(page.getByRole("status")).toContainText("Nothing has been sent.");
    expect((await emails(request)).some((e) => e.payload.text.includes("Join Demo"))).toBe(false);
    expect((await stored(request)).some((r) => r.name === "Join Demo")).toBe(false);
  });

  test("the browser's Back moves between the steps", async ({ page }) => {
    await page.goto("/memberships/join?plan=starter");
    await expect(page.getByRole("heading", { name: "Your first class" })).toBeVisible();
    await page.getByRole("button", { name: "Skip: I'll book my first class later" }).click();
    await expect(page).toHaveURL(/#details$/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Your first class" })).toBeVisible();
  });

  test("the first-class step and the check step have no automatically detectable accessibility issues", async ({ page }) => {
    await page.goto("/memberships/join?plan=regular");
    // Let the step's fade-in finish: mid-fade text is briefly translucent.
    await page.waitForTimeout(1300);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Skip: I'll book my first class later" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Axe Joiner");
    await page.getByRole("textbox", { name: "Email" }).fill("axe@example.com");
    await continueButton(page).click();
    await page.waitForTimeout(1300);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

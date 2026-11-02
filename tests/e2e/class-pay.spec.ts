import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { timetable } from "../../src/content/classes";
import { addDays, formatLongDate, toDateKey } from "../../src/lib/availability/dates";
import { classAvailability } from "../../src/lib/availability/timetable";

/**
 * Booking a group class and paying online (owner, 2026-10-27: no confirmation
 * by Alex; 1:1 stays a request), on the build with Stripe in Sandbox mode
 * against the Stripe stand-in (tests/e2e/mock-stripe.mjs). The place is
 * confirmed only after the signed webhook's payment is recorded. The emailed
 * private link cancels it, and (24 hours or more before) gives a credit link
 * that books another class with nothing to pay.
 */
const PAY = `http://localhost:${process.env.E2E_PAY_PORT ?? 3202}`;
const MOCK = `http://localhost:${process.env.MOCK_EMAIL_PORT ?? 3299}`;
const SUPABASE = `http://localhost:${process.env.MOCK_SUPABASE_PORT ?? 3298}`;
const STRIPE = `http://localhost:${process.env.MOCK_STRIPE_PORT ?? 3297}`;

interface RecordedEmail {
  payload: { to: string[]; subject: string; text: string };
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

/** The nth class date from 3 days on (so cancelling is 24 hours or more before), then details. */
async function toDetails(page: Page, url: string, nth: number, name: string, email: string) {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Choose a class" })).toBeVisible();
  const days = classAvailability(timetable.sessions, toDateKey(new Date())).days;
  const day = days.filter((d) => d.date >= addDays(toDateKey(new Date()), 3))[nth];
  // The calendar opens on the first class date's month.
  if (day.date.slice(0, 7) !== days[0].date.slice(0, 7)) await page.getByRole("button", { name: "Next month" }).click();
  const input = page.getByLabel(`${formatLongDate(day.date)}, available`);
  await page.locator("label").filter({ has: input }).click();
  await expect(input).toBeChecked();
  await page.locator("#times label").first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
  await page.getByLabel(/I've read and agree to the health and risk terms/).check();
  // The form's anti-spam check refuses anything sent within 3 seconds of opening it.
  await page.waitForTimeout(3100);
}

test.beforeAll(async ({ request }) => {
  await sql(request, "insert into akb_database_role (role) select 'test' where not exists (select 1 from akb_database_role)");
});

test.describe("booking a group class and paying online", () => {
  test("the class screen shows the price and what a membership would save before you continue", async ({ page }) => {
    await page.goto(`${PAY}/book/group-class`);
    await expect(page.getByRole("heading", { name: "Choose a class" })).toBeVisible();
    const days = classAvailability(timetable.sessions, toDateKey(new Date())).days;
    const day = days.filter((d) => d.date >= addDays(toDateKey(new Date()), 3))[0];
    if (day.date.slice(0, 7) !== days[0].date.slice(0, 7)) await page.getByRole("button", { name: "Next month" }).click();
    await page.locator("label").filter({ has: page.getByLabel(`${formatLongDate(day.date)}, available`) }).click();
    await page.locator("#times label").first().click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await expect(page.getByText("Total", { exact: true })).toBeVisible();
    await expect(page.getByText("£12", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/^Members pay from £\d/)).toBeVisible();
    await expect(page.getByRole("link", { name: /See memberships/ })).toHaveAttribute("target", "_blank");
  });

  test("pay on Stripe's page, come back booked; cancel by the emailed link; the credit books another class free", async ({ page, request }) => {
    const email = `class-${Date.now()}@example.com`;
    await toDetails(page, `${PAY}/book/group-class`, 0, "Class Payer", email);
    // The last screen says what you are paying for, up front: class, date, time, price and the hold (owner, 2026-10-30).
    const your = page.locator(".card").filter({ hasText: "Your class" });
    await expect(your).toContainText("£12");
    await expect(your).toContainText("Your place is held for 15 minutes while you pay.");
    await expect(page.getByText("Your place is held for 15 minutes while you pay.")).toBeVisible();
    await expect(page.getByText(/^Cancel at least 24 hours before/)).toBeVisible();
    await page.getByRole("button", { name: "Pay £12" }).click();

    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Group class, /);
    await page.getByRole("button", { name: "Pay £12.00" }).click();

    await expect(page).toHaveURL(new RegExp(`^${PAY}/book/done\\?booking=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.", { timeout: 15_000 });

    // Alex is told (nothing to confirm); the booker gets the private link.
    await expect.poll(async () => (await emailsTo(request, email)).length).toBe(1);
    const [booked] = await emailsTo(request, email);
    expect(booked.payload.subject).toMatch(/^You're booked: /);
    const alex = (await emailsTo(request, "alex-e2e@example.com")).find((e) => e.payload.subject.startsWith("Class booked: Class Payer"));
    expect(alex?.payload.text).toContain("nothing to confirm");
    const manage = /\/book\/manage\?token=[A-Za-z0-9_-]{43}/.exec(booked.payload.text)?.[0];
    expect(manage).toBeDefined();

    // Opening the link changes nothing; pressing Cancel does.
    await page.goto(`${PAY}${manage}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.");
    await expect(page.getByText(/cancelling now gives you a credit/)).toBeVisible();
    // Contrast is measured on the finished page, not mid fade-in.
    await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}[data-reveal]{opacity:1!important;transform:none!important}" });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Cancel my place" }).click();
    await expect(page.getByText("Your place is cancelled.")).toBeVisible();
    const credit = page.getByRole("link", { name: "Book with your credit" });
    const href = await credit.getAttribute("href");
    expect(href).toMatch(/\/book\/group-class\?credit=[A-Za-z0-9_-]{43}$/);
    await expect.poll(async () => (await emailsTo(request, email)).some((e) => e.payload.subject === "Your class credit")).toBe(true);
    await expect.poll(async () => (await emailsTo(request, "alex-e2e@example.com")).some((e) => e.payload.subject.startsWith("Class cancelled: Class Payer"))).toBe(true);

    // The credit link: nothing to pay, booked straight away, with no Stripe page.
    await toDetails(page, href!, 1, "Class Payer", `other-${email}`);
    await expect(page.getByText("Booking with your class credit: nothing to pay.")).toBeVisible();
    await page.getByRole("button", { name: "Book with your credit" }).click();
    await expect(page).toHaveURL(new RegExp(`^${PAY}/book/done\\?booking=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.");
    // Booked for the credit's owner, whatever email was typed.
    const rows = await sql(request, "select b.status, b.charge_id from akb_class_bookings b join akb_clients c on c.id = b.client_id where c.email = $1 order by b.created_at", [email]);
    expect(rows).toEqual([
      { status: "cancelled", charge_id: expect.any(String) },
      { status: "confirmed", charge_id: null },
    ]);

    // A used credit can't be used again: the form says so and offers to pay instead.
    await toDetails(page, href!, 2, "Class Payer", email);
    await page.getByRole("button", { name: "Book with your credit" }).click();
    await expect(page.getByText("This class credit has been used or has expired.").first()).toBeVisible();
    await page.getByRole("button", { name: "Pay £12 instead" }).click();
    await expect(page.getByRole("button", { name: "Pay £12" })).toBeVisible();
  });

  test("leaving Stripe's page without paying books nothing, and the page says it's waiting", async ({ page, request }) => {
    const email = `class-leaver-${Date.now()}@example.com`;
    await toDetails(page, `${PAY}/book/group-class`, 3, "Not Paying", email);
    await page.getByRole("button", { name: "Pay £12" }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    const [booking] = await sql(request, "select b.id from akb_class_bookings b join akb_clients c on c.id = b.client_id where c.email = $1", [email]);
    await page.goto(`${PAY}/book/done?booking=${booking.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Waiting for Stripe to confirm.");
    await expect(page.getByRole("link", { name: "Go back to Stripe to pay" })).toHaveAttribute("href", new RegExp(`^${STRIPE}/checkout/`));
    expect(await emailsTo(request, email)).toEqual([]);
  });

  test("the page after paying a link Alex sent: unknown links say so, and it has no accessibility problems", async ({ page }) => {
    await page.goto(`${PAY}/pay/done?link=00000000-0000-4000-8000-000000000000`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that payment.");
    await page.waitForTimeout(1300); // let the page's fade-in finish before measuring contrast
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.goto(`${PAY}/pay/done?link=not-a-link`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that payment.");
  });

  test("unknown bookings and links say so; one-to-one stays a request", async ({ page }) => {
    await page.goto(`${PAY}/book/done?booking=00000000-0000-4000-8000-000000000000`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that booking.");
    await page.goto(`${PAY}/book/manage?token=${"a".repeat(43)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Link not valid.");
    await page.goto(`${PAY}/book/one-to-one`);
    await expect(page.getByText("Choose when suits you. Alex confirms every place personally.")).toBeVisible();
  });
});

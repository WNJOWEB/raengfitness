import { randomBytes } from "node:crypto";
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

/** Makes `email` a returning customer: one past class attended. */
async function returning(request: APIRequestContext, email: string, name: string) {
  const [client] = await sql(request, "insert into akb_clients (full_name, email) values ($1, lower($2)) on conflict do nothing returning id", [name, email]);
  const id = client?.id ?? (await sql(request, "select id from akb_clients where lower(email) = lower($1)", [email]))[0].id;
  const past = addDays(toDateKey(new Date()), -30);
  const [ses] = await sql(
    request,
    "insert into akb_class_sessions (slot, class_date, starts_at, duration_minutes) values ('mon-evening', $1, $2, 60) on conflict (slot, class_date) do update set slot = excluded.slot returning id",
    [past, `${past}T18:30:00Z`],
  );
  await sql(request, "insert into akb_class_attendance (class_session_id, client_id, status) values ($1, $2, 'attended') on conflict do nothing", [ses.id, id]);
}

/** The nth class date from 3 days on (so cancelling is 24 hours or more before), then details. */
async function toDetails(page: Page, url: string, nth: number, name: string, email: string) {
  // A returning customer (one class attended before), so the first-class-free offer doesn't apply and the class is paid.
  await returning(page.request, email, name);
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
  // Typing before the form has hydrated can be lost, so fill until the fields hold what was typed.
  await expect(async () => {
    await page.getByRole("textbox", { name: "Name" }).fill(name);
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.waitForTimeout(300);
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(name, { timeout: 100 });
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue(email, { timeout: 100 });
  }).toPass({ timeout: 10_000 });
  await page.getByLabel(/I've read and agree to the health and risk terms/).check();
  // The form's anti-spam check refuses anything sent within 3 seconds of opening it.
  await page.waitForTimeout(3100);
}

test.beforeAll(async ({ request }) => {
  await sql(request, "insert into akb_database_role (role) select 'test' where not exists (select 1 from akb_database_role)");
});

test.describe("booking a group class and paying online", () => {
  test("first class free: a new customer books with nothing to pay and no Stripe page; the offer is shown before booking (Alex, 2026-11-05)", async ({ page, request }) => {
    const email = `first-free-${Date.now()}@example.com`;
    await page.goto(`${PAY}/book/group-class`);
    await expect(page.getByText("Your first class with us is free", { exact: false })).toBeVisible();
    const days = classAvailability(timetable.sessions, toDateKey(new Date())).days;
    const day = days.filter((d) => d.date >= addDays(toDateKey(new Date()), 3))[6];
    if (day.date.slice(0, 7) !== days[0].date.slice(0, 7)) await page.getByRole("button", { name: "Next month" }).click();
    await page.locator("label").filter({ has: page.getByLabel(`${formatLongDate(day.date)}, available`) }).click();
    await page.locator("#times label").first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("First Timer");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await expect(page.getByText("£12, or free if it's your first class")).toBeVisible();
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // Straight to the booked page: no Stripe.
    await expect(page).toHaveURL(new RegExp(`^${PAY}/book/done\\?booking=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.");
    await expect(page.locator("dl.cf-rise")).toContainText("Free: your first class");
    const rows = await sql(request, "select b.status, b.charge_id, b.first_class_free from akb_class_bookings b join akb_clients c on c.id = b.client_id where c.email = $1", [email]);
    expect(rows).toEqual([{ status: "confirmed", charge_id: null, first_class_free: true }]);
    await expect.poll(async () => (await emailsTo(request, email)).map((e) => e.payload.text).join("\n")).toContain("(first class free)");
  });

  test("the classes page tells new customers their first class is free, with the terms", async ({ page }) => {
    await page.goto(`${PAY}/classes`);
    const payg = page.locator("#pay-as-you-go");
    await expect(payg).toContainText("Your first class is free.");
    await expect(payg).toContainText("New customers only: one free group class per person");
    await expect(page.locator("#timetable")).toContainText("Your first class is free for new customers: just book any class and it's free automatically.");
  });

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
    // Owner's pick A (2026-11-03): the price is shown once as a total above the button, and the button says what happens next, not "Pay".
    await expect(page.getByText("Total", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay £/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Group class, /);
    await page.getByRole("button", { name: "Pay £12.00" }).click();

    await expect(page).toHaveURL(new RegExp(`^${PAY}/book/done\\?booking=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.", { timeout: 15_000 });
    // The confirmation says what was booked and paid, with a reference, and what to do next: not just "thanks".
    const facts = page.getByRole("definition");
    await expect(page.getByText("Group class", { exact: true }).first()).toBeVisible();
    await expect(page.locator("dl.cf-rise")).toContainText("£12.00 paid by card");
    await expect(page.locator("dl.cf-rise")).toContainText(/RAENG-[0-9A-F]{8}/);
    await expect(page.locator("dl.cf-rise")).toContainText("Cumbernauld");
    await expect(page.getByRole("link", { name: "View my bookings" })).toHaveAttribute("href", "/account/sign-in");
    await expect(page.getByRole("link", { name: "Book a class" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the homepage" })).toHaveCount(0);
    void facts;
    const reference = (await page.locator("dl.cf-rise").innerText()).match(/RAENG-[0-9A-F]{8}/)![0];
    // Refreshing the confirmation changes nothing: still one booking and one payment.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.");
    await page.reload();
    expect(await sql(request, "select count(*)::int as n from akb_class_bookings b join akb_clients c on c.id = b.client_id where c.email = $1", [email])).toEqual([{ n: 1 }]);
    expect(await sql(request, "select count(*)::int as n from akb_payments p join akb_clients c on c.id = p.client_id where c.email = $1", [email])).toEqual([{ n: 1 }]);

    // Alex is told (nothing to confirm); the booker gets the private link.
    await expect.poll(async () => (await emailsTo(request, email)).length).toBe(1);
    const [booked] = await emailsTo(request, email);
    expect(booked.payload.subject).toMatch(/^You're booked: /);
    // The same reference is in the email as on the page.
    expect(booked.payload.text).toContain(`Reference: ${reference}`);
    const alex = (await emailsTo(request, "alex-e2e@example.com")).find((e) => e.payload.subject.startsWith("Class booked: Class Payer"));
    expect(alex?.payload.text).toContain("nothing to confirm");
    const manage = /\/book\/manage\?token=[A-Za-z0-9_-]{43}/.exec(booked.payload.text)?.[0];
    expect(manage).toBeDefined();

    // Opening the link changes nothing; pressing Cancel does.
    await page.goto(`${PAY}${manage}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.");
    await expect(page.getByText("It's 24 hours or more before the class, so if you cancel now your payment is refunded in full.")).toBeVisible();
    // Contrast is measured on the finished page, not mid fade-in.
    await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}[data-reveal]{opacity:1!important;transform:none!important}" });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Cancel my place" }).click();
    await expect(page.getByText("Your place is cancelled.")).toBeVisible();
    // Cancelled in time (Alex, 2026-11-05): refunded in full through Stripe, no class credit, and the fee is cancelled.
    await expect(page.getByText("We're refunding your £12.00 to the card you paid with.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Book with your credit" })).toHaveCount(0);
    await expect.poll(async () => (await emailsTo(request, email)).some((e) => e.payload.subject.startsWith("Cancelled and refunded: "))).toBe(true);
    await expect
      .poll(async () => (await emailsTo(request, "alex-e2e@example.com")).find((e) => e.payload.subject.startsWith("Class cancelled: Class Payer"))?.payload.text ?? "")
      .toContain("refunded automatically");
    expect(await sql(request, "select count(*)::int as n from akb_class_credits c join akb_clients p on p.id = c.client_id where p.email = $1", [email])).toEqual([{ n: 0 }]);
    expect(
      await sql(
        request,
        "select r.amount_pence, (select voided_at is not null from akb_charges where id = b.charge_id) as voided from akb_refunds r join akb_payments p on p.id = r.payment_id join akb_clients c on c.id = p.client_id join akb_class_bookings b on b.client_id = c.id where c.email = $1",
        [email],
      ),
    ).toEqual([{ amount_pence: 1200, voided: true }]);

    // A class credit link they still hold (credits were given until 2026-11-05): nothing to pay, booked straight away, no Stripe page.
    const creditToken = randomBytes(32).toString("base64url");
    await sql(
      request,
      "insert into akb_class_credits (client_id, source_booking_id, expires_on, token_hash) select b.client_id, b.id, akb_london_today() + 28, encode(sha256(convert_to($2, 'UTF8')), 'hex') from akb_class_bookings b join akb_clients c on c.id = b.client_id where c.email = $1",
      [email, creditToken],
    );
    const href = `${PAY}/book/group-class?credit=${creditToken}`;
    await toDetails(page, href, 1, "Class Payer", `other-${email}`);
    await expect(page.getByText("Booking with your class credit: nothing to pay.")).toBeVisible();
    await expect(page.getByText("you'll get your class credit back", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Book with your credit" }).click();
    await expect(page).toHaveURL(new RegExp(`^${PAY}/book/done\\?booking=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.");
    await expect(page.locator("dl.cf-rise")).toContainText("Paid with a class credit");
    // Booked for the credit's owner, whatever email was typed.
    const rows = await sql(request, "select b.status, b.charge_id from akb_class_bookings b join akb_clients c on c.id = b.client_id where c.email = $1 order by b.created_at", [email]);
    expect(rows).toEqual([
      { status: "cancelled", charge_id: expect.any(String) },
      { status: "confirmed", charge_id: null },
    ]);

    // A used credit can't be used again: the form says so and offers to pay instead.
    await toDetails(page, href, 2, "Class Payer", email);
    await page.getByRole("button", { name: "Book with your credit" }).click();
    await expect(page.getByText("This class credit has been used or has expired.").first()).toBeVisible();
    await page.getByRole("button", { name: "Pay £12 instead" }).click();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  });

  test("the health and risk tick comes before the total, and Continue explains what is missing (owner, 2026-11-04)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await toDetails(page, `${PAY}/book/group-class`, 4, "Tick Order", `tick-${Date.now()}@example.com`);
    const tick = page.getByLabel(/I've read and agree to the health and risk terms/);
    const total = page.getByText("Total", { exact: true });
    const [tickBox, totalBox] = [await tick.boundingBox(), await total.boundingBox()];
    expect(tickBox!.y, "the tick sits above the total").toBeLessThan(totalBox!.y);

    // Not ticked: Continue doesn't go to Stripe, and says why beside the button and at the box.
    await tick.uncheck();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText("Tick the health and risk box above to continue.")).toBeVisible();
    await expect(tick).toBeFocused();
    await expect(page).not.toHaveURL(new RegExp(`^${STRIPE}`));
    await expect(tick).toBeInViewport();

    // Ticked: the message goes and Continue opens Stripe.
    await tick.check();
    await expect(page.getByText("Tick the health and risk box above to continue.")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
  });

  test("leaving Stripe's page without paying books nothing, and the page says it's waiting", async ({ page, request }) => {
    const email = `class-leaver-${Date.now()}@example.com`;
    await toDetails(page, `${PAY}/book/group-class`, 3, "Not Paying", email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    const [booking] = await sql(request, "select b.id from akb_class_bookings b join akb_clients c on c.id = b.client_id where c.email = $1", [email]);
    await page.goto(`${PAY}/book/done?booking=${booking.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirming your payment.");
    await expect(page.getByRole("link", { name: "Go back to Stripe to pay" })).toHaveAttribute("href", new RegExp(`^${STRIPE}/checkout/`));
    expect(await emailsTo(request, email)).toEqual([]);
  });

  test("Stripe's back arrow says the payment was cancelled (not 'waiting'), books nothing, and paying afterwards still works once", async ({ page, request }) => {
    const email = `class-backer-${Date.now()}@example.com`;
    await toDetails(page, `${PAY}/book/group-class`, 4, "Back Arrow", email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page).toHaveURL(new RegExp(`^${PAY}/book/done\\?booking=.*cancelled=1`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payment cancelled.");
    await expect(page.getByText("You haven't been charged.")).toBeVisible();
    // Never "booked" and never refreshing by itself while cancelled.
    await expect(page.getByText("You're booked.")).toHaveCount(0);
    // It doesn't ask again by itself: the address stays put.
    { const at = page.url(); await page.waitForTimeout(3500); expect(page.url()).toBe(at); }
    expect(await sql(request, "select b.status from akb_class_bookings b join akb_clients c on c.id = b.client_id where c.email = $1", [email])).toEqual([{ status: "awaiting_payment" }]);
    expect(await sql(request, "select count(*)::int as n from akb_payments p join akb_clients c on c.id = p.client_id where c.email = $1", [email])).toEqual([{ n: 0 }]);
    expect(await emailsTo(request, email)).toEqual([]);
    // The same Stripe page is offered again (no second page is made, so no second payment is possible).
    const again = page.getByRole("link", { name: "Go back and pay" });
    await expect(again).toHaveAttribute("href", new RegExp(`^${STRIPE}/checkout/`));
    await again.click();
    await page.getByRole("button", { name: "Pay £12.00" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked.", { timeout: 15_000 });
    expect(await sql(request, "select count(*)::int as n from akb_square_payment_links l join akb_clients c on c.id = l.client_id where c.email = $1", [email])).toEqual([{ n: 1 }]);
    expect(await sql(request, "select count(*)::int as n from akb_payments p join akb_clients c on c.id = p.client_id where c.email = $1", [email])).toEqual([{ n: 1 }]);
  });

  test("a payment page that has been closed can't be paid, and a refresh of the result changes nothing", async ({ page, request }) => {
    const email = `class-closer-${Date.now()}@example.com`;
    await toDetails(page, `${PAY}/book/group-class`, 5, "Closed Page", email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    const session = page.url().split("/checkout/")[1];
    // Stripe closes it (as it does when the 30 minutes are up, or when the site replaces it).
    const expired = await request.post(`${STRIPE}/v1/checkout/sessions/${session}/expire`);
    expect(expired.ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page has expired");
    await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
    expect(await sql(request, "select count(*)::int as n from akb_payments p join akb_clients c on c.id = p.client_id where c.email = $1", [email])).toEqual([{ n: 0 }]);
  });

  test("the page for a payment link shows the right state from the database: waiting, cancelled, paid and closed", async ({ page, request }) => {
    const [client] = await sql(request, "insert into akb_clients (full_name, email, status) values ('Link Payer', $1, 'active') returning id", [`link-${Date.now()}@example.com`]);
    const link = async (status: string, paid = false) => {
      const [charge] = await sql(request, "insert into akb_charges (client_id, service, description, amount_pence, due_on) values ($1, 'other', 'Regular membership, 3 Nov to 30 Nov 2026', 6500, current_date) returning id", [client.id]);
      let paymentId: string | null = null;
      if (paid) {
        const [p] = await sql(request, "insert into akb_payments (client_id, service, amount_pence, paid_on, method, idempotency_key, provider, provider_payment_id) values ($1, 'other', 6500, current_date, 'card', $2, 'stripe_test', $3) returning id", [client.id, `k-${Math.random()}`, `pi_${Math.random()}`]);
        paymentId = p.id;
      }
      const [row] = await sql(request, "insert into akb_square_payment_links (environment, charge_id, client_id, amount_pence, status, square_link_id, square_order_id, url, paid_payment_id) values ('sandbox', $1, $2, 6500, $3, $4, $4, $5, $6) returning id", [charge.id, client.id, status, `cs_seed_${Math.random()}`, `${STRIPE}/checkout/cs_seed`, paymentId]);
      return row.id as string;
    };
    // Waiting: nothing says paid; it asks again by itself, and offers the Stripe page.
    const open = await link("open");
    await page.goto(`${PAY}/pay/done?link=${open}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirming your payment.");
    await expect(page.locator("dl.cf-rise")).toContainText("£65.00");
    await expect(page.locator("dl.cf-rise")).toContainText("Regular membership");
    await expect(page.locator("dl.cf-rise")).toContainText(`RAENG-${open.slice(0, 8).toUpperCase()}`);
    // It asks again by itself, in place (no full reload).
    await expect(page).toHaveURL(new RegExp(`link=${open}&n=1$`), { timeout: 6000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirming your payment.");
    // Back arrow: cancelled, not waiting, and no refresh.
    await page.goto(`${PAY}/pay/done?link=${open}&cancelled=1`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payment cancelled.");
    await expect(page.getByRole("link", { name: "Go back and pay" })).toBeVisible();
    // It doesn't ask again by itself: the address stays put.
    { const at = page.url(); await page.waitForTimeout(3500); expect(page.url()).toBe(at); }
    // Waiting for too long: stops asking, says it will show on the account.
    await page.goto(`${PAY}/pay/done?link=${open}&n=15`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Still confirming your payment.");
    // It doesn't ask again by itself: the address stays put.
    { const at = page.url(); await page.waitForTimeout(3500); expect(page.url()).toBe(at); }
    // A "paid" claim in the address changes nothing: only the database's paid state shows success.
    await page.goto(`${PAY}/pay/done?link=${open}&paid=1&success=1`);
    await expect(page.getByText("Payment received.")).toHaveCount(0);
    // Paid: the amount, what for, the date and the reference, with a next step.
    const paid = await link("paid", true);
    await page.goto(`${PAY}/pay/done?link=${paid}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payment received.");
    await expect(page.locator("dl.cf-rise")).toContainText("£65.00");
    await expect(page.locator("dl.cf-rise")).toContainText("Date");
    await expect(page.getByRole("link", { name: "Sign in to your account" })).toHaveAttribute("href", "/account/sign-in");
    await expect(page.getByRole("link", { name: "Back to the homepage" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payment received.");
    expect(await sql(request, "select count(*)::int as n from akb_payments where client_id = $1", [client.id])).toEqual([{ n: 1 }]);
    // Closed: replaced or expired.
    const closed = await link("cancelled");
    await page.goto(`${PAY}/pay/done?link=${closed}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This payment link is closed.");
    await page.waitForTimeout(1300);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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

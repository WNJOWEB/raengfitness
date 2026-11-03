import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Joining a membership and paying online (owner, 2026-10-26: no confirmation
 * by Alex), on a build with Stripe in Sandbox mode against the Stripe
 * stand-in (tests/e2e/mock-stripe.mjs). Paying on the stand-in's checkout
 * page sends a signed webhook, as Stripe does; the site records the payment
 * only after re-reading it from "Stripe", and only then starts the membership.
 */
const PAY = `http://localhost:${process.env.E2E_PAY_PORT ?? 3202}`;
const MOCK = `http://localhost:${process.env.MOCK_EMAIL_PORT ?? 3299}`;
const SUPABASE = `http://localhost:${process.env.MOCK_SUPABASE_PORT ?? 3298}`;
const STRIPE = `http://localhost:${process.env.MOCK_STRIPE_PORT ?? 3297}`;

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

const continueButton = (page: Page) => page.getByRole("button", { name: "Continue" });

/** The plan arrives chosen (the plan step is skipped) → skip the first class → details → the check step. */
async function toCheckStep(page: Page, plan: string, name: string, email: string) {
  await page.goto(`${PAY}/memberships/join?plan=${plan}`);
  await page.getByRole("button", { name: "Skip: I'll book my first class later" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Phone" }).fill("07700 900123");
  await continueButton(page).click();
  // The form's anti-spam check refuses anything sent within 3 seconds of opening it.
  await page.waitForTimeout(3100);
}

test.beforeAll(async ({ request }) => {
  // The stand-in database is a test database (Stripe Sandbox records allowed), as DEPLOYMENT.md sets up.
  await sql(request, "insert into akb_database_role (role) select 'test' where not exists (select 1 from akb_database_role)");
});

test.describe("joining and paying online", () => {
  test("pay on Stripe's page, come back, and the membership has started: nothing for Alex to confirm", async ({ page, request }) => {
    const email = `payer-${Date.now()}@example.com`;
    await toCheckStep(page, "regular", "Online Payer", email);
    await expect(page.getByRole("heading", { name: "Check and pay" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Key terms" })).toContainText("£65 today, then £65 every 4 weeks, taken automatically until you cancel.");
    await expect(page.getByText("Next, you'll pay securely on Stripe's page. Your membership starts as soon as it's paid.")).toBeVisible();
    // Renewals are automatic now (no payment link by email every 4 weeks).
    await expect(page.getByRole("region", { name: "Key terms" })).toContainText("A period you've already paid for isn't refunded.");
    await expect(page.getByText("payment link by email")).toHaveCount(0);
    // The total sits above the button, which says what happens next (not "Pay £65").
    await expect(page.getByText("Total today")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay £/ })).toHaveCount(0);
    // The agreement is still required before paying.
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await expect(page.locator("#agree-error")).toBeVisible();
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.getByRole("button", { name: "Continue to payment" }).click();

    // Stripe's (stand-in) checkout: the plan and the price come from the server, not the form.
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    await expect(page.getByRole("heading", { name: "Regular membership, first 4 weeks" })).toBeVisible();
    // The agreement to be charged again sits beside the pay button: the amount, the rhythm and how to stop.
    await expect(page.locator(".consent")).toContainText("renews every 4 weeks until you cancel");
    await expect(page.locator(".consent")).toContainText("£65 will be charged to this card every 4 weeks");
    await expect(page.locator(".consent")).toContainText("Cancel any time from your account");
    await page.getByRole("button", { name: "Pay £65.00" }).click();

    await expect(page).toHaveURL(new RegExp(`^${PAY}/memberships/join/done\\?signup=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're in.", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Sign in to your account" })).toHaveAttribute("href", "/account/sign-in");
    // What was set up, in a short list.
    await expect(page.getByText("Paid today")).toBeVisible();
    await expect(page.getByText("£65 by Visa ending 4242")).toBeVisible();
    await expect(page.getByText("8 every 4 weeks")).toBeVisible();
    await expect(page.locator("dl.cf-rise")).toContainText(/RAENG-[0-9A-F]{8}/);
    // The health and risk tick is kept with the sign-up, as with a class booking: the wording's version and when.
    expect(await sql(request, "select e.entity, e.detail->>'version' as version from akb_events e join akb_clients c on c.id = e.client_id where c.email = $1 and e.action = 'waiver_accepted'", [email])).toEqual([{ entity: "membership_signup", version: "2026-10-31" }]);

    // Direct Debit is the next step, with its own button: the confirmation stays put so it can be read (owner, 2026-11-03), and the saved card is the fallback.
    await expect(page.getByText("Set up your Direct Debit.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Your bank details go straight to Stripe, not to us")).toBeVisible();
    await expect(page.getByText("Prefer to pay by card? There's nothing more to do: your Visa ending 4242 is charged automatically every 4 weeks")).toBeVisible();
    await expect(page.getByText("Taking you to your bank details")).toHaveCount(0);
    await page.waitForTimeout(7000);
    await expect(page).toHaveURL(new RegExp(`^${PAY}/memberships/join/done\\?signup=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're in.");
    await page.getByRole("button", { name: "Set up Direct Debit" }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`), { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Set up Direct Debit" })).toBeVisible();
    // Until Stripe says the Direct Debit is set up, the card is still the member's method.
    expect(await sql(request, "select d.dd_status, d.method, d.card_label, d.environment from akb_stripe_customers d join akb_clients c on c.id = d.client_id where c.email = $1", [email])).toEqual([{ dd_status: "active", method: "card", card_label: "Visa ending 4242", environment: "sandbox" }]);
    await page.getByRole("button", { name: "Authorise Direct Debit" }).click();
    await expect(page).toHaveURL(new RegExp(`^${PAY}/memberships/join/done\\?signup=`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct Debit set up.", { timeout: 15_000 });
    await expect(page.getByText("Collected a few days before")).toBeVisible();
    await expect(page.getByText("protected by the Direct Debit Guarantee")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up Direct Debit" })).toHaveCount(0);
    // The set-up email went to the member (once).
    await expect.poll(async () => (await emailsTo(request, email)).filter((e) => e.payload.subject === "Your RAENG Direct Debit is set up").length).toBe(1);
    // Coming back set up, the page doesn't forward anywhere.
    await page.waitForTimeout(6500);
    await expect(page).toHaveURL(new RegExp(`^${PAY}/memberships/join/done\\?signup=`));
    expect(await sql(request, "select d.dd_status, d.method, d.card_label from akb_stripe_customers d join akb_clients c on c.id = d.client_id where c.email = $1", [email])).toEqual([{ dd_status: "active", method: "bacs", card_label: "" }]);

    // In the database: an online-paying membership on the paid charge, and a card payment from Stripe.
    const [m] = await sql(request, "select m.pay_online, m.plan, m.credits from akb_memberships m join akb_clients c on c.id = m.client_id where c.email = $1", [email]);
    expect(m).toEqual({ pay_online: true, plan: "regular", credits: 8 });
    const pays = await sql(request, "select p.method, p.provider, p.amount_pence from akb_payments p join akb_clients c on c.id = p.client_id where c.email = $1", [email]);
    expect(pays).toEqual([{ method: "card", provider: "stripe_test", amount_pence: 6500 }]);

    // Alex is told it's done (not asked to confirm), and the member is welcomed.
    await expect.poll(async () => (await emailsTo(request, "alex-e2e@example.com")).filter((e) => e.payload.subject.startsWith("New member: Online Payer")).length).toBe(1);
    const [alex] = (await emailsTo(request, "alex-e2e@example.com")).filter((e) => e.payload.subject.startsWith("New member: Online Payer"));
    expect(alex.payload.subject).toBe("New member: Online Payer (Regular, paid online)");
    expect(alex.payload.text).toContain("nothing to confirm");
    const [welcome] = await emailsTo(request, email);
    expect(welcome.payload.subject).toBe("Welcome to RAENG: your Regular membership has started");
    expect(welcome.payload.text).toContain("renews automatically every 4 weeks until you cancel");
    expect(welcome.payload.text).toContain("Visa ending 4242");
    expect(welcome.payload.text).toMatch(/Prefer a Direct Debit\? Set it up here and renewals are collected from your bank instead: \S+\/memberships\/join\/done\?signup=/);
  });

  test("the member's plan page has no payment options (only cancelling) and sends questions to Alex's email and phone; the Direct Debit confirmation page", async ({ page, request }) => {
    test.slow();
    const email = `renewer-${Date.now()}@example.com`;
    await toCheckStep(page, "regular", "Card Renewer", email);
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.getByRole("button", { name: "Pay £65.00" }).click();
    await expect(page.getByText("Set up your Direct Debit.")).toBeVisible({ timeout: 15_000 });

    // Sign in with the emailed link, as a member does.
    await page.goto(`${PAY}/account/sign-in`);
    await page.getByRole("textbox", { name: "Your email" }).fill(email);
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Email me a sign-in code" }).click();
    await expect(page.getByRole("status")).toContainText("Check your email");
    await expect.poll(async () => (await emailsTo(request, email)).filter((e) => e.payload.subject.startsWith("Your RAENG sign-in code: ")).length).toBe(1);
    const [signIn] = (await emailsTo(request, email)).filter((e) => e.payload.subject.startsWith("Your RAENG sign-in code: "));
    const link = new URL(/https?:\/\/\S+\/account\/confirm\?token=[A-Za-z0-9_-]{43}/.exec(signIn.payload.text)![0]);
    await page.goto(`${PAY}${link.pathname}${link.search}`);
    // Opening the link doesn't sign in on its own (email scanners open links): the button does.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);

    await page.goto(`${PAY}/account/plan`);
    // Alex's feedback (2026-11-03): no payment options or instructions on the plan page (renewals are automatic from joining); only cancelling stays.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your membership.");
    await expect(page.getByText("Cancel my membership", { exact: true })).toBeVisible();
    for (const gone of ["Set up Direct Debit", "Switch to Direct Debit", "Change card", "Save a card"]) {
      await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
    }
    await expect(page.getByText("Turn on automatic renewals")).toHaveCount(0);
    await expect(page.getByText("Payments", { exact: true })).toHaveCount(0);
    // Questions and pausing go to Alex's email and phone, not Instagram.
    const view = page.locator(".members-view");
    await expect(view.getByText("Pause or questions")).toBeVisible();
    await expect(view.getByRole("link", { name: "hello@raengfitness.co.uk" })).toHaveAttribute("href", "mailto:hello@raengfitness.co.uk");
    await expect(view.getByRole("button", { name: "Show phone number" })).toBeVisible();
    await expect(view.getByRole("link", { name: /Instagram/ })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("plan-after-alex.png"), fullPage: true });

    // The member-area Direct Debit confirmation: the confirming screen until Stripe's word is in, then done.
    await page.goto(`${PAY}/account/direct-debit?returned=1`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirming your Direct Debit.");
    await expect(page.getByText("Bank details sent to Stripe (done)")).toBeVisible();
    // It asks again by itself, in place (no full reload).
    await expect(page).toHaveURL(`${PAY}/account/direct-debit?returned=1&n=1`, { timeout: 6000 });
    await page.screenshot({ path: test.info().outputPath("member-dd-confirming.png"), fullPage: true });
    // Anyone who didn't come back from Stripe goes to the plan page.
    await page.goto(`${PAY}/account/direct-debit`);
    await expect(page).toHaveURL(`${PAY}/account/plan`);
    // Stripe's word arrives (here, straight in the database): the page says it's set up.
    await sql(request, "update akb_stripe_customers set dd_status = 'active', method = 'bacs', payment_method_id = 'pm_e2e_plan', mandate_id = 'mandate_e2e_plan', card_label = '' where client_id = (select id from akb_clients where email = $1)", [email]);
    await page.goto(`${PAY}/account/direct-debit?returned=1`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct Debit set up.");
    await expect(page.getByText("£65 every 4 weeks")).toBeVisible();
    await expect(page.getByText("Collected a few days before")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("member-dd-done.png"), fullPage: true });
    await page.getByRole("link", { name: "Back to your plan" }).click();
    await expect(page).toHaveURL(`${PAY}/account/plan`);
  });

  test("backing out of the bank page leaves the member on the page with the button: they aren't sent back", async ({ page }) => {
    test.slow();
    const email = `backer-${Date.now()}@example.com`;
    await toCheckStep(page, "starter", "Backs Out", email);
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.getByRole("button", { name: "Pay £40.00" }).click();
    await expect(page.getByText("Set up your Direct Debit.")).toBeVisible({ timeout: 15_000 });
    const signup = new URL(page.url()).searchParams.get("signup");
    // What Stripe's "back" link returns to: marked skipped, so nothing forwards.
    await page.goto(`${PAY}/memberships/join/done?signup=${signup}&dd=skipped`);
    await expect(page.getByText("Set up your Direct Debit.")).toBeVisible();
    await expect(page.getByText("Taking you to your bank details")).toHaveCount(0);
    await page.waitForTimeout(7000);
    await expect(page).toHaveURL(new RegExp(`dd=skipped$`));
    await expect(page.getByRole("button", { name: "Set up Direct Debit" })).toBeVisible();
    // Back from the bank page before Stripe's word is in: the confirming screen, which asks again by itself.
    await page.goto(`${PAY}/memberships/join/done?signup=${signup}&dd=returned`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirming your Direct Debit.");
    await expect(page.getByText("Waiting for Stripe's confirmation (in progress)")).toBeVisible();
    await expect(page).toHaveURL(/\/memberships\/join\/done\?signup=.*&dd=returned&n=1$/, { timeout: 6000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath("done-confirming-dd.png"), fullPage: true });
    // After about 45 seconds of asking it stops, and says so in plain words.
    await page.goto(`${PAY}/memberships/join/done?signup=${signup}&dd=returned&n=15`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Still confirming your Direct Debit.");
    { const at = page.url(); await page.waitForTimeout(3500); expect(page.url()).toBe(at); }
    // The button still works.
    await page.goto(`${PAY}/memberships/join/done?signup=${signup}&dd=skipped`);
    await page.getByRole("button", { name: "Set up Direct Debit" }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    // An address that isn't a paid sign-up goes nowhere near Stripe.
    await page.goto(`${PAY}/memberships/join/direct-debit?signup=00000000-0000-4000-8000-000000000000`);
    await expect(page).toHaveURL(/dd=unavailable$/);
    await page.goto(`${PAY}/memberships/join/direct-debit?signup=not-a-uuid`);
    await expect(page).toHaveURL(`${PAY}/memberships`);
  });

  test("leaving Stripe's page without paying starts nothing, and the page says it's waiting", async ({ page, request }) => {
    const email = `leaver-${Date.now()}@example.com`;
    await toCheckStep(page, "starter", "Not Paying", email);
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    const [signup] = await sql(request, "select s.id from akb_membership_signups s join akb_clients c on c.id = s.client_id where c.email = $1", [email]);
    // Coming back by the address alone proves nothing.
    await page.goto(`${PAY}/memberships/join/done?signup=${signup.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirming your payment.");
    await expect(page.getByRole("link", { name: "Go back to Stripe to pay" })).toHaveAttribute("href", new RegExp(`^${STRIPE}/checkout/`));
    expect(await sql(request, "select count(*)::int as n from akb_memberships m join akb_clients c on c.id = m.client_id where c.email = $1", [email])).toEqual([{ n: 0 }]);
    expect(await emailsTo(request, email)).toEqual([]);
  });

  test("Stripe's back arrow says the payment was cancelled, starts nothing, and paying afterwards starts it once", async ({ page, request }) => {
    const email = `backer-${Date.now()}@example.com`;
    await toCheckStep(page, "starter", "Back Arrow", email);
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByLabel(/I've read and agree to the health and risk terms/).check();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page).toHaveURL(new RegExp(`^${PAY}/memberships/join/done\\?signup=.*cancelled=1`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payment cancelled.");
    await expect(page.getByText("You haven't been charged and your membership hasn't started.")).toBeVisible();
    // It doesn't ask again by itself: the address stays put.
    { const at = page.url(); await page.waitForTimeout(3500); expect(page.url()).toBe(at); }
    await expect(page.getByText("You're in.")).toHaveCount(0);
    expect(await sql(request, "select count(*)::int as n from akb_memberships m join akb_clients c on c.id = m.client_id where c.email = $1", [email])).toEqual([{ n: 0 }]);
    expect(await emailsTo(request, email)).toEqual([]);
    // Waiting that goes on too long stops asking and says it will email.
    const [signup] = await sql(request, "select s.id from akb_membership_signups s join akb_clients c on c.id = s.client_id where c.email = $1", [email]);
    await page.goto(`${PAY}/memberships/join/done?signup=${signup.id}&n=15`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Still confirming your payment.");
    // It doesn't ask again by itself: the address stays put.
    { const at = page.url(); await page.waitForTimeout(3500); expect(page.url()).toBe(at); }
    // The same Stripe page is offered again: pay it and the membership starts, once.
    await page.goto(`${PAY}/memberships/join/done?signup=${signup.id}&cancelled=1`);
    await page.getByRole("link", { name: "Go back and pay" }).click();
    await page.getByRole("button", { name: "Pay £40.00" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're in.", { timeout: 15_000 });
    expect(await sql(request, "select count(*)::int as n from akb_memberships m join akb_clients c on c.id = m.client_id where c.email = $1", [email])).toEqual([{ n: 1 }]);
    await page.reload();
    expect(await sql(request, "select count(*)::int as n from akb_memberships m join akb_clients c on c.id = m.client_id where c.email = $1", [email])).toEqual([{ n: 1 }]);
  });

  test("an unknown sign-up says so", async ({ page }) => {
    await page.goto(`${PAY}/memberships/join/done?signup=00000000-0000-4000-8000-000000000000`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that sign-up.");
    await page.goto(`${PAY}/memberships/join/done?signup=not-a-uuid`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that sign-up.");
  });

  test("the plan list and the join page say you pay with Stripe, and the check step is accessible", async ({ page }) => {
    await page.goto(`${PAY}/memberships`);
    await page.locator("#memberships").getByRole("list", { name: "Membership plans" }).locator("> li").first().click({ position: { x: 120, y: 20 } });
    await expect(page.locator("#memberships")).toContainText("Next, your first class and details, then pay with Stripe.");
    await toCheckStep(page, "dedicated", "Axe Payer", "axe-payer@example.com");
    await page.waitForTimeout(1300);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

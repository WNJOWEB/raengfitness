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
    await expect(page.getByText("Stripe's secure page takes £65 for your first 4 weeks")).toBeVisible();
    // The agreement is still required before paying.
    await page.getByRole("button", { name: "Pay £65" }).click();
    await expect(page.locator("#agree-error")).toBeVisible();
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByRole("button", { name: "Pay £65" }).click();

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

    // Direct Debit is the first option: the page says so, forwards to Stripe's bank page after a few seconds on its own, and the saved card is the fallback.
    await expect(page.getByText("Set up your Direct Debit.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Taking you to your bank details in a moment")).toBeVisible();
    await expect(page.getByText("Your bank details go straight to Stripe, not to us.")).toBeVisible();
    await expect(page.getByText("Prefer to pay by card? There's nothing more to do: your Visa ending 4242 is charged automatically every 4 weeks")).toBeVisible();
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
    await expect.poll(async () => (await emailsTo(request, "alex-e2e@example.com")).filter((e) => e.payload.subject.includes("Online Payer")).length).toBe(1);
    const [alex] = (await emailsTo(request, "alex-e2e@example.com")).filter((e) => e.payload.subject.includes("Online Payer"));
    expect(alex.payload.subject).toBe("New member: Online Payer (Regular, paid online)");
    expect(alex.payload.text).toContain("nothing to confirm");
    const [welcome] = await emailsTo(request, email);
    expect(welcome.payload.subject).toBe("Welcome to RAENG: your Regular membership has started");
    expect(welcome.payload.text).toContain("renews automatically every 4 weeks until you cancel");
    expect(welcome.payload.text).toContain("Visa ending 4242");
    expect(welcome.payload.text).toContain("Prefer a Direct Debit? Set it up from your account");
  });

  test("the member's plan page shows the card their renewals are charged to; they change it on Stripe's page and can cancel", async ({ page, request }) => {
    test.slow();
    const email = `renewer-${Date.now()}@example.com`;
    await toCheckStep(page, "regular", "Card Renewer", email);
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByRole("button", { name: "Pay £65" }).click();
    await page.getByRole("button", { name: "Pay £65.00" }).click();
    await expect(page.getByText("Set up your Direct Debit.")).toBeVisible({ timeout: 15_000 });

    // Sign in with the emailed link, as a member does.
    await page.goto(`${PAY}/account/sign-in`);
    await page.getByRole("textbox", { name: "Your email" }).fill(email);
    await page.waitForTimeout(3100);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status")).toContainText("Check your email");
    await expect.poll(async () => (await emailsTo(request, email)).filter((e) => e.payload.subject === "Your RAENG sign-in link").length).toBe(1);
    const [signIn] = (await emailsTo(request, email)).filter((e) => e.payload.subject === "Your RAENG sign-in link");
    const link = new URL(/https?:\/\/\S+\/account\/confirm\?token=[A-Za-z0-9_-]{43}/.exec(signIn.payload.text)![0]);
    await page.goto(`${PAY}${link.pathname}${link.search}`);
    // Opening the link doesn't sign in on its own (email scanners open links): the button does.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);

    await page.goto(`${PAY}/account/plan`);
    // Direct Debit is the first option; the saved card is what's charged until it's set up.
    await expect(page.getByText("Pay by Direct Debit.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up Direct Debit" })).toBeVisible();
    await expect(page.getByText(/Until then, your Visa ending 4242 is charged every 4 weeks, on the day each new period starts\. We email you 5 days before each payment\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch to Direct Debit" })).toHaveCount(0);

    // Change card: Stripe's page carries the agreement and takes no money; coming back, the new card shows.
    await page.getByRole("button", { name: "Change card" }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    await expect(page.getByRole("heading", { name: "Save your card" })).toBeVisible();
    await expect(page.locator(".consent")).toContainText("£65 will be charged to this card every 4 weeks");
    await page.getByRole("button", { name: "Save card" }).click();
    await expect(page).toHaveURL(new RegExp(`^${PAY}/account/plan\\?done=card_updated`));
    await expect(page.getByText("Thanks, your card is saved. Your renewals will be charged to it.")).toBeVisible();
    await expect(page.getByText(/Until then, your Mastercard ending 4444 is charged every 4 weeks/)).toBeVisible();
    expect(await sql(request, "select d.method, d.card_label from akb_stripe_customers d join akb_clients c on c.id = d.client_id where c.email = $1", [email])).toEqual([{ method: "card", card_label: "Mastercard ending 4444" }]);
    // Direct Debit from the plan page: Stripe's bank page, then the confirming screen, then done.
    await page.goto(`${PAY}/account/plan`);
    await page.getByRole("button", { name: "Set up Direct Debit" }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    await expect(page.getByRole("heading", { name: "Set up Direct Debit" })).toBeVisible();
    const bankPage = page.url();
    // Back before Stripe's word is in: the confirming screen, with the steps, asking again by itself.
    await page.goto(`${PAY}/account/direct-debit?returned=1`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirming your Direct Debit.");
    await expect(page.getByText("Bank details sent to Stripe (done)")).toBeVisible();
    await expect(page.locator('meta[http-equiv="refresh"]')).toHaveAttribute("content", "3;url=/account/direct-debit?returned=1&n=1");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath("member-dd-confirming.png"), fullPage: true });
    // Anyone who didn't come back from Stripe goes to the plan page.
    await page.goto(`${PAY}/account/direct-debit`);
    await expect(page).toHaveURL(`${PAY}/account/plan`);
    // Then they authorise: Stripe's word arrives, and the page says it's set up.
    await page.goto(bankPage);
    await page.getByRole("button", { name: "Authorise Direct Debit" }).click();
    await expect(page).toHaveURL(`${PAY}/account/direct-debit?returned=1`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct Debit set up.", { timeout: 15_000 });
    await expect(page.getByText("£65 every 4 weeks")).toBeVisible();
    await expect(page.getByText("Collected a few days before")).toBeVisible();
    // Phone first (390 px): nothing overflows sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("member-dd-done.png"), fullPage: true });
    await page.getByRole("link", { name: "Back to your plan" }).click();
    await expect(page.getByText("Direct Debit is set up.")).toBeVisible();
    // The set-up email went to the member (once).
    await expect.poll(async () => (await emailsTo(request, email)).filter((e) => e.payload.subject === "Your RAENG Direct Debit is set up").length).toBe(1);
  });

  test("backing out of the bank page leaves the member on the page with the button: they aren't sent back", async ({ page }) => {
    test.slow();
    const email = `backer-${Date.now()}@example.com`;
    await toCheckStep(page, "starter", "Backs Out", email);
    await page.getByLabel(/I've read and agree to the membership terms/).check();
    await page.getByRole("button", { name: "Pay £40" }).click();
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
    await expect(page.locator('meta[http-equiv="refresh"]')).toHaveAttribute("content", /^3;url=\/memberships\/join\/done\?signup=.*&dd=returned&n=1$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath("done-confirming-dd.png"), fullPage: true });
    // After about 45 seconds of asking it stops, and says so in plain words.
    await page.goto(`${PAY}/memberships/join/done?signup=${signup}&dd=returned&n=15`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Still confirming your Direct Debit.");
    await expect(page.locator('meta[http-equiv="refresh"]')).toHaveCount(0);
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
    await page.getByRole("button", { name: "Pay £40" }).click();
    await expect(page).toHaveURL(new RegExp(`^${STRIPE}/checkout/`));
    const [signup] = await sql(request, "select s.id from akb_membership_signups s join akb_clients c on c.id = s.client_id where c.email = $1", [email]);
    // Coming back by the address alone proves nothing.
    await page.goto(`${PAY}/memberships/join/done?signup=${signup.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirming your payment.");
    await expect(page.getByRole("link", { name: "Go back to Stripe to pay" })).toHaveAttribute("href", new RegExp(`^${STRIPE}/checkout/`));
    expect(await sql(request, "select count(*)::int as n from akb_memberships m join akb_clients c on c.id = m.client_id where c.email = $1", [email])).toEqual([{ n: 0 }]);
    expect(await emailsTo(request, email)).toEqual([]);
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

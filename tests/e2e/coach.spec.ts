import { expect, test } from "@playwright/test";

const coach = { email: "coach-e2e@example.com", password: "correct-horse" };

async function signIn(page: import("@playwright/test").Page, password = coach.password) {
  await page.goto("/coach/login");
  await page.getByLabel("Email").fill(coach.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("the coach area redirects to the login page when signed out", async ({ page }) => {
  await page.goto("/coach");
  await expect(page).toHaveURL(/\/coach\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
});

test("the footer links to the coach login, which is not indexed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Coach Portal" }).click();
  await expect(page).toHaveURL(/\/coach\/login$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).not.toMatch(/\/coach(<|\/)/);
});

test("a wrong password shows an error and keeps the email", async ({ page }) => {
  await signIn(page, "wrong-password");
  await expect(page.locator("#login-error")).toContainText("don't match");
  await expect(page.getByLabel("Email")).toHaveValue(coach.email);
  await expect(page).toHaveURL(/\/coach\/login$/);
});

test("a non-coach address is refused like a wrong password", async ({ page }) => {
  await page.goto("/coach/login");
  await page.getByLabel("Email").fill("someone-else@example.com");
  await page.getByLabel("Password").fill(coach.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toContainText("don't match");
});

test("the coach signs in, stays signed in after the access token expires, and signs out", async ({ page, context }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByText(`Signed in as ${coach.email}`)).toBeVisible();

  const cookies = await context.cookies();
  for (const name of ["akb_coach_access", "akb_coach_refresh"]) {
    const cookie = cookies.find((c) => c.name === name);
    expect(cookie, name).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/coach" });
  }

  // Simulate the short-lived access cookie expiring: the proxy refreshes the session.
  await context.clearCookies({ name: "akb_coach_access" });
  await page.goto("/coach");
  await expect(page.getByText(`Signed in as ${coach.email}`)).toBeVisible();

  // Sign out is in the account menu (the avatar), as in the owner's coach design.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/coach\/login$/);
  await page.goto("/coach");
  await expect(page).toHaveURL(/\/coach\/login$/);
});

test("a forged session cookie is rejected", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "akb_coach_access", value: "forged", url: `${baseURL}/coach` }]);
  await page.goto("/coach");
  await expect(page).toHaveURL(/\/coach\/login$/);
});

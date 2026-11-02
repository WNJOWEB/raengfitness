import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { classOccurrences } from "../../src/lib/coach/classes";
import { addDays, londonToday, weekday } from "../../src/lib/coach/time";

/**
 * The coach portal against the Supabase stand-in (real migrations on an
 * in-process Postgres). Tests run in parallel on one database, so each uses
 * its own names and emails and never assumes it is alone.
 */
const SUPABASE = `http://localhost:${process.env.MOCK_SUPABASE_PORT ?? 3298}`;
const coach = { email: "coach-e2e@example.com", password: "correct-horse" };

async function signIn(page: Page) {
  await page.goto("/coach/login");
  await page.getByLabel("Email").fill(coach.email);
  await page.getByLabel("Password").fill(coach.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/coach$/);
}

async function sql<T = Record<string, unknown>>(request: APIRequestContext, query: string, params: unknown[] = []): Promise<T[]> {
  const response = await request.post(`${SUPABASE}/test/sql`, { data: { sql: query, params } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T[];
}

let counter = 0;
function unique(label: string) {
  counter += 1;
  const id = `${Date.now().toString(36)}${counter}${Math.floor(Math.random() * 1e4)}`;
  return { name: `${label} ${id}`, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${id}@example.com` };
}

const today = londonToday();
/** The next date (after today) on a weekday, 0 = Monday. */
function next(dayIndex: number, weeksAhead = 0): string {
  let d = addDays(today, 1);
  while (weekday(d) !== dayIndex) d = addDays(d, 1);
  return addDays(d, weeksAhead * 7);
}

async function seedRequest(request: APIRequestContext, person: { name: string; email: string; phone?: string }, opts: { service?: string; summary?: string; details?: Record<string, string> } = {}) {
  const [row] = await sql<{ id: string }>(
    request,
    `insert into akb_booking_requests (idempotency_key, kind, service, summary, name, email, phone, message, details)
     values ($1, 'booking', $2, $3, $4, $5, $6, 'Looking forward to it', $7::jsonb) returning id`,
    [`e2e-${person.email}-${Math.random()}`, opts.service ?? "Group class", opts.summary ?? "", person.name, person.email, person.phone ?? "", JSON.stringify({ experience: "ROOKIE MODE", ...opts.details })],
  );
  return row.id;
}

/** The emails the mock mail server has recorded for an address. */
async function mailTo(request: APIRequestContext, to: string) {
  const all = (await (await request.get(`http://localhost:${process.env.MOCK_EMAIL_PORT ?? 3299}/requests`)).json()) as { payload: { to: string[]; subject: string; text: string } }[];
  return all.filter((e) => e.payload.to.includes(to)).map((e) => e.payload);
}

async function seedClient(request: APIRequestContext, person: { name: string; email: string; phone?: string }) {
  const [row] = await sql<{ id: string }>(request, "insert into akb_clients (full_name, email, phone, status) values ($1, $2, $3, 'active') returning id", [person.name, person.email, person.phone ?? ""]);
  return row.id;
}

test.describe("access", () => {
  const routes = [
    "/coach",
    "/coach/requests",
    "/coach/requests/00000000-0000-4000-8000-000000000000",
    "/coach/clients",
    "/coach/clients/new",
    "/coach/clients/00000000-0000-4000-8000-000000000000",
    "/coach/classes",
    `/coach/classes/${next(5)}/sat-morning`,
    "/coach/sessions",
    "/coach/sessions/new",
    "/coach/online",
    "/coach/memberships",
    "/coach/memberships/new",
    "/coach/memberships/00000000-0000-4000-8000-000000000000",
    "/coach/finances",
    "/coach/finances/payments/new",
    "/coach/schedule",
    "/coach/members",
    "/coach/inbox",
  ];
  for (const route of routes) {
    test(`${route} needs the coach login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/coach\/login$/);
    });
  }

  test("the CSV export needs the coach login", async ({ request }) => {
    const response = await request.get("/coach/finances/export?from=2026-01-01&to=2026-12-31", { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.headers()["content-type"] ?? "").not.toContain("text/csv");
  });

  test("the database refuses requests without the secret key", async ({ request }) => {
    for (const table of ["akb_clients", "akb_payments", "akb_booking_requests"]) {
      const response = await request.get(`${SUPABASE}/rest/v1/${table}?select=*`, { headers: { apikey: "sb_publishable_wrong" } });
      expect(response.status(), table).toBe(401);
    }
  });
});

test("confirming a class request creates the client, books the place, and payments settle it", async ({ page, request }) => {
  const person = unique("Cara Class");
  const date = next(5, 1);
  const id = await seedRequest(request, person, { summary: `Saturday ${date}, 10:15 am`, details: { classDate: date, classSlot: "sat-morning" } });
  await signIn(page);

  // The dashboard lists it as needing attention, linking to it.
  await expect(page.getByRole("link", { name: new RegExp(`New request: ${person.name}`) })).toBeVisible();

  await page.goto("/coach/requests");
  await page.getByRole("link", { name: new RegExp(person.name) }).click();
  await expect(page).toHaveURL(new RegExp(`/coach/requests/${id}$`));
  await expect(page.getByText("No client has this email address yet.")).toBeVisible();
  await expect(page.getByLabel("Class", { exact: true })).toHaveValue(`${date}|sat-morning`);
  await page.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Confirmed" })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();

  // They're emailed at once, in the words the "Let them know" box suggests, and marked as told.
  await expect(page.getByLabel("Message")).toHaveValue(/You're booked in: Kettlebell Training/);
  await expect(page.getByText(/^Told /)).toBeVisible();
  await expect
    .poll(async () => {
      const all = (await (await request.get(`http://localhost:${process.env.MOCK_EMAIL_PORT ?? 3299}/requests`)).json()) as { payload: { to: string[]; subject: string; text: string } }[];
      const mine = all.find((e) => e.payload.to.includes(person.email));
      return mine ? `${mine.payload.subject} | ${mine.payload.text.includes("You're booked in: Kettlebell Training")}` : null;
    })
    .toBe("Booked: Group class | true");

  // One client, linked; one place on the class.
  const clients = await sql<{ id: string }>(request, "select id from akb_clients where email = $1", [person.email]);
  expect(clients).toHaveLength(1);
  const clientId = clients[0].id;

  await page.goto(`/coach/classes/${date}/sat-morning`);
  const row = page.getByRole("listitem").filter({ hasText: person.name });
  await expect(row.getByText("Booked", { exact: true })).toBeVisible();
  await expect(row.getByText("Unpaid")).toBeVisible();
  await row.getByRole("button", { name: "Attended" }).click();
  await expect(row.getByText("Attended", { exact: true })).toBeVisible();

  // A £7 part payment (of the £12 class), then the rest.
  await row.getByRole("link", { name: "Record payment" }).click();
  await expect(page.getByLabel("Amount received")).toHaveValue("12");
  await page.getByLabel("Amount received").fill("7");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  // The client is sent a receipt for what Alex recorded (once).
  await expect.poll(async () => (await mailTo(request, person.email)).filter((e) => e.subject === "We've received your payment: £7.00").length).toBe(1);
  expect((await mailTo(request, person.email)).find((e) => e.subject === "We've received your payment: £7.00")?.text).toContain("We've recorded your");

  await page.goto(`/coach/clients/${clientId}?tab=payments`);
  await expect(page.getByText("£5.00 left")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Outstanding" }).getByText("£0.00")).toBeVisible(); // not due yet
  await expect(page.getByRole("listitem").filter({ hasText: "Due later" }).getByText("£5.00")).toBeVisible();
  await page.getByRole("link", { name: "Pay", exact: true }).click();
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();

  // Refund £5 of that second payment for the class (it's owed again).
  const refund = page.getByRole("form", { name: "Record a refund" });
  await refund.getByLabel("Amount refunded").fill("5");
  await refund.getByLabel(/^Refund for/).selectOption({ index: 1 });
  await refund.getByLabel("Reason").fill("Overpaid by mistake");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Refund recorded." })).toBeVisible();

  await page.goto(`/coach/clients/${clientId}?tab=payments`);
  await expect(page.getByRole("listitem").filter({ hasText: "Total received" }).getByText("£7.00")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Due later" }).getByText("£5.00")).toBeVisible();
});

test("a returning client's request is linked by email and reuses their record", async ({ page, request }) => {
  const person = unique("Ray Return");
  const clientId = await seedClient(request, person);
  const id = await seedRequest(request, { ...person, email: person.email.toUpperCase() }, { service: "One-to-one", summary: "Preferred: Mon, Tue" });
  await signIn(page);
  await page.goto("/coach/requests");
  await expect(page.getByRole("link", { name: new RegExp(person.name) }).getByText("Returning client")).toBeVisible();
  await page.goto(`/coach/requests/${id}`);
  await expect(page.getByText(/Linked to client/)).toBeVisible();
  await expect(page.getByRole("radio", { name: new RegExp(`${person.name} \\(existing client\\)`) })).toBeChecked();

  // Confirm with a one-to-one at a date and time.
  const date = next(1, 2);
  await page.getByRole("radio", { name: "A one-to-one session" }).check();
  await page.getByLabel("Date", { exact: true }).fill(date);
  await page.getByLabel("Start", { exact: true }).fill("07:00");
  await page.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Confirmed" })).toBeVisible();
  expect(await sql(request, "select id from akb_clients where lower(email) = lower($1)", [person.email])).toEqual([{ id: clientId }]);
  expect(await sql(request, "select count(*)::int as n from akb_pt_sessions where client_id = $1", [clientId])).toEqual([{ n: 1 }]);
});

test("a phone-only match is offered, never linked, and the coach must choose", async ({ page, request }) => {
  const existing = unique("Pia Phone");
  const phone = `07700 9${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
  await seedClient(request, { ...existing, phone });
  const visitor = unique("Pia Other");
  const id = await seedRequest(request, { ...visitor, phone: phone.replace("07700", "+44 7700") }, { details: { classDate: next(0, 1), classSlot: "mon-evening" } });
  await signIn(page);
  await page.goto(`/coach/requests/${id}`);
  await expect(page.getByText("Possibly the same person (not linked automatically):")).toBeVisible();
  await expect(page.getByRole("link", { name: existing.name })).toBeVisible();
  await page.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("Please check");
  await expect(page.getByText("Choose an existing client or create a new one.")).toBeVisible();
  // Nothing was changed.
  expect(await sql(request, "select status, client_id from akb_booking_requests where id = $1", [id])).toEqual([{ status: "new", client_id: null }]);
});

test("declining needs a reason; cancelling a confirmed request cancels its class place", async ({ page, request }) => {
  const a = unique("Dan Decline");
  const declineId = await seedRequest(request, a);
  const b = unique("Cat Cancel");
  const date = next(2, 1);
  const cancelId = await seedRequest(request, b, { details: { classDate: date, classSlot: "wed-evening" } });
  await signIn(page);

  await page.goto(`/coach/requests/${declineId}`);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Enter the note.")).toBeVisible();
  await page.getByRole("form", { name: "Decline request" }).getByLabel("Reason").fill("No spaces that week");
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Declined" })).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue(/can't confirm it this time/);

  await page.goto(`/coach/requests/${cancelId}`);
  await page.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Confirmed" })).toBeVisible();
  await page.getByRole("form", { name: "Cancel booking" }).getByLabel("Reason").fill("Injured, will rebook");
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cancelled, with its booking." })).toBeVisible();
  const places = await sql(request, "select a.status from akb_class_attendance a where a.request_id = $1", [cancelId]);
  expect(places).toEqual([{ status: "cancelled" }]);
  // Its unpaid charge was cancelled with it.
  const charges = await sql<{ voided: boolean }>(request, "select voided_at is not null as voided from akb_charges c join akb_class_attendance a on a.id = c.attendance_id where a.request_id = $1", [cancelId]);
  expect(charges).toEqual([{ voided: true }]);
});

test("class pages exist only for real timetable dates", async ({ page }) => {
  await signIn(page);
  const saturday = next(5);
  await page.goto(`/coach/classes/${saturday}/sat-morning`);
  await expect(page.getByRole("heading", { level: 2, name: "Attendees" })).toBeVisible();
  // The page streams after the session check, so a bad date shows the not-found page (status already sent).
  for (const path of [`/coach/classes/${addDays(saturday, 1)}/sat-morning`, `/coach/classes/${saturday}/no-such-class`, "/coach/classes/2026-02-30/mon-evening"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" }), path).toBeVisible();
    await expect(page.getByRole("heading", { name: "Attendees" })).toHaveCount(0);
  }
});

test("class capacity: a date's own size is kept, and full is refused", async ({ page, request }) => {
  const date = next(0, 3);
  const p1 = unique("Cap One");
  const p2 = unique("Cap Two");
  await seedClient(request, p1);
  await seedClient(request, p2);
  await signIn(page);
  await page.goto(`/coach/classes/${date}/mon-evening`);
  // Other tests may book this class too: set a capacity just above whatever is booked now.
  const booked = Number((await page.locator("h1 + p").innerText()).match(/· (\d+)/)?.[1] ?? 0);
  await expect(page.getByText("Full", { exact: true })).toHaveCount(0);
  await page.getByLabel("Capacity").fill(String(booked + 1));
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/This class holds \d+/)).toBeVisible();
  const add = page.getByRole("form", { name: "Add someone to this class" });
  await add.getByLabel("Client").selectOption({ label: p1.name });
  await add.getByRole("button", { name: "Add to class" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${p1.name} added` })).toBeVisible();
  await expect(page.getByText("Full", { exact: true })).toBeVisible();
  await add.getByLabel("Client").selectOption({ label: p2.name });
  await add.getByRole("button", { name: "Add to class" }).click();
  await expect(add.getByRole("alert")).toContainText("That class is full");
});

test("class size: 15 to begin with, and Alex changes it for every class", async ({ page }) => {
  await signIn(page);
  await page.goto("/coach/classes");
  const form = page.getByRole("form", { name: "Class size" });
  await expect(form.getByLabel("Places in every class")).toHaveValue("15");
  await form.getByLabel("Places in every class").fill("0");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toContainText("Please check the highlighted fields");
  await form.getByLabel("Places in every class").fill("14");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Classes now hold 14" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("form", { name: "Class size" }).getByLabel("Places in every class")).toHaveValue("14");
  // A date shows the usual size until it has its own.
  await page.goto(`/coach/classes/${next(0, 3)}/mon-evening`);
  await expect(page.locator("h1 + p")).toContainText(/of (14|\d+) booked/);
  await page.goto("/coach/classes");
  const back = page.getByRole("form", { name: "Class size" });
  await back.getByLabel("Places in every class").fill("15");
  await back.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Classes now hold 15" })).toBeVisible();
});

test("one-to-one: overlapping times are refused; reschedule and cancel keep the history", async ({ page, request }) => {
  const person = unique("Sam Session");
  const clientId = await seedClient(request, person);
  const date = next(3, 6);
  const hour = String(6 + Math.floor(Math.random() * 12)).padStart(2, "0");
  await signIn(page);
  await page.goto(`/coach/sessions/new?client=${clientId}`);
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Start").fill(`${hour}:00`);
  await page.getByLabel("Agreed price").fill("40");
  await page.getByRole("button", { name: "Book session" }).click();
  await expect(page).toHaveURL(/\/coach\/sessions\/[0-9a-f-]{36}$/);
  const sessionUrl = page.url();

  await page.goto(`/coach/sessions/new?client=${clientId}`);
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Start").fill(`${hour}:30`);
  await page.getByRole("button", { name: "Book session" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("overlaps another one-to-one session");

  await page.goto(sessionUrl);
  await page.getByRole("form", { name: "Reschedule" }).getByLabel("Start").fill(`${hour}:15`);
  await page.getByRole("button", { name: "Move session" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved" })).toBeVisible();
  await expect(page.getByText(/^Moved from /)).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel session" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Marked cancelled" })).toBeVisible();
  const charges = await sql<{ voided: boolean }>(request, "select voided_at is not null as voided from akb_charges where client_id = $1", [clientId]);
  expect(charges).toEqual([{ voided: true }]);
});

test("packages count sessions used and give a cancelled one back", async ({ page, request }) => {
  const person = unique("Kim Package");
  const clientId = await seedClient(request, person);
  await signIn(page);
  await page.goto(`/coach/clients/${clientId}?tab=packages`);
  const form = page.getByRole("form", { name: "Add a package" });
  await form.getByLabel("Name").fill("2 sessions");
  await form.getByLabel("Sessions").fill("2");
  await form.getByLabel("Price").fill("70");
  await form.getByRole("button", { name: "Add package" }).click();
  await expect(page.getByText("2 of 2 left")).toBeVisible();

  const urls: string[] = [];
  for (const [i, time] of ["08:00", "09:00"].entries()) {
    await page.goto(`/coach/sessions/new?client=${clientId}`);
    await page.getByLabel("Date").fill(next(4, 8 + i));
    await page.getByLabel("Start").fill(time);
    await page.getByLabel("Use a package").selectOption({ label: `2 sessions: ${2 - i} left` });
    await page.getByRole("button", { name: "Book session" }).click();
    await expect(page).toHaveURL(/\/coach\/sessions\/[0-9a-f-]{36}$/);
    urls.push(page.url());
  }
  // No package left to choose, and the package shows none left.
  await page.goto(`/coach/sessions/new?client=${clientId}`);
  await expect(page.getByText("No package with sessions left.")).toBeVisible();
  await page.goto(`/coach/clients/${clientId}?tab=packages`);
  await expect(page.getByText("0 of 2 left")).toBeVisible();

  await page.goto(urls[1]);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel session" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The package place is given back." })).toBeVisible();
  await page.goto(`/coach/clients/${clientId}?tab=packages`);
  await expect(page.getByText("1 of 2 left")).toBeVisible();
});

test("online coaching: plan, check-in schedule and a period charge", async ({ page, request }) => {
  const person = unique("Oli Online");
  const clientId = await seedClient(request, person);
  await signIn(page);
  await page.goto(`/coach/online/new?client=${clientId}`);
  await page.getByLabel("Start date").fill(today);
  await page.getByLabel("Next renewal").fill(today);
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page).toHaveURL(/\/coach\/online\/[0-9a-f-]{36}$/);

  await page.getByLabel("How it went").fill("Hit every session this week");
  await page.getByRole("textbox", { name: /^Agreed actions/ }).fill("Add a heavier swing day");
  await page.getByRole("button", { name: "Log check-in" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Check-in logged" })).toBeVisible();
  await expect(page.getByText("Agreed: Add a heavier swing day")).toBeVisible();
  const [{ next_check_in_on }] = await sql<{ next_check_in_on: string }>(request, "select to_char(next_check_in_on, 'YYYY-MM-DD') as next_check_in_on from akb_subscriptions where client_id = $1", [clientId]);
  expect(next_check_in_on).toBe(addDays(today, 7));

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Charge period from/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Charge added" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "£79.00" }).getByText("Unpaid")).toBeVisible();

  await page.goto("/coach/online");
  await expect(page.getByRole("link", { name: new RegExp(person.name) })).toBeVisible();
  await expect(page.getByText("Forecast from active plans, not money received")).toBeVisible();
});

test("online coaching: write the programme, answer the client's check-in and messages", async ({ page, request }) => {
  const person = unique("Pia Programme");
  const clientId = await seedClient(request, person);
  await signIn(page);
  await page.goto(`/coach/online/new?client=${clientId}`);
  await page.getByLabel("Start date").fill(today);
  await page.getByLabel("Next renewal").fill(today);
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page).toHaveURL(/\/coach\/online\/[0-9a-f-]{36}$/);
  const [{ id: subscription }] = await sql<{ id: string }>(request, "select id from akb_subscriptions where client_id = $1", [clientId]);

  // The programme: a mistake is pointed out by line, then it saves and repeats the week for the rest.
  await page.getByLabel("Programme name").fill("Snatch prep");
  await page.getByLabel("Goal").fill("First 24 kg snatch");
  await page.getByLabel("Exercises").fill("Day A\nSwing | many | 10 | 24 kg");
  await page.getByRole("button", { name: "Create programme" }).click();
  await expect(page.getByText('Line 2: "Swing" needs a number of sets from 1 to 20.')).toBeVisible();
  await page.getByLabel("Exercises").fill("Week 1\nDay A\nTwo-hand swing | 5 | 10 | 24 kg\nStrict press | 4 | 5 each | 16 kg | Pause 2 s at the top. | https://youtu.be/press.demo\nDay B\nSnatch | 6 | 5 each | 16 kg");
  await page.getByRole("button", { name: "Create programme" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Programme saved" })).toBeVisible();
  const [{ n }] = await sql<{ n: number }>(request, "select count(*)::int as n from akb_coaching_items i join akb_coaching_programmes p on p.id = i.programme_id where p.subscription_id = $1", [subscription]);
  expect(n).toBe(18);
  await page.reload();
  await expect(page.getByLabel("Exercises")).toHaveValue(/^Week 1\nDay A\nTwo-hand swing \| 5 \| 10 \| 24 kg\nStrict press \| 4 \| 5 each \| 16 kg \| Pause 2 s at the top\. \| https:\/\/youtu\.be\/press\.demo\nDay B/);
  // Videos are links only: a link that isn't https is refused.
  await page.getByLabel("Exercises").fill("Day A\nSwing | 3 | 10 | 24 kg | | http://example.com/v");
  await page.getByRole("button", { name: "Save programme" }).click();
  await expect(page.getByText(/the demo link must start with https/)).toBeVisible();

  // The client checks in and messages from their app (here, straight into the database); the coach sees both.
  await sql(request, "insert into akb_coaching_check_ins (subscription_id, week_of, programme_week, energy, sleep, training, wins) values ($1, date_trunc('week', current_date)::date, 1, 4, 3, 5, 'All sessions in')", [subscription]);
  await sql(request, "insert into akb_coaching_messages (subscription_id, from_client, body) values ($1, true, 'Is Day B fine on Saturday?')", [subscription]);
  await page.goto("/coach/online");
  await expect(page.getByRole("link", { name: new RegExp(`${person.name}[\\s\\S]*1 new message`) })).toBeVisible();
  await page.goto(`/coach/online/${subscription}`);
  await expect(page.getByText("Energy 4 · Sleep 3 · Training 5")).toBeVisible();
  await expect(page.getByText("Is Day B fine on Saturday?")).toBeVisible();
  await page.getByLabel("Reply", { exact: true }).fill("Good week. Keep the pause.");
  await page.getByRole("button", { name: "Send reply" }).click();
  // The form gives way to the reply once it is saved.
  await expect(page.getByText("Your reply: Good week. Keep the pause.")).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Yes, any order works.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sent." })).toBeVisible();
  const [{ reply, read }] = await sql<{ reply: string; read: boolean }>(request, "select (select coach_reply from akb_coaching_check_ins where subscription_id = $1) as reply, (select bool_and(read_at is not null) from akb_coaching_messages where subscription_id = $1 and from_client) as read", [subscription]);
  expect(reply).toBe("Good week. Keep the pause.");
  expect(read).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the coach tabs (2026-10-28): check in today's class, the schedule, members and the inbox", async ({ page, request }) => {
  test.slow();
  const person = unique("Tab Tester");
  const clientId = await seedClient(request, person);
  await sql(request, "select akb_start_membership($1, 'regular', 'Regular', 6500, 8, akb_london_today())", [clientId]);
  // Put them on the next class that hasn't ended, whatever day it is.
  const occ = classOccurrences(today, addDays(today, 14)).find((o) => new Date(o.startsAt).getTime() + 3_600_000 > Date.now())!;
  await sql(request, "select akb_add_attendee($1::uuid, $2::text, $3::date, $4::timestamptz, 60, 0, 'Class', null)", [clientId, occ.slot.id, occ.date, occ.startsAt]);
  // Something in each inbox group.
  const requester = unique("Rita Request");
  await seedRequest(request, requester, { service: "One-to-one", summary: "Tuesdays after six" });
  const payer = unique("Pat Payer");
  const payerId = await seedClient(request, payer);
  await sql(request, "insert into akb_charges (client_id, service, description, amount_pence, due_on) values ($1, 'group', 'Kettlebell training', 1200, $2)", [payerId, today]);
  await signIn(page);

  // Today: the greeting, three counts, the next session and who's booked.
  await page.goto("/coach");
  await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Afternoon|Evening)\.$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /payments to confirm/ })).toHaveAttribute("href", "/coach/inbox?f=pay");
  await expect(page.getByRole("link", { name: /members low on credits/ })).toHaveAttribute("href", "/coach/members?f=low");
  const session = page.getByRole("region", { name: "Next session" });
  await expect(session).toContainText("Next session");
  await expect(session.getByRole("link", { name: "Manage" })).toHaveAttribute("href", /\/coach\/classes\/\d{4}-\d{2}-\d{2}\/[a-z-]+$/);
  const mail = await session.getByRole("link", { name: "Message class" }).getAttribute("href");
  expect(mail).toMatch(/^mailto:\?bcc=/);
  // The roster: tap here, tap again to undo; a no-show is the other mark.
  const here = page.getByRole("button", { name: `Mark ${person.name} as here` });
  await expect(here).toHaveAttribute("aria-pressed", "false");
  await here.click();
  await expect(page.getByRole("button", { name: `Mark ${person.name} as here` })).toHaveAttribute("aria-pressed", "true");
  expect((await sql<{ status: string }>(request, "select status from akb_class_attendance where client_id = $1", [clientId]))[0].status).toBe("attended");
  await page.getByRole("button", { name: `Mark ${person.name} as here` }).click();
  await expect(page.getByRole("button", { name: `Mark ${person.name} as here` })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: `Mark ${person.name} as no-show` }).click();
  await expect(page.getByRole("button", { name: `Mark ${person.name} as no-show` })).toHaveAttribute("aria-pressed", "true");
  expect((await sql<{ status: string }>(request, "select status from akb_class_attendance where client_id = $1", [clientId]))[0].status).toBe("no_show");
  // Everything the old dashboard held is still on the page.
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revenue" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The tab bar: the inbox badge counts what is waiting.
  const tabs = page.getByRole("navigation", { name: "Coach", exact: true });
  await expect(tabs.getByRole("link", { name: /^Inbox/ })).toContainText("waiting");

  // Schedule: week tabs, and the class opens its page.
  await tabs.getByRole("link", { name: "Schedule" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /bookings? this week\.$/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Week" }).getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Week" }).getByRole("link", { name: "Next week" }).click();
  await expect(page).toHaveURL(/week=1/);
  await expect(page.getByRole("link", { name: "Add a 1:1 session" })).toHaveAttribute("href", "/coach/sessions/new");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Members: search, filters, and a row opens the client record.
  await tabs.getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { name: "Online coaching" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search members" }).fill(person.name);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`${person.name}[\\s\\S]*Regular`) })).toHaveAttribute("href", `/coach/clients/${clientId}`);
  await page.goto(`/coach/members?f=payg&q=${encodeURIComponent(payer.name)}`);
  await expect(page.getByRole("link", { name: new RegExp(`${payer.name}[\\s\\S]*Pay as you go`) })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Filter members" }).getByRole("link", { name: /^Pay as you go/ })).toHaveAttribute("aria-current", "page");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Inbox: a request, a payment to confirm, each with where to deal with it.
  await tabs.getByRole("link", { name: /^Inbox/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /to deal with\.$/ })).toBeVisible();
  await expect(page.getByText(requester.name, { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Filter inbox" }).getByRole("link", { name: /^Payments/ }).click();
  const payment = page.getByRole("listitem").filter({ hasText: payer.name });
  await expect(payment).toContainText("Payment to confirm");
  await expect(payment.getByRole("link", { name: /^Mark paid/ })).toHaveAttribute("href", new RegExp(`/coach/finances/payments/new\\?client=${payerId}&charge=`));
  await expect(page.getByText(requester.name, { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The menu keeps every section reachable, and signs out.
  await page.getByRole("button", { name: "Coach menu" }).click();
  const sections = page.getByRole("navigation", { name: "Coach sections" });
  for (const name of ["Requests", "Clients", "Classes", "Memberships", "1:1 sessions", "Online coaching", "Finances"]) await expect(sections.getByRole("link", { name })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/coach\/login$/);
});

test("finances: totals by period and service, and a safe CSV export", async ({ page, request }) => {
  const person = { ...unique("Fin"), name: `=HYPERLINK("http://evil.example") ${Date.now()}` };
  const clientId = await seedClient(request, person);
  await signIn(page);
  await page.goto(`/coach/finances/payments/new?client=${clientId}`);
  await page.getByLabel("Amount received").fill("12.50");
  await page.getByLabel("For", { exact: true }).selectOption({ label: "One-to-one" });
  await page.getByRole("radio", { name: /Nothing for now/ }).check();
  await page.getByLabel("Reference").fill("BACS 123");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  await expect(page.getByText("£12.50").first()).toBeVisible();

  await page.goto(`/coach/finances?period=custom&from=${today}&to=${today}&service=pt`);
  await expect(page.getByRole("status").filter({ hasText: "One-to-one only" })).toBeVisible();
  await expect(page.getByRole("cell", { name: person.name })).toBeVisible();

  const csv = await page.request.get(`/coach/finances/export?from=${today}&to=${today}&service=pt`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["cache-control"]).toContain("no-store");
  const text = await csv.text();
  expect(text).toContain("Date,Type,Client,Service,Method,Status,Amount (GBP)");
  expect(text).toContain("12.50");
  expect(text).toContain(`"'=HYPERLINK(""http://evil.example"")`);

  // A day with nothing in it.
  await page.goto("/coach/finances?period=custom&from=2020-01-01&to=2020-01-31");
  await expect(page.getByText("No payments in this period.")).toBeVisible();
});

test("memberships: start the plan chosen on the site, pay places with credits, 24-hour rule, renewals", async ({ page, request }) => {
  const person = unique("Member Flow");
  const clientId = await seedClient(request, person);
  // Someone else who isn't on the class, so its "Add someone" form (and the
  // confirmation shown in it) stays on the page whatever other tests have run.
  await seedClient(request, unique("Bystander"));
  const requestId = await seedRequest(request, person, {
    details: { plan: "starter", membership: "Starter membership (£40 every 4 weeks, 4 class credits)" },
  });
  await signIn(page);

  // The request shows the plan, and starts it prefilled.
  await page.goto(`/coach/requests/${requestId}`);
  await expect(page.getByText("Starter membership (£40 every 4 weeks, 4 class credits)")).toBeVisible();
  await page.getByRole("link", { name: "Start this membership" }).click();
  await expect(page).toHaveURL(/\/coach\/memberships\/new\?plan=starter/);
  await expect(page.getByRole("combobox", { name: "Client" })).toHaveValue(clientId);
  await expect(page.getByRole("radio", { name: /Starter/ })).toBeChecked();
  await page.getByRole("button", { name: "Start membership" }).click();
  await expect(page.getByRole("status")).toContainText("Membership started");
  await expect(page.getByText("4 of 4 credits left").first()).toBeVisible();
  const membershipUrl = page.url();
  const [row] = await sql<{ request_id: string; price_pence: number }>(request, "select request_id, price_pence from akb_memberships where client_id = $1", [clientId]);
  expect(row).toEqual({ request_id: requestId, price_pence: 4000 });

  // A class a week ahead (inside the period, more than 24 hours away), paid with a credit.
  const date = next(0, 1);
  await page.goto(`/coach/classes/${date}/mon-evening`);
  const add = page.getByRole("form", { name: "Add someone to this class" });
  await add.getByLabel("Client").selectOption({ label: person.name });
  await add.getByLabel("Pay with their membership credit").check();
  await add.getByRole("button", { name: "Add to class" }).click();
  await expect(page.getByRole("status").filter({ hasText: "paid with a membership credit" })).toBeVisible();
  const mine = page.getByRole("listitem").filter({ hasText: person.name });
  await expect(mine.getByText("Membership credit")).toBeVisible();
  await page.goto(membershipUrl);
  await expect(page.getByText("3 of 4 credits left").first()).toBeVisible();

  // Cancelled more than 24 hours ahead: the credit comes back.
  await page.goto(`/coach/classes/${date}/mon-evening`);
  await page.getByRole("form", { name: `Attendance for ${person.name}` }).getByRole("button", { name: "Cancelled" }).click();
  await expect(mine.getByText("Credit returned")).toBeVisible();
  await page.goto(membershipUrl);
  await expect(page.getByText("4 of 4 credits left").first()).toBeVisible();

  // The daily renewal needs the cron secret and is safe to repeat.
  expect((await request.get("/api/cron/membership-renewals")).status()).toBe(401);
  for (let i = 0; i < 2; i++) {
    const renew = await request.get("/api/cron/membership-renewals", { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
    expect(renew.status()).toBe(200);
    expect(renew.headers()["cache-control"]).toContain("no-store");
    const body = (await renew.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["classHoldsReleased", "directDebitFailures", "directDebitsSubmitted", "ok", "payLinksSent", "periodsCreated", "renewalReceipts", "renewalReminders", "signInsRemoved"]);
    // Stripe isn't configured here, so no pay links are sent (null, not 0).
    expect(body.payLinksSent).toBeNull();
    // The same daily run tidies member sign-ins (a count, not null: the clean-up ran).
    expect(typeof body.signInsRemoved).toBe("number");
  }
  const periods = await sql<{ n: number }>(request, "select count(*)::int as n from akb_membership_periods p join akb_memberships m on m.id = p.membership_id where m.client_id = $1", [clientId]);
  expect(periods).toEqual([{ n: 1 }]);

  // Alex pauses, resumes and cancels it: the member is told each time, in plain words.
  await page.goto(membershipUrl);
  await page.getByRole("form", { name: "Pause membership" }).getByRole("button", { name: "Pause renewals" }).click();
  await expect(page.getByText("Paused: no new periods until you resume it.")).toBeVisible();
  await expect.poll(async () => (await mailTo(request, person.email)).filter((e) => e.subject === "Your RAENG membership is paused").length).toBe(1);
  expect((await mailTo(request, person.email)).find((e) => e.subject === "Your RAENG membership is paused")?.text).toContain("No new periods or payments are taken until it's restarted");
  await page.getByRole("form", { name: "Resume membership" }).getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Resumed.")).toBeVisible();
  await expect.poll(async () => (await mailTo(request, person.email)).filter((e) => e.subject === "Your RAENG membership is back on").length).toBe(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("form", { name: "Cancel membership" }).getByRole("button", { name: "Cancel membership" }).click();
  await expect.poll(async () => (await mailTo(request, person.email)).filter((e) => e.subject === "Your RAENG membership is cancelled").length).toBe(1);
  expect((await mailTo(request, person.email)).find((e) => e.subject === "Your RAENG membership is cancelled")?.text).toContain("nothing more will be taken");
});

test("memberships: a member's request is confirmed on a credit, the client record shows it, and cancelling the class gives it back", async ({ page, request }) => {
  const person = unique("Member Cancel");
  const clientId = await seedClient(request, person);
  // A Wednesday no other test books (and not one the booking-page tests look at).
  const date = next(2, 2);
  const requestId = await seedRequest(request, person, { summary: `Wednesday class`, details: { classDate: date, classSlot: "wed-evening" } });
  await signIn(page);
  await page.goto("/coach/memberships/new");
  await page.getByRole("combobox", { name: "Client" }).selectOption(clientId);
  await page.getByRole("radio", { name: /Regular/ }).check();
  await page.getByRole("button", { name: "Start membership" }).click();
  await expect(page.getByRole("status")).toContainText("Membership started");
  const membershipUrl = page.url();

  try {
    // Confirming their class request uses a credit (ticked by default), not the £12 price.
    await page.goto(`/coach/requests/${requestId}`);
    const confirm = page.getByRole("form", { name: "Confirm request" });
    await confirm.getByRole("radio", { name: new RegExp(`${person.name} \\(existing client\\)`) }).check();
    await expect(confirm.getByLabel("Pay with their Regular membership credit")).toBeChecked();
    await confirm.getByRole("button", { name: "Confirm request" }).click();
    await expect(page.getByRole("status")).toContainText("paid with a membership credit");
    const charges = await sql<{ n: number }>(request, "select count(*)::int as n from akb_charges where client_id = $1 and service = 'group' and voided_at is null and description not like '%membership%'", [clientId]);
    expect(charges).toEqual([{ n: 0 }]);
    await page.goto(membershipUrl);
    await expect(page.getByText("7 of 8 credits left").first()).toBeVisible();

    // The client record shows the membership.
    await page.goto(`/coach/clients/${clientId}?tab=membership`);
    await expect(page.getByRole("region", { name: "Membership" })).toContainText("Regular");
    await expect(page.getByRole("region", { name: "Membership" })).toContainText("7 of 8 credits left");

    // Alex cancels the whole class: the place is cancelled and the credit comes back.
    await page.goto(`/coach/classes/${date}/wed-evening`);
    page.once("dialog", (d) => void d.accept());
    const cancel = page.getByRole("form", { name: "Cancel this class" });
    await cancel.getByLabel("Reason (for your records)").fill("Venue closed");
    await cancel.getByRole("button", { name: "Cancel class" }).click();
    // The form gives way to a lasting notice on the class.
    await expect(page.getByRole("note")).toContainText("You cancelled this class");
    await page.reload();
    await expect(page.getByRole("note")).toContainText("Venue closed");
    await expect(page.getByRole("form", { name: "Add someone to this class" })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: person.name }).getByText("Credit returned")).toBeVisible();
    await page.goto(membershipUrl);
    await expect(page.getByText("8 of 8 credits left").first()).toBeVisible();

    // The public calendar stops offering it.
    const full = (await (await request.get("/api/classes/full")).json()) as { cancelled: string[] };
    expect(full.cancelled).toContain(`wed-evening|${date}`);
  } finally {
    await sql(request, "update akb_class_sessions set cancelled_at = null, cancel_reason = '' where slot = 'wed-evening' and class_date = $1", [date]);
  }
});

test("a database outage shows an error, not empty data", async ({ page }) => {
  await signIn(page);
  await page.goto("/coach/clients?q=FAIL-TEST");
  await expect(page.locator("main [role=alert]")).toContainText("couldn't be loaded");
  await expect(page.getByText("No clients match.")).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("portal pages fit the screen and pass accessibility checks", async ({ page, request }) => {
    const person = unique("Phone Check");
    const clientId = await seedClient(request, person);
    const requestId = await seedRequest(request, unique("Phone Request"), { details: { classDate: next(5, 1), classSlot: "sat-morning" } });
    await signIn(page);
    for (const path of ["/coach", "/coach/requests", `/coach/requests/${requestId}`, "/coach/clients", `/coach/clients/${clientId}`, `/coach/classes/${next(5)}/sat-morning`, "/coach/sessions", "/coach/online", "/coach/memberships", "/coach/memberships/new", "/coach/finances", "/coach/finances/payments/new", "/coach/schedule", "/coach/members", "/coach/inbox"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
      // Colour transitions caught mid-way read as low contrast; switch them off for the check.
      await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important}" });
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), path).toEqual([]);
    }
    // The tab bar marks where you are: a class belongs to Schedule, a client to Members, a request to Inbox.
    const tabs = page.getByRole("navigation", { name: "Coach", exact: true });
    await page.goto("/coach");
    await expect(tabs.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await page.goto(`/coach/classes/${next(5)}/sat-morning`);
    await expect(tabs.getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");
    await page.goto(`/coach/clients/${clientId}`);
    await expect(tabs.getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
    await page.goto(`/coach/requests/${requestId}`);
    await expect(tabs.getByRole("link", { name: /^Inbox/ })).toHaveAttribute("aria-current", "page");
    // Finances has no tab; it is in the menu.
    await page.goto("/coach/finances");
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Coach menu" }).click();
    await expect(page.getByRole("navigation", { name: "Coach sections" }).getByRole("link", { name: "Finances" })).toBeVisible();
  });
});

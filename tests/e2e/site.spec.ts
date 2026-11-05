import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { coachRoutes, publicRoutes } from "../../src/lib/routes";

// Includes the 414–430px large phones and in-between tablet widths.
const widths = [320, 360, 375, 390, 414, 430, 480, 540, 600, 640, 700, 768, 900, 1024, 1280, 1600];

for (const route of [...publicRoutes, ...coachRoutes]) {
  test.describe(`route ${route}`, () => {
    test("responds, has one h1 and a title", async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page).toHaveTitle(/Alex K Bells/);
    });

    test("has no horizontal overflow at common widths", async ({ page }) => {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
        // Also catch controls pushed past the edge (even if clipped). Controls
        // inside a sideways-scrolling row (the offers carousel) are reached by
        // swiping, so they don't count.
        const offscreen = await page.$$eval("main a, main button", (els) =>
          els
            .filter((el) => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || el.classList.contains("sr-only") || r.right <= window.innerWidth + 1) return false;
              for (let p = el.parentElement; p; p = p.parentElement) {
                if (["auto", "scroll"].includes(getComputedStyle(p).overflowX)) return false;
              }
              return true;
            })
            .map((el) => el.textContent?.trim().slice(0, 30)),
        );
        expect(offscreen, `controls past the edge at ${width}px`).toEqual([]);
      }
    });

    test("has no detectable WCAG A/AA violations (desktop and mobile)", async ({ page }) => {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        // Let in-view scroll reveals finish (0.7 s + stagger): mid-fade text is briefly translucent.
        await page.waitForTimeout(1300);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`), `at ${width}px`).toEqual([]);
      }
    });

    test("loads without console errors, CSP violations or failed requests", async ({ browser, baseURL }) => {
      const problems: string[] = [];
      // A fresh page per width: navigating one page twice cancels whatever the
      // first load still had in flight (e.g. lazy images revealed by a resize).
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ baseURL, viewport: { width, height: 900 } });
        page.on("console", (msg) => {
          if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
        });
        page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
        page.on("requestfailed", (req) => {
          // Expected cancellations: link prefetches (?_rsc=) and media aborted
          // when the page closes. Anything else is a real failure.
          const cancelled = /ERR_ABORTED/.test(req.failure()?.errorText ?? "");
          if (cancelled && (/[?&]_rsc=/.test(req.url()) || /\/media\//.test(req.url()))) return;
          problems.push(`failed: ${req.url()} ${req.failure()?.errorText ?? ""}`);
        });
        page.on("response", (res) => {
          if (res.status() >= 400 && new URL(res.url()).origin === new URL(page.url() || res.url()).origin) {
            problems.push(`${res.status()}: ${res.url()}`);
          }
        });
        await page.goto(route, { waitUntil: "networkidle" });
        page.removeAllListeners("requestfailed");
        await page.close();
      }
      expect(problems).toEqual([]);
    });

    test("has page-specific social preview and canonical metadata", async ({ page }) => {
      await page.goto(route);
      const meta = (sel: string) => page.locator(sel).first().getAttribute("content");
      const title = await page.title();
      expect(await meta('meta[property="og:title"]')).toBe(title);
      expect(await meta('meta[property="og:url"]')).toMatch(new RegExp(`${route === "/" ? "/?" : route}$`));
      expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(
        new RegExp(`${route === "/" ? "/?" : route}$`),
      );
      expect(await meta('meta[property="og:image"]')).toMatch(/\/og-image\.png$/);
      expect(await meta('meta[property="og:image:alt"]')).toBeTruthy();
      expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
      expect(await meta('meta[name="description"]')).toBeTruthy();
    });

    test("has 44px tap targets on phones and tablets (outside running text)", async ({ page }) => {
      for (const width of [390, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        const small = await page.$$eval("a, button, summary", (els) =>
          els
            .filter((el) => {
              const box = el.getBoundingClientRect();
              if (!box.width || !box.height) return false; // hidden
              if (el.closest("p")) return false; // inline links in text are exempt
              if (el.classList.contains("sr-only")) return false; // skip link until focused
              return box.height < 44;
            })
            .map((el) => `${el.textContent?.trim().slice(0, 30)} (${Math.round(el.getBoundingClientRect().height)}px)`),
        );
        expect(small, `at ${width}px`).toEqual([]);
      }
    });

    test("heading levels do not skip", async ({ page }) => {
      await page.goto(route);
      const levels = await page.$$eval("h1, h2, h3, h4, h5, h6", (hs) => hs.map((h) => Number(h.tagName[1])));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i] - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1);
      }
    });

    test("external links are safe and announce new tabs", async ({ page }) => {
      await page.goto(route);
      const bad = await page.$$eval("a[href^='http']", (as) =>
        as
          .filter(
            (a) =>
              a.getAttribute("target") !== "_blank" ||
              !/noopener/.test(a.getAttribute("rel") ?? "") ||
              !/opens in a new tab/i.test(a.textContent ?? ""),
          )
          .map((a) => a.getAttribute("href")),
      );
      expect(bad).toEqual([]);
    });

    test("in-page anchors point at existing ids", async ({ page }) => {
      await page.goto(route);
      const missing = await page.$$eval("a[href^='#']", (as) =>
        as.map((a) => a.getAttribute("href")!.slice(1)).filter((id) => !document.getElementById(id)),
      );
      expect(missing).toEqual([]);
    });

    test("shows no provisional content on a production build", async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("[data-provisional]")).toHaveCount(0);
      // Only the prices the project owner confirmed may appear.
      const amounts = (await page.locator("main").innerText()).match(/£\d+/g) ?? [];
      for (const amount of amounts) expect(["£10", "£35", "£130", "£79"]).toContain(amount);
      // No unfilled placeholders anywhere.
      await expect(page.locator("main")).not.toContainText(/\[[A-Z][^\]]*\]/);
    });
  });
}

test("all internal links resolve", async ({ page, request }) => {
  const hrefs = new Set<string>();
  for (const route of publicRoutes) {
    await page.goto(route);
    for (const href of await page.locator("a[href^='/']").evaluateAll((as) =>
      as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
    )) {
      hrefs.add(href.split("#")[0] || "/");
    }
  }
  for (const href of hrefs) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test("unknown routes return the 404 page", async ({ page }) => {
  const res = await page.goto("/does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText(/page not found/i);
});

test("skip link moves focus to main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("mobile menu opens, navigates, closes with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Menu" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "About RAENG" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Group classes" }).click();
  await expect(page).toHaveURL(/\/classes$/);
  await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
});

// This server runs with the booking flow switched on, so "Book now" opens it.
test("every primary button says Book now and opens the booking flow", async ({ page }) => {
  for (const route of publicRoutes) {
    await page.goto(route);
    // No call to action is worded as an online booking or payment.
    const labels = await page.locator("main a, header a").evaluateAll((as) => as.map((a) => a.textContent?.trim() ?? ""));
    for (const label of labels) {
      expect(label, `${route}: "${label}"`).not.toMatch(/book (your|a|online)|pay now|checkout/i);
      // The one "book" button is "Book now" (owner's wording), and it opens the request flow.
      if (/^book\b/i.test(label)) expect(label, `${route}: "${label}"`).toMatch(/^book now/i);
    }
  }
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Book now" })).toHaveAttribute("href", "/book");
  await expect(page.getByRole("link", { name: "Book now" }).first()).toHaveAttribute("href", "/book");
  // Each offer has its own labelled button: in-person services go straight to their booking request.
  await expect(page.locator("#ways-to-train").getByRole("link", { name: "Request a class (group classes)" })).toHaveAttribute("href", "/book/group-class");
  await expect(page.locator("#ways-to-train").getByRole("link", { name: "Request a session (1:1 personal coaching)" })).toHaveAttribute("href", "/book/one-to-one");
  // Online coaching has its own enquiry form (it can send on this server).
  await expect(page.locator("#ways-to-train").getByRole("link", { name: "Enquire about online coaching" })).toHaveAttribute("href", "/online-coaching");
  await page.goto("/classes");
  await expect(page.locator("main").getByRole("link", { name: "Book now" }).first()).toHaveAttribute("href", "/book/group-class");
  await page.goto("/coaching");
  await expect(page.getByRole("link", { name: "Book now (1:1 personal coaching)" })).toHaveAttribute("href", "/book/one-to-one");
  // Online coaching is an enquiry, never worded as signing up or starting.
  await expect(page.getByRole("link", { name: "Enquire about online coaching" })).toHaveAttribute("href", "/online-coaching");
  await expect(page.getByRole("link", { name: "Book now (online coaching)" })).toHaveCount(0);
});

test("the contact page leads to Alex's Instagram", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.locator("h1")).toHaveText(/get in touch/i);
  // The action is in the first screen on phones and desktop.
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/contact");
    const ig = page.getByRole("link", { name: /message alex on instagram/i });
    await expect(ig).toHaveAttribute("href", "https://www.instagram.com/alex.kbells/");
    await expect(ig).toHaveAttribute("target", "_blank");
    const box = (await ig.boundingBox())!;
    expect(box.y + box.height, `${width}px`).toBeLessThanOrEqual(height);
  }
});

test("the Instagram card links straight to Alex's profile for updates", async ({ page }) => {
  await page.goto("/contact");
  const follow = page.locator("#enquire").getByRole("link", { name: /follow @alex\.kbells for updates/i });
  await expect(follow).toHaveAttribute("href", "https://www.instagram.com/alex.kbells/");
  await expect(follow).toHaveAttribute("target", "_blank");
});

test("header logo, navigation and booking button never overlap", async ({ page }) => {
  for (const width of [320, 360, 390, 768, 900, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const logo = await page.locator("header a[aria-label$=', home']").evaluate((el) => {
      // The wordmark can be wider than its link box, so measure the visible content.
      const rects = [...el.querySelectorAll("img, span")].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
      return Math.max(...rects.map((r) => r.right));
    });
    const firstControl = Math.min(
      ...(await page.locator("header nav a:visible, header button:visible, header .md\\:block > a:visible").evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().left),
      )),
    );
    expect(logo, `logo overlaps navigation at ${width}px`).toBeLessThanOrEqual(firstControl);
  }
});

test("the phone menu closes after any link, including same-page section links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [from, label, url] of [
    ["/", "Ways to train", /\/#ways-to-train$/],
    ["/", "Why kettlebells", /\/#why-kettlebells$/],
    ["/", "About RAENG", /\/#about$/],
    ["/", "How to book", /\/#how-to-book$/],
    ["/contact", "Contact", /\/contact$/],
  ] as const) {
    await page.goto(from);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("button", { name: "Menu" }), `${from} → ${label}`).toHaveAttribute("aria-expanded", "false");
  }
  // The section the link points at is visible, not hidden behind the panel.
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Why kettlebells" }).click();
  await expect(page.locator("#benefits-heading")).toBeInViewport();
});

test("the menu answers Alex's four questions, each one tap away", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/contact");
  const nav = page.getByRole("banner").getByRole("navigation", { name: "Main" });
  for (const [label, id, heading] of [
    ["Ways to train", "ways-to-train", /choose how you train/i],
    ["Why kettlebells", "why-kettlebells", /stronger, fitter/i],
    ["About RAENG", "about", /strength, technique, confidence/i],
    ["How to book", "how-to-book", /where and how to book/i],
  ] as const) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`/#${id}$`));
    const section = page.locator(`#${id}`);
    await expect(section.getByRole("heading", { level: 2 })).toHaveText(heading);
    await expect(section).toBeInViewport();
  }
  // "Where and how" gives the address, directions and the contact button together.
  const book = page.locator("#how-to-book");
  await expect(book).toContainText("1A Dunns Wood Road");
  await expect(book.getByRole("link", { name: /get directions/i })).toBeVisible();
  await expect(book.getByRole("link", { name: "Book now" })).toHaveAttribute("href", "/book");
});

test("cross-page section anchors exist", async ({ page }) => {
  await page.goto("/coaching");
  await expect(page.locator("#one-to-one")).toHaveCount(1);
  await expect(page.locator("#online")).toHaveCount(1);
});

test("contact, Instagram and directions links point at verified destinations", async ({ page }) => {
  await page.goto("/contact");
  const hrefs = await page.$$eval("a[href^='http']", (as) => as.map((a) => a.getAttribute("href")!));
  expect(hrefs).toContain("https://www.instagram.com/alex.kbells/");
  // Alex's Facebook page: the stable page URL, never the share link with its tracking.
  expect(hrefs).toContain("https://www.facebook.com/profile.php?id=61589486540520");
  expect(hrefs.some((h) => /facebook\.com\/share|mibextid/.test(h))).toBe(false);
  const maps = hrefs.find((h) => h.startsWith("https://www.google.com/maps/search/"));
  expect(maps && decodeURIComponent(maps)).toContain("1A Dunns Wood Road, Cumbernauld, G67 3EN");
});

test("supplied logo renders in header and footer as labelled home links", async ({ page, request }) => {
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/classes");
    const header = page.locator("header").getByRole("link", { name: "Alex K Bells, home" });
    await expect(header.locator('img[src*="logo-mark"]')).toBeVisible();
    const footer = page.locator("footer").getByRole("link", { name: "Alex K Bells, home" });
    await expect(footer.locator('img[src*="logo-lockup"]')).toBeVisible();
  }
  for (const path of ["/icon.png", "/apple-icon.png", "/og-image.png"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test("hero video plays silently, can be paused, and offers WebM + MP4", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("main video");
  await expect(video).toHaveAttribute("aria-hidden", "true");
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted && v.loop && v.playsInline)).toBe(true);
  const types = await video.locator("source").evaluateAll((els) => els.map((e) => e.getAttribute("type")));
  expect(types).toEqual(['video/mp4; codecs="avc1.64001F"', 'video/webm; codecs="vp9"']);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);

  await page.getByRole("button", { name: "Pause background video" }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.getByRole("button", { name: "Play background video" })).toBeVisible();
});

test("hero video loops back to the start instead of stopping on a blank frame", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("main video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2)).toBe(true);
  // Native loop.
  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = v.duration - 0.3));
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 5000 }).toBeLessThan(2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused || v.ended)).toBe(false);
  // Fallback for browsers that ignore `loop`: the ended handler restarts it.
  await video.evaluate((v: HTMLVideoElement) => {
    v.loop = false;
    v.currentTime = v.duration - 0.3;
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.ended && !v.paused && v.currentTime < 2), { timeout: 5000 }).toBe(true);
});

test("hero video starts on its own, even before JavaScript runs", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  const video = page.locator("main video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0)).toBe(true);
  await expect(page.getByRole("button", { name: "Pause background video" })).toBeVisible();

  // The autoplay attributes are in the server HTML, so it doesn't wait for scripts.
  const noJs = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const plain = await noJs.newPage();
  await plain.goto("/");
  const attrs = await plain.locator("main video").evaluate((v) => ["autoplay", "muted", "loop", "playsinline"].map((a) => v.hasAttribute(a)));
  expect(attrs).toEqual([true, true, true, true]);
  await expect.poll(() => plain.locator("main video").evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  await noJs.close();
});

test("with Reduce Motion the hero shows a still frame until the visitor presses play", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const video = page.locator("main video");
  const play = page.getByRole("button", { name: "Play background video" });
  await expect(play).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  // The poster is painted behind the hidden video.
  await expect(video).toBeHidden();
  expect(await video.evaluate((v) => getComputedStyle(v.parentElement!.parentElement!).backgroundImage)).toContain("hero-poster");
  await play.click();
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
});

test("if the hero video can't load, the still stays and the play/pause control is removed", async ({ page }) => {
  await page.route(/\/media\/hero\.(mp4|webm)/, (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("button", { name: /background video/ })).toHaveCount(0);
  expect(await page.locator("main video").evaluate((v) => getComputedStyle(v.parentElement!.parentElement!).backgroundImage)).toContain("hero-poster");
});

test("tablets show the whole hero video across the content width, headline and button on it", async ({ page }) => {
  for (const [width, height] of [[768, 1024], [820, 1180]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const video = (await page.locator("main video").boundingBox())!;
    const h1 = (await page.locator("h1").boundingBox())!;
    const cta = (await page.locator("main section").first().getByRole("link", { name: "Book now" }).boundingBox())!;
    expect(video.width, `${width}px`).toBeGreaterThanOrEqual(width - 48 - 1);
    expect(video.y + video.height).toBeLessThanOrEqual(height);
    for (const el of [h1, cta]) {
      expect(el.y).toBeGreaterThan(video.y + video.height / 2);
      expect(el.y + el.height).toBeLessThanOrEqual(video.y + video.height);
    }
  }
});

test("phones get the training photos as a keyboard-scrollable row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const row = page.getByRole("list", { name: "From the training" });
  await expect(row).toHaveAttribute("tabindex", "0");
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await row.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test("phones swipe through the three offers: the next card peeks, arrows and dots move, nothing overflows", async ({ page }) => {
  const width = 390;
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/");
  const section = page.locator("#ways-to-train");
  const list = section.getByRole("list", { name: "Ways to train cards" });
  const cards = list.locator("> li");
  await expect(cards).toHaveCount(3);
  await list.scrollIntoViewIfNeeded();
  const first = (await cards.nth(0).boundingBox())!;
  const second = (await cards.nth(1).boundingBox())!;
  // One card mostly in view (85–90% of the screen), the next peeking in beside it.
  expect(first.width / width).toBeGreaterThan(0.84);
  expect(first.width / width).toBeLessThan(0.9);
  expect(second.x).toBeLessThan(width - 8);
  expect(second.x).toBeGreaterThan(first.x + first.width);
  // Same height; an image and a main button on every card (booking request or enquiry).
  const heights = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
  await expect(cards.locator("img")).toHaveCount(3);
  await expect(cards.getByRole("link", { name: /^(Request a (class|session)|Enquire about)/ })).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

  const prev = section.getByRole("button", { name: "Previous card" });
  const next = section.getByRole("button", { name: "Next card" });
  const dot = (n: number) => section.getByRole("button", { name: new RegExp(`, ${n} of 3$`) });
  await expect(prev).toBeDisabled();
  await expect(dot(1)).toHaveAttribute("aria-current", "true");
  for (const control of [prev, next, dot(1), dot(2), dot(3)]) {
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await next.click();
  await expect(dot(2)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  await dot(3).click();
  await expect(dot(3)).toHaveAttribute("aria-current", "true");
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(dot(2)).toHaveAttribute("aria-current", "true");

  // The list is focusable, so the arrow keys scroll it.
  await dot(1).click();
  await expect(dot(1)).toHaveAttribute("aria-current", "true");
  await list.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test("desktop shows the three offers as a grid, without carousel controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const section = page.locator("#ways-to-train");
  const cards = section.getByRole("list", { name: "Ways to train cards" }).locator("> li");
  await expect(cards).toHaveCount(3);
  const boxes = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!, (await cards.nth(2).boundingBox())!];
  expect(boxes[1].x).toBeGreaterThanOrEqual(boxes[0].x + boxes[0].width - 1);
  expect(boxes[2].x).toBeGreaterThanOrEqual(boxes[1].x + boxes[1].width - 1);
  expect(Math.abs(boxes[0].y - boxes[2].y)).toBeLessThan(1);
  await expect(section.getByRole("button", { name: "Next card" })).toBeHidden();
  await expect(section.getByRole("group", { name: "Ways to train" })).not.toHaveAttribute("aria-roledescription", "carousel");
});

test("menu open on mobile has no accessibility violations and is keyboard operable", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Menu" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Why kettlebells" })).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("FAQ items open and close with the keyboard", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator("main details summary").first();
  const details = page.locator("main details").first();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(details).not.toHaveAttribute("open", "");
});

test("business structured data is valid JSON with the verified address only", async ({ page }) => {
  await page.goto("/");
  const raw = await page.locator('script[type="application/ld+json"]').textContent();
  const data = JSON.parse(raw ?? "{}");
  expect(data["@type"]).toBe("LocalBusiness");
  expect(data.address.postalCode).toBe("G67 3EN");
  expect(data.sameAs).toEqual(["https://www.instagram.com/alex.kbells/", "https://www.facebook.com/profile.php?id=61589486540520"]);
  // Nothing unconfirmed: no prices, hours, ratings or phone numbers.
  for (const key of ["priceRange", "openingHours", "openingHoursSpecification", "aggregateRating", "telephone"]) {
    expect(data[key], key).toBeUndefined();
  }
});

test("security headers are sent", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("browser JavaScript contains no server-only configuration names", async ({ page, request }) => {
  const scripts = new Set<string>();
  for (const route of publicRoutes) {
    await page.goto(route);
    for (const src of await page.locator("script[src]").evaluateAll((els) => els.map((e) => e.getAttribute("src")!))) {
      scripts.add(src);
    }
  }
  expect(scripts.size).toBeGreaterThan(0);
  for (const src of scripts) {
    const body = await (await request.get(src)).text();
    for (const name of [
      "CONTENT_PREVIEW",
      "BOOKING_URL",
      "SITE_URL",
      "VERCEL_ENV",
      "BOOKING_DEMO",
      "RESEND_API_KEY",
      "RESEND_API_URL",
      "BOOKING_NOTIFY_EMAIL",
      "BOOKING_FROM_EMAIL",
      "re_e2e_test_key",
      "alex-e2e@example.com",
      "bookings-e2e@example.com",
    ]) {
      expect(body.includes(name), `${name} in ${src}`).toBe(false);
    }
  }
});

test("a paused hero video stays paused after scrolling away and back", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("main video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  await page.getByRole("button", { name: "Pause background video" }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

// Tablets and desktop: headline, booking button and the whole video in the first view.
for (const [width, height] of [
  [1440, 900],
  [1366, 768],
  [1024, 768],
  [768, 1024],
]) {
  test(`hero headline, booking button and the whole video are in the first view at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const h1 = await page.locator("h1").boundingBox();
    const cta = await page.locator("main section").first().getByRole("link").first().boundingBox();
    const video = await page.locator("main video").boundingBox();
    expect(h1 && h1.y + h1.height).toBeLessThanOrEqual(height);
    expect(cta && cta.y + cta.height).toBeLessThanOrEqual(height);
    expect(video!.y).toBeGreaterThanOrEqual(0);
    expect(video!.y + video!.height, "bottom of the video").toBeLessThanOrEqual(height);
    expect(Math.abs(video!.width / video!.height - 0.8)).toBeLessThan(0.01);
  });
}

// Phones: the video runs edge to edge at its full 4:5 frame, never cropped,
// with the headline and booking button over its lower part, so the whole
// video, headline and button fit the first screen, even with Safari's toolbar.
for (const [width, height] of [
  [430, 932],
  [393, 852],
  [390, 664],
  [360, 640],
  [320, 568],
] as const) {
  test(`hero video runs edge to edge with the headline and button on it at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const video = page.locator("main video");
    const box = (await video.boundingBox())!;
    const h1 = (await page.locator("h1").boundingBox())!;
    const cta = (await page.locator("main section").first().getByRole("link").first().boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.x + box.width).toBe(width);
    expect(Math.abs(box.width / box.height - 0.8)).toBeLessThan(0.01);
    expect(await video.evaluate((v) => getComputedStyle(v).objectFit)).toBe("contain");
    expect(box.y + box.height, "bottom of the video").toBeLessThanOrEqual(height);
    // Headline (with the intro line beneath it) and button sit on the lower
    // part of the video: the button in its lower half, the headline below its
    // top 40%, since the intro line now takes room under the headline.
    expect(h1.y).toBeGreaterThan(box.y + box.height * 0.4);
    expect(cta.y).toBeGreaterThan(box.y + box.height / 2);
    for (const el of [h1, cta]) {
      expect(el.y + el.height).toBeLessThanOrEqual(box.y + box.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });
}

test("class pages link to the how-to-join section", async ({ page }) => {
  await page.goto("/classes");
  await expect(page.locator("#book")).toHaveCount(1);
  await expect(page.locator("#book ol > li")).toHaveCount(3);
  await page.getByRole("link", { name: "How to join" }).click();
  await expect(page).toHaveURL(/#book$/);
});

test("robots and sitemap are served", async ({ request }) => {
  expect((await request.get("/robots.txt")).status()).toBe(200);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const body = await sitemap.text();
  for (const route of publicRoutes.filter((r) => r !== "/")) expect(body).toContain(route);
});

test("the menu shows which homepage section you're in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ways to train" }).click();
  await expect(page.locator("#ways-to-train")).toBeInViewport();
  await menu.click();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: /^Ways to train/ })).toHaveAttribute("aria-current", "location");
  await expect(nav.locator('[aria-current="location"]')).toHaveCount(1);
});

test("the desktop header marks the section you're in", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#about");
  await expect(page.getByRole("banner").getByRole("link", { name: "About RAENG" })).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("banner").locator('[aria-current="location"]:visible')).toHaveCount(1);
});

test.describe("scroll reveal", () => {
  test("content below the fold fades in when scrolled to", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const faq = page.locator("#main li[data-reveal]").last();
    await expect(faq).not.toHaveAttribute("data-revealed", "");
    expect(await faq.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await faq.scrollIntoViewIfNeeded();
    await expect(faq).toHaveAttribute("data-revealed", "");
    await expect.poll(() => faq.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("is off with reduced motion and without JavaScript", async ({ page, browser, baseURL }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-reveal-ready"))).toBe(false);
    expect(await page.locator("#main li[data-reveal]").last().evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const noJs = await context.newPage();
    await noJs.goto("/");
    expect(await noJs.locator("#main li[data-reveal]").last().evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await context.close();
  });
});

test("Facebook is linked next to Instagram in the footer and About RAENG, opening safely in a new tab", async ({ page }) => {
  await page.goto("/");
  for (const scope of [page.getByRole("contentinfo"), page.locator("#about")]) {
    const fb = scope.getByRole("link", { name: /Facebook/ });
    await expect(fb).toHaveAttribute("href", "https://www.facebook.com/profile.php?id=61589486540520");
    await expect(fb).toHaveAttribute("target", "_blank");
    await expect(fb).toHaveAttribute("rel", /noopener/);
  }
});


/**
 * Outdated instructions: booking or joining only by Instagram message. Never
 * allowed while the booking form is open; Instagram may appear only as the
 * labelled alternative.
 */
const INSTAGRAM_ONLY_BOOKING = [
  /message alex on instagram with the session/i,
  /on instagram[^.]{0,40}(to book|to join|you'?d like to book|would like to join)/i,
  // Within one line: a "Book now" button label isn't a sentence about Instagram further down.
  /(book|join)[^.\n]{0,40}(on|via|through|by) (an )?instagram/i,
  /get in touch to (book|join|arrange a session)/i,
];

for (const [server, base] of [
  ["booking demo server", ""],
  ["production-configured server", `http://localhost:${process.env.E2E_PRODUCTION_PORT ?? 3201}`],
] as const) {
  test(`${server}: no page tells visitors to book only through Instagram`, async ({ page }) => {
    for (const route of ["/", "/classes", "/coaching", "/contact"]) {
      await page.goto(base + route);
      const text = await page.locator("main").innerText();
      for (const pattern of INSTAGRAM_ONLY_BOOKING) expect(text, `${route}: ${pattern}`).not.toMatch(pattern);
    }
  });

  test(`${server}: booking CTAs reach the right service, with Instagram as the labelled alternative`, async ({ page }) => {
    await page.goto(base + "/classes");
    const join = page.locator("#book");
    await expect(join.getByRole("heading", { name: "Send a booking request" })).toBeVisible();
    await expect(join.getByRole("heading", { name: "Alex confirms your place" })).toBeVisible();
    await expect(join.getByRole("link", { name: "Book now" })).toHaveAttribute("href", "/book/group-class");
    await expect(join.getByRole("link", { name: /Message Alex on Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/alex.kbells/");

    await page.goto(base + "/");
    const how = page.locator("#how-to-book");
    await expect(how.getByRole("heading", { name: "Send your request" })).toBeVisible();
    await expect(how.getByRole("link", { name: "Book now" })).toHaveAttribute("href", "/book");
    await expect(how.getByRole("link", { name: /Message Alex on Instagram/ })).toBeVisible();

    await page.goto(base + "/coaching");
    await expect(page.locator("#one-to-one")).toContainText("Send a booking request with the days and times that suit you, and Alex confirms your session.");
    await expect(page.locator("#one-to-one").getByRole("link", { name: /Message Alex on Instagram/ })).toBeVisible();
    // Online coaching stays an enquiry, with no booking wording.
    await expect(page.locator("#online").getByRole("link", { name: "Enquire about online coaching" })).toHaveAttribute("href", "/online-coaching");
    await expect(page.locator("#online")).not.toContainText(/booking request/i);

    await page.goto(base + "/contact");
    await expect(page.getByRole("link", { name: "Send a booking request" })).toHaveAttribute("href", "/book");
    await expect(page.locator("main")).toContainText("Alex confirms your place");
  });
}

test.describe("RAENG website changes (2026-11-05)", () => {
  for (const width of [320, 390, 768, 1440]) {
    test(`"Book now" sits in the top-right of the header at ${width}px and opens the booking options`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const book = page.getByRole("banner").getByRole("link", { name: "Book now" }).and(page.locator(":visible"));
      await expect(book).toHaveCount(1);
      await expect(book).toHaveAttribute("href", "/book");
      const box = (await book.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // It sits to the right of the logo, in the header's right-hand group.
      const logo = (await page.getByRole("banner").getByRole("link").first().boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(logo.x + logo.width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await book.click();
      await expect(page).toHaveURL(/\/book$/);
    });
  }

  test("/coaching has separate 1:1 and small group sections, each with its own content", async ({ page }) => {
    await page.goto("/coaching");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("main")).toContainText("Personalised, face-to-face kettlebell coaching designed around your goals, experience and ability.");

    const one = page.locator("#one-to-one");
    await expect(one.getByRole("heading", { level: 2, name: "Attention That Stays on You" })).toBeVisible();
    await expect(one).toContainText("Whether you’re new to kettlebells or looking to take your training further");
    for (const card of ["Strength", "Technique", "Movement"]) await expect(one.getByText(card, { exact: true }).first()).toBeVisible();
    await expect(one.getByRole("heading", { name: "What's included" })).toBeVisible();
    for (const box of ["Personalised coaching", "Technique and development", "Structured progression"]) await expect(one.getByRole("heading", { name: box })).toBeVisible();
    await expect(one).toContainText("Single 1:1 session");
    await expect(one).toContainText("£35");
    await expect(one).toContainText("Monthly package");
    await expect(one).toContainText("£130");
    await expect(one).toContainText("Four personalised coaching sessions each month, providing consistency, structure and progression.");

    const group = page.locator("#small-group");
    await expect(group.getByRole("heading", { level: 2, name: "Train together. Progress individually." })).toBeVisible();
    await expect(group).toContainText("Small group kettlebell coaching combining individual guidance");
    for (const point of ["Small, focused training groups", "Coaching and technique feedback", "Structured strength and conditioning", "A supportive training environment"]) await expect(group).toContainText(point);
    // No price has been supplied for small group coaching, so none is invented.
    await expect(group).not.toContainText("£");
    await expect(group).toContainText("Submitting an enquiry does not guarantee a place.");
    await expect(group.getByRole("link", { name: /Enquire about availability/ })).toHaveAttribute("href", "/book/small-group");
  });

  test("the timetable shows the latest class names and times", async ({ page }) => {
    await page.goto("/classes");
    const times = page.locator("#timetable");
    for (const [name, day, time] of [
      ["KB HIIT", "Monday", "6:30 pm"],
      ["Double KB", "Wednesday", "6:30 pm"],
      ["KB Mix", "Saturday", "9:00 am"],
    ]) {
      const item = times.getByRole("listitem").filter({ hasText: name });
      await expect(item).toContainText(day);
      await expect(item).toContainText(time);
    }
    await expect(times).toContainText("Kettlebell conditioning and full-body training to build strength and fitness.");
    await expect(times).not.toContainText("10:15");
  });

  test("About RAENG is about the brand: no portrait and no coach biography", async ({ page }) => {
    await page.goto("/");
    const about = page.locator("#about");
    await expect(about.getByRole("heading", { level: 2 })).toHaveText(/strength, technique, confidence/i);
    await expect(about).toContainText("RAENG is kettlebell coaching");
    await expect(about.getByRole("img", { name: /Alex standing/ })).toHaveCount(0);
    await expect(about).not.toContainText(/Alex Robertson|Coached by Alex|About Alex/);
    expect((await page.request.get("/images/alex/about.jpg")).status()).toBe(404);
  });
});

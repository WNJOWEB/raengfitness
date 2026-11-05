import { describe, expect, it } from "vitest";
import { buttonLabel, renderEmailHtml } from "./email-layout";
import { signInEmail } from "./member-auth";

const env = { SITE_URL: "https://raengfitness.co.uk" };

describe("renderEmailHtml", () => {
  it("puts RAENG's logo at the top, linked to the site, with alt text for when images are off", () => {
    const html = renderEmailHtml({ subject: "Hello", text: "Body", audience: "customer" }, env);
    expect(html).toContain('<img src="https://raengfitness.co.uk/brand/raeng-header-black.png" width="132"');
    expect(html).toContain('alt="RAENG Fitness"');
    expect(html.indexOf("<img")).toBeLessThan(html.lastIndexOf("Body"));
  });

  it("shows a sign-in code large, once, and as the inbox preview", () => {
    const mail = signInEmail("https://raengfitness.co.uk/account/confirm?token=abc", "123456");
    const html = renderEmailHtml({ ...mail, audience: "customer" }, env);
    expect(html).toMatch(/font-size:40px[^>]*>123 456</);
    expect(html.match(/123 456/g)).toHaveLength(3); // the code box, the preview line and the <title> (the subject); not again in the text
    expect(html).toContain(">Sign in</a>");
  });

  it("escapes everything that came from a person", () => {
    const html = renderEmailHtml({ subject: "x", text: "Message:\n<script>alert(1)</script> & \"quotes\"", audience: "alex" }, env);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;");
  });

  it("turns the first link on its own line into a button and keeps inline links clickable", () => {
    const html = renderEmailHtml({ subject: "x", text: "Book it here:\nhttps://raengfitness.co.uk/book/group-class\n\nSee https://raengfitness.co.uk/terms for terms.", audience: "customer" }, env);
    expect(html).toContain(">Book your place</a>");
    expect(html).toContain('<a href="https://raengfitness.co.uk/terms"');
  });

  it("tells customers why they got it; Alex's alerts just say where they came from", () => {
    expect(renderEmailHtml({ subject: "x", text: "y", audience: "customer" }, env)).toContain("isn't a marketing email");
    expect(renderEmailHtml({ subject: "x", text: "y", audience: "alex" }, env)).toContain("Sent by the RAENG website.");
  });
});

describe("labelled links", () => {
  it("link the words, not a long address, for 'Label: link' lines", () => {
    const html = renderEmailHtml({ subject: "x", text: "Hi.\n\nYour bookings: https://raengfitness.co.uk/account", audience: "customer" }, env);
    expect(html).toContain('<a href="https://raengfitness.co.uk/account" style="color:#171717;font-weight:600;text-decoration:underline;">Your bookings</a>');
  });
});

describe("buttonLabel", () => {
  it("names the action from the link", () => {
    expect(buttonLabel("https://x/account/confirm?token=a", "")).toBe("Sign in");
    expect(buttonLabel("https://x/book/manage?token=a", "")).toBe("Manage your booking");
    expect(buttonLabel("https://x/book/waitlist?leave=a", "")).toBe("Leave the waitlist");
    expect(buttonLabel("https://checkout.stripe.com/c/pay/x", "")).toBe("Pay now");
    expect(buttonLabel("https://checkout.stripe.com/c/pay/x", "Set up your Direct Debit here:")).toBe("Set up Direct Debit");
    expect(buttonLabel("https://x/account", "")).toBe("Go to your account");
  });
});

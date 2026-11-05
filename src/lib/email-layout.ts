import { site } from "../content/site";
import { siteUrl, type Env } from "./env";

/**
 * The look of every email the site sends (owner, 2026-11-05): RAENG's logo at
 * the top, the message on a white card on the site's cream, a clear button for
 * the main link, a large code for sign-in and email-change codes, and a
 * standard footer (who sent it, where, how to get in touch, why you got it).
 *
 * Built from the plain-text version, which is still sent alongside: every
 * email is written once, as text, and this only presents it. Nothing from a
 * visitor is ever treated as HTML: all text is escaped.
 *
 * Email clients are conservative, so this uses tables, inline styles and web-safe
 * fonts only, in the site's four colours; it looks right with images off (the logo has alt text) and in
 * dark-mode apps that invert colours.
 */

export type EmailAudience = "customer" | "alex";

export interface EmailContent {
  subject: string;
  text: string;
  /** A one-time code (sign-in, email change), shown large above the message. */
  code?: string;
  audience: EmailAudience;
}

const INK = "#171717";
const PAPER = "#f5f2eb";
// The site's colours only (DESIGN.md): ink on cream and white.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const URL_PATTERN = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

/** "Sign in", "Pay now"…: the button's words, from where the link goes and what the email says just before it. */
export function buttonLabel(url: string, context: string): string {
  const c = context.toLowerCase();
  if (/\/book\/manage/.test(url)) return "Manage your booking";
  if (/\/account\/confirm/.test(url)) return "Sign in";
  if (/[?&]leave=/.test(url)) return "Leave the waitlist";
  if (/[?&]credit=/.test(url)) return "Book with your credit";
  if (c.includes("direct debit")) return "Set up Direct Debit";
  if (/checkout\.stripe\.com|\/pay(\/|\?|$)|buy\.stripe\.com/.test(url)) return "Pay now";
  if (/\/book(\/|\?|$)/.test(url)) return "Book your place";
  if (/\/account(\/|\?|$)/.test(url)) return "Go to your account";
  return "Open link";
}

function linkify(line: string): string {
  // "Your bookings: https://…" reads better as the words themselves linked, without the long address.
  const labelled = /^(.*\S):\s*(https?:\/\/\S+)$/.exec(line.trim());
  if (labelled && !/https?:\/\//.test(labelled[1])) {
    return `<a href="${escape(labelled[2])}" style="color:${INK};font-weight:600;text-decoration:underline;">${escape(labelled[1])}</a>`;
  }
  let out = "";
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const at = match.index ?? 0;
    out += escape(line.slice(last, at));
    out += `<a href="${escape(match[0])}" style="color:${INK};text-decoration:underline;word-break:break-all;">${escape(match[0])}</a>`;
    last = at + match[0].length;
  }
  return out + escape(line.slice(last));
}

function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td style="border-radius:999px;background:${INK};">
<a href="${escape(url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:999px;">${escape(label)}</a>
</td></tr></table>
<p style="margin:0 0 20px;font-family:${FONT};font-size:13px;line-height:20px;color:${INK};">Or copy this link into your browser:<br><a href="${escape(url)}" style="color:${INK};word-break:break-all;">${escape(url)}</a></p>`;
}

function codeBox(code: string): string {
  const spaced = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td align="center" style="background:${PAPER};border-radius:16px;padding:22px 12px;">
<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${INK};">Your code</p>
<p style="margin:0;font-family:'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace;font-size:40px;line-height:48px;font-weight:700;letter-spacing:8px;color:${INK};">${escape(spaced)}</p>
</td></tr></table>`;
}

/** The message: paragraphs from blank lines, the first link on a line of its own as a button, other links clickable. */
function body(text: string, code?: string): string {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  // With the code shown large, the text's own "Your code is …" line would repeat it.
  const shown = code ? paragraphs.filter((p) => !p.replace(/\s/g, "").includes(code)) : paragraphs;
  let buttons = 0;
  const para = (lines: string[]) =>
    lines.length ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:26px;color:${INK};">${lines.map(linkify).join("<br>")}</p>` : "";
  return shown
    .map((p, i) => {
      const out: string[] = [];
      let lines: string[] = [];
      for (const line of p.split("\n")) {
        const lone = /^https?:\/\/\S+$/.test(line.trim()) ? line.trim() : null;
        if (lone && buttons === 0) {
          buttons += 1;
          const context = [...lines, shown[i - 1] ?? ""].join(" ");
          out.push(para(lines), button(lone, buttonLabel(lone, context)));
          lines = [];
        } else {
          lines.push(line);
        }
      }
      out.push(para(lines));
      return out.join("\n");
    })
    .join("\n");
}

function footer(audience: EmailAudience, env: Env): string {
  const l = site.location;
  const url = siteUrl(env);
  const host = url.replace(/^https?:\/\//, "");
  const contact = [
    site.contact.email ? `<a href="mailto:${escape(site.contact.email)}" style="color:${INK};">${escape(site.contact.email)}</a>` : "",
    `<a href="${escape(site.social.raeng.url)}" style="color:${INK};">Instagram ${escape(site.social.raeng.handle)}</a>`,
    `<a href="${escape(url)}" style="color:${INK};">${escape(host)}</a>`,
  ].filter(Boolean);
  const why =
    audience === "customer"
      ? "You're receiving this email because you booked, joined, signed in or got in touch with RAENG Fitness. It's about your booking or account, so it isn't a marketing email."
      : "Sent by the RAENG website.";
  return `<p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:20px;color:${INK};"><strong style="color:${INK};">${escape(site.name)} ${escape(site.descriptor)}</strong> · ${escape(l.street)}, ${escape(l.town)}, ${escape(l.postcode)}</p>
<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:20px;color:${INK};">${contact.join(" · ")}</p>
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${INK};">${escape(why)}</p>`;
}

/** "Thanks, Alex, RAENG Fitness" at the end of every customer email (owner, 2026-11-05). */
export const SIGN_OFF = ["Thanks,", "Alex", `${site.name} ${site.descriptor}`] as const;

function signOff(): string {
  return `<p style="margin:8px 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK};">${escape(SIGN_OFF[0])}<br><strong>${escape(SIGN_OFF[1])}</strong><br>${escape(SIGN_OFF[2])}</p>`;
}

/** The full HTML email. */
export function renderEmailHtml(content: EmailContent, env: Env = process.env): string {
  const origin = siteUrl(env);
  const logo = site.logo.header;
  const width = 132;
  const height = Math.round((logo.height / logo.width) * width);
  // Shown as the preview line in the inbox; the code first when there is one.
  const preheader = content.code
    ? `Your code is ${content.code.length === 6 ? `${content.code.slice(0, 3)} ${content.code.slice(3)}` : content.code}`
    : (content.text.split("\n").find((l) => l.trim() && !/^https?:\/\//.test(l.trim())) ?? content.subject);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escape(preheader.slice(0, 140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td align="center" style="padding:32px 16px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td align="center" style="padding:0 0 24px;">
<a href="${escape(origin)}" style="text-decoration:none;"><img src="${escape(origin + logo.src)}" width="${width}" height="${height}" alt="${escape(`${site.name} ${site.descriptor}`)}" style="display:block;border:0;width:${width}px;height:auto;font-family:${FONT};font-size:20px;font-weight:700;color:${INK};"></a>
</td></tr>
<tr><td style="background:#ffffff;border-radius:20px;padding:32px 28px 16px;">
${content.code ? codeBox(content.code) : ""}
${body(content.text, content.code)}
${content.audience === "customer" ? signOff() : ""}
</td></tr>
<tr><td style="padding:24px 8px 0;">
${footer(content.audience, env)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The plain-text version's sign-off and footer for customers (Alex's own alerts stay as they are). */
export function textFooter(): string {
  const l = site.location;
  return [
    "",
    ...SIGN_OFF,
    "",
    `${l.street}, ${l.town}, ${l.postcode}`,
    [site.contact.email, `Instagram ${site.social.raeng.handle}`].filter(Boolean).join(" · "),
  ].join("\n");
}

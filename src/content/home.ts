/**
 * Homepage copy that Alex may want to refine. Plain text, no markup: edit the
 * words here and nothing else needs to change. Keep it short.
 */
export const hero = {
  // What Alex does and where, in two lines (owner's pick A, 2026-10-26; was "Train with purpose. / Build with discipline.").
  // Owner, 2026-10-30: "Welcome to RAENG" (was Alex's "Train with intent.", 2026-10-29; before that "Get stronger.").
  headline: "Welcome to RAENG.",
  tagline: "Be part of something stronger.",
  // Alex's mockup: "KETTLEBELL TRAINING IN CUMBERNAULD" and a "Book a class" button on the film (2026-10-29).
  headlineSecondary: "Kettlebell training in Cumbernauld",
  primaryLabel: "Book now",
  bookLabel: "Book a class",
  secondaryLabel: "Explore coaching",
} as const;

/**
 * Meet your coach, further down the page (Alex via the owner, 2026-10-29: "less
 * about me"). Alex's own words; "small group coaching" is how he describes what
 * he offers, so it is his statement, not a page on this site yet.
 */
export const homeCoach = {
  caption: "My journey. My approach to training.",
  greeting: "Meet Alex",
  role: "Founder & kettlebell coach",
  summary:
    "I'm the coach behind RAENG, helping people build strength, move with confidence and make training part of their lives. Based in Cumbernauld, I offer group kettlebell classes, one-to-one coaching, and small group coaching.",
} as const;

/**
 * Why kettlebells, in Alex's own words from his mockup (via the owner,
 * 2026-10-29): a heading, one line, and three practical benefits, described, not
 * promised. No medical or results claims.
 */
export const whyIntro = {
  title: "A simple tool. Real results.",
  body: "Kettlebell training is an efficient way to build strength, improve conditioning and develop better movement.",
} as const;
export const whyKettlebells = [
  { title: "Build real strength", body: "Train multiple muscle groups and develop strength for everyday life." },
  { title: "Improve conditioning", body: "Build fitness, stamina and work capacity through dynamic movements." },
  { title: "Move better", body: "Develop balance, coordination and control." },
] as const;

/**
 * Class lines (owner 2026-10-26): the beginners note under the home page's
 * class times, and the first session and what to bring on /classes. They
 * restate the confirmed FAQ answers (content/faq.ts) more tightly; each shows
 * only while its FAQ answer is confirmed. Keep them in step with faq.ts.
 */
export const firstClassSteps = {
  title: "Start in three steps.",
  // The first session says Alex teaches the key movements, so this stays short (fewer repeats, owner 2026-10-26).
  beginners: "New to RAENG? Let us know when booking.",
  firstSession: "Alex asks about your goals and any injuries, teaches the key movements and gets your technique solid before you go heavier.",
  bring: "Bring comfortable clothes, water and a small towel. Kettlebells provided. You can work out with bare feet or socks.",
  // The same answers, short, for /classes (owner's classes design, 2026-10-28).
  scaled: "Every movement is scaled to you.",
  bringItems: ["Comfy clothes", "Water", "Small towel", "Bare feet or socks"],
  provided: "Kettlebells are provided.",
} as const;

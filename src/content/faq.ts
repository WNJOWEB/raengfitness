import type { FaqItem } from "./types";
import { site } from "./site";
import { defaultClassCapacity, timetable } from "./classes";
import { cancellationPolicy } from "./policy";
import { describeTimetable } from "@/lib/schedule";

/**
 * Only questions with reliable answers. "beginners", "bring" and
 * "first-session" use industry-standard answers at the project owner's
 * request (2026-10-15); Alex should check them. Class length (60 minutes)
 * confirmed 2026-10-17.
 * Refunds (Alex's choice B, via the owner) and class size (up to 15, from Alex's
 * mockup) were confirmed 2026-11-02.
 */
export const faq: FaqItem[] = [
  {
    id: "where",
    question: "Where are classes held?",
    // Without the venue name, as Alex asked for the location (2026-10-29): just the address.
    answer: `At ${site.location.street}, ${site.location.town}, ${site.location.postcode}.`,
    status: "confirmed",
  },
  {
    id: "when",
    question: "When are the group classes?",
    answer: `${describeTimetable(timetable.sessions)}.`,
    // Derived from classes.ts, so it inherits the timetable's status.
    status: timetable.status,
  },
  {
    id: "beginners",
    question: "Are classes suitable for beginners?",
    answer:
      "Yes. Every movement can be scaled to your level. Mention that you're new when you book and Alex will take you through the basics.",
    status: "confirmed",
  },
  {
    id: "first-session",
    question: "What happens at my first session?",
    answer:
      "Alex will ask about your goals and any injuries, teach you the key kettlebell movements and make sure your technique is solid before you go heavier.",
    status: "confirmed",
  },
  {
    id: "bring",
    question: "What should I bring?",
    answer:
      "Comfortable clothes you can move in, a water bottle and a small towel. Kettlebells are provided. You can work out with bare feet or socks.",
    status: "confirmed",
  },
  {
    id: "length",
    question: "How long is a class?",
    answer: "60 minutes, including a warm-up.",
    status: "confirmed",
  },
  {
    id: "class-size",
    question: "How many people are in a class?",
    answer: `Classes hold up to ${defaultClassCapacity} people.`,
    status: "confirmed",
  },
  {
    id: "refunds",
    question: "Can I get a refund?",
    answer: `Cancel 24 hours or more before a class and your credit comes back to your account. ${cancellationPolicy.refunds}`,
    status: "confirmed",
  },
  // The "Can I be coached if I don't live near Cumbernauld?" answer (online coaching) is removed while online coaching is off (Alex, 2026-10-29); restore it from git history.
  {
    id: "one-to-one",
    question: "Do you offer one-to-one sessions?",
    answer:
      "Yes. One-to-one coaching is face to face and tailored to you as an individual. Send a message to discuss what you're looking for.",
    status: "confirmed",
  },
  {
    id: "contact",
    question: "What's the best way to contact you?",
    answer: `Send a message on Instagram (${site.social.raeng.handle}).`,
    status: "confirmed",
  },
];

/** One answer by id, so pages quote the FAQ instead of repeating it. */
export function faqAnswer(id: string): string {
  const item = faq.find((f) => f.id === id);
  if (!item) throw new Error(`Unknown FAQ item: ${id}`);
  return item.answer;
}
